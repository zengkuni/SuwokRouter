import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpWideNarrow,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { Header } from "@/components/Header";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyButton } from "@/components/animate/copy-button";
import { SlidingNumber } from "@/components/animate/sliding-number";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Frame,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  clearUsageHistory,
  fetchRequestDetails,
  fetchUsageStats,
  type RequestDetailData,
  type UsageClearRange,
  type UsageRow,
} from "@/lib/api";
import { listNodes } from "@/lib/admin-extras-api";
import { providerName } from "@/lib/providers";
import { probeEnabled } from "@/lib/live-mode";
import { getCacheDisplay } from "@/lib/cache-display";
import { fetchCurrencySettings } from "@/lib/currency-api";
import {
  FALLBACK_USD_TO_IDR,
  formatCostFromUsd,
  normalizeCurrency,
  usdToDisplay,
  type DisplayCurrency,
} from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useUsageRealtime } from "@/lib/usage-realtime";
import { resolveUsagePagination, shouldClampUsagePage } from "@/lib/usage-pagination";

const PROVIDER_ALL = "all";

type UsagePageRange = "today" | "24h" | "7d" | "30d" | "90d" | "1y";
type ClearHistoryRange = Exclude<UsageClearRange, "14d" | "60d">;

const RANGE_OPTS: { value: UsagePageRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "1y" },
];

const RANGE_LABEL: Record<UsagePageRange, string> = {
  today: "Today",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last 1 year",
};

const CLEAR_RANGE_OPTS: { value: ClearHistoryRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "1y", label: "Last 1 year" },
  { value: "all", label: "All time" },
];

const CLEAR_RANGE_LABEL: Record<ClearHistoryRange, string> = Object.fromEntries(
  CLEAR_RANGE_OPTS.map((option) => [option.value, option.label]),
) as Record<ClearHistoryRange, string>;

const PAGE_SIZE = 12;

function rangeCutoffMs(range: UsagePageRange): number | null {
  switch (range) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "24h":
      return Date.now() - 24 * 60 * 60 * 1000;
    case "7d":
      return Date.now() - 7 * 86400000;
    case "30d":
      return Date.now() - 30 * 86400000;
    case "90d":
      return Date.now() - 90 * 86400000;
    case "1y": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 364);
      return start.getTime();
    }
    default:
      return null;
  }
}

function fmtTokens(n: number) {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("id-ID");
}

function fmtCost(n: number, currency: DisplayCurrency, usdToIdrRate: number) {
  return formatCostFromUsd(n, currency, usdToIdrRate);
}

function modelSlug(model?: string) {
  const value = model?.trim();
  if (!value) return "—";
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function fmtTime(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return "{}";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type PayloadKind = "request" | "providerRequest" | "providerResponse" | "response";

type PayloadSection = {
  key: PayloadKind;
  label: string;
  filename: string;
  value: unknown;
};

function payloadSummary(value: unknown): string {
  if (value === undefined || value === null) return "Not captured";
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record._redacted === "string") return "Capture unavailable";
    if (Object.keys(record).length === 0) return "Empty payload";
  }
  const text = pretty(value);
  return `${text.split("\n").length} lines · ${text.length.toLocaleString()} chars`;
}

function isCaptureMarker(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as Record<string, unknown>)._redacted === "string";
}

function statusDot(row: UsageRow): string {
  if (row.status === "ok" || row.status === "success") return "bg-emerald-500";
  if (row.status === "error" || row.error) return "bg-red-500";
  if (row.status === "pending" || row.status === "processing")
    return "bg-amber-500";
  return "bg-muted-foreground/64";
}

function statusLabel(row: UsageRow): string {
  if (row.status) {
    const status = row.status.toUpperCase();
    return status === "SUCCESS" ? "OK" : status;
  }
  if (row.error) return "ERROR";
  return "—";
}

export default function Usage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<UsagePageRange>("today");
  const [provider, setProvider] = useState(PROVIDER_ALL);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [detailTarget, setDetailTarget] = useState<UsageRow | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearRange, setClearRange] = useState<ClearHistoryRange>("today");
  const [providerColumnHidden, setProviderColumnHidden] = useState(false);
  const [modelColumnHidden, setModelColumnHidden] = useState(false);
  const queryClient = useQueryClient();
  useUsageRealtime();
  const clearHistoryMutation = useMutation({
    mutationFn: clearUsageHistory,
    onSuccess: async () => {
      setClearConfirmOpen(false);
      setDetailTarget(null);
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ["usage-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["usage-history"] });
      await queryClient.invalidateQueries({ queryKey: ["usage-request-details"] });
      await queryClient.invalidateQueries({ queryKey: ["request-detail"] });
    },
  });

  const statsQ = useQuery({
    queryKey: ["usage-stats", range],
    queryFn: () =>
      fetchUsageStats({ range }),
    enabled: probeEnabled(),
    retry: false,
  });
  const currencyQ = useQuery({
    queryKey: ["currency-settings"],
    queryFn: fetchCurrencySettings,
    enabled: probeEnabled(),
    staleTime: 12 * 60 * 60 * 1000,
    retry: false,
  });
  const historyQ = useQuery({
    queryKey: [
      "usage-history",
      page,
      provider === PROVIDER_ALL ? undefined : provider,
      query.trim() || undefined,
      status || undefined,
      range,
      sortDir,
    ],
    queryFn: () => {
      const cutoff = rangeCutoffMs(range);
      return fetchRequestDetails({
        page,
        pageSize: PAGE_SIZE,
        provider: provider === PROVIDER_ALL ? undefined : provider,
        query: query.trim() || undefined,
        status: status || undefined,
        sortDir,
        startDate: cutoff ? new Date(cutoff).toISOString() : undefined,
        source: "usage",
      });
    },
    enabled: probeEnabled(),
    retry: false,
    placeholderData: (previous) => previous,
  });

  const nodesQ = useQuery({
    queryKey: ["nodes"],
    queryFn: listNodes,
    enabled: probeEnabled(),    retry: false,
  });

  const detailQ = useQuery({
    queryKey: [
      "request-detail",
      detailTarget?.provider,
      detailTarget?.model,
      detailTarget?.timestamp,
    ],
    queryFn: () => {
      const ts = detailTarget?.timestamp
        ? new Date(detailTarget.timestamp).getTime()
        : Date.now();
      return fetchRequestDetails({
        provider: detailTarget?.provider,
        model: detailTarget?.model,
        startDate: new Date(ts - 5000).toISOString(),
        endDate: new Date(ts + 5000).toISOString(),
        pageSize: 5,
        includePayloads: true,
      });
    },
    enabled: !!detailTarget,
    retry: false,
  });

  const detail = useMemo<RequestDetailData | null>(
    () =>
      detailQ.data?.details?.find(
        (d) =>
          d.provider === detailTarget?.provider ||
          !detailTarget?.provider
      ) ?? detailQ.data?.details?.[0] ?? null,
    [detailQ.data, detailTarget]
  );

  const stats = statsQ.data;
  const displayCurrency = normalizeCurrency(currencyQ.data?.currency);
  const usdToIdrRate = currencyQ.data?.usdToIdr ?? FALLBACK_USD_TO_IDR;
  const totalCostUsd = stats?.totalCost ?? 0;
  const displayCost = formatCostFromUsd(totalCostUsd, displayCurrency, usdToIdrRate);
  const rawHistory: UsageRow[] = useMemo(
    () =>
      (historyQ.data?.details ?? []).map((detail) => ({
        id: detail.id ? Number(detail.id) || undefined : undefined,
        timestamp: detail.timestamp,
        provider: detail.provider,
        model: detail.model,
        connectionId: detail.connectionId,
        endpoint: detail.endpoint,
        cost: detail.cost,
        promptTokens:
          detail.tokens?.prompt_tokens ?? detail.tokens?.input_tokens,
        completionTokens:
          detail.tokens?.completion_tokens ?? detail.tokens?.output_tokens,
        cachedTokens:
          detail.tokens?.cached_tokens ??
          detail.tokens?.cache_read_input_tokens ??
          (detail.tokens?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens,
        cacheCreationTokens:
          detail.tokens?.cache_creation_input_tokens ??
          (detail.tokens?.prompt_tokens_details as { cache_creation_tokens?: number } | undefined)?.cache_creation_tokens,
        status: detail.status,
        latencyMs:
          typeof detail.latency?.total === "number"
            ? detail.latency.total
            : undefined,
        error: typeof detail.error === "string" ? detail.error : null,
      })),
    [historyQ.data]
  );
  const loading = statsQ.isLoading || historyQ.isLoading;

  const providerLabel = useMemo(() => {
    const nodeMap = new Map<string, string>();
    for (const n of nodesQ.data ?? []) {
      nodeMap.set(n.id, n.name || n.id);
      if (n.prefix) nodeMap.set(n.prefix, n.name || n.prefix);
    }
    return (id?: string): string => {
      if (!id) return "—";
      if (nodeMap.has(id)) return nodeMap.get(id)!;
      return providerName(id) || id;
    };
  }, [nodesQ.data]);

  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    Object.keys(stats?.byProvider ?? {}).forEach((p) => set.add(p));
    rawHistory.forEach((h) => h.provider && set.add(h.provider));
    return Array.from(set).sort();
  }, [stats, rawHistory]);

  const providerItems = useMemo(() => {
    const map: Record<string, string> = { [PROVIDER_ALL]: "All providers" };
    for (const p of providerOptions) map[p] = providerLabel(p);
    return map;
  }, [providerLabel, providerOptions]);

  const pageRows = rawHistory;
  const pagination = historyQ.data?.pagination;
  const totalItems = pagination?.totalItems ?? 0;
  const { safePage, totalPages } = resolveUsagePagination(page, pagination);
  const paginationLoading = historyQ.isFetching;

  useEffect(() => {
    setPage(1);
  }, [range, provider, query, status, sortDir]);

  useEffect(() => {
    if (shouldClampUsagePage(page, pagination, historyQ.isFetching)) {
      setPage(totalPages);
    }
  }, [historyQ.isFetching, page, pagination, totalPages]);

  const statusOptions = useMemo(
    () => Array.from(new Set(rawHistory.map((row) => row.status).filter(Boolean) as string[])).sort(),
    [rawHistory]
  );
  useEffect(() => {
    if (status && !statusOptions.includes(status)) setStatus("");
  }, [status, statusOptions]);

  const detailTokens = detail?.tokens;
  const promptTokens =
    detailTokens?.prompt_tokens ?? detailTokens?.input_tokens ?? undefined;
  const completionTokens =
    detailTokens?.completion_tokens ?? detailTokens?.output_tokens ?? undefined;
  const cachedTokens =
    detailTokens?.cached_tokens ??
    detailTokens?.cache_read_input_tokens ??
    undefined;
  const detailPayloadCaptured = [
    detail?.request,
    detail?.providerRequest,
    detail?.providerResponse,
    detail?.response,
  ].some((value) => value !== undefined && value !== null && !isCaptureMarker(value));

  return (

    <div className="flex h-full min-h-0 w-full flex-col gap-2.5">
      <Header
        className="mb-0 shrink-0 sm:mb-0"
        title="Usage & Cost"
        actions={
          <div className="w-full max-w-full sm:min-w-[26rem] sm:w-auto">
            <Segmented
              size="sm"
              value={range}
              onChange={setRange}
              options={RANGE_OPTS}
              className="w-full"
            />
          </div>
        }
      />

      {statsQ.isError || historyQ.isError ? (
        <div className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Unable to load live usage data. Check your session and backend connection.
        </div>
      ) : null}

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        <Frame className="w-full rounded-xl p-0.5 sm:rounded-2xl sm:p-1">
          <FramePanel className="rounded-lg p-2.5 sm:rounded-xl sm:p-4">
            <FrameTitle className="min-h-5 text-[10px] font-medium leading-tight text-muted-foreground sm:min-h-0 sm:text-[12px]">
              Total requests
            </FrameTitle>
            <p className="mt-1 text-lg font-semibold leading-none tabular-nums sm:text-2xl">
              {loading ? "—" : <SlidingNumber value={stats?.total ?? 0} />}
            </p>
          </FramePanel>
        </Frame>
        <Frame className="w-full rounded-xl p-0.5 sm:rounded-2xl sm:p-1">
          <FramePanel className="rounded-lg p-2.5 sm:rounded-xl sm:p-4">
            <FrameTitle className="min-h-5 text-[10px] font-medium leading-tight text-muted-foreground sm:min-h-0 sm:text-[12px]">
              Total input tokens
            </FrameTitle>
            <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-success sm:text-2xl">
              {loading ? "—" : <SlidingNumber value={stats?.totalPromptTokens ?? 0} className="text-success" />}
            </p>
          </FramePanel>
        </Frame>
        <Frame className="w-full rounded-xl p-0.5 sm:rounded-2xl sm:p-1">
          <FramePanel className="rounded-lg p-2.5 sm:rounded-xl sm:p-4">
            <FrameTitle className="min-h-5 text-[10px] font-medium leading-tight text-muted-foreground sm:min-h-0 sm:text-[12px]">
              Output tokens
            </FrameTitle>
            <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-destructive sm:text-2xl">
              {loading ? "—" : <SlidingNumber value={stats?.totalCompletionTokens ?? 0} className="text-destructive" />}
            </p>
          </FramePanel>
        </Frame>
        <Frame className="w-full rounded-xl p-0.5 sm:rounded-2xl sm:p-1">
          <FramePanel className="rounded-lg p-2.5 sm:rounded-xl sm:p-4">
            <FrameTitle className="min-h-5 text-[10px] font-medium leading-tight text-muted-foreground sm:min-h-0 sm:text-[12px]">
              Cached tokens
            </FrameTitle>
            <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-warning sm:text-2xl">
              {loading ? "—" : <SlidingNumber value={stats?.totalCachedTokens ?? 0} className="text-warning" />}
            </p>
          </FramePanel>
        </Frame>
        <Frame className="w-full rounded-xl p-0.5 sm:rounded-2xl sm:p-1">
          <FramePanel className="rounded-lg p-2.5 sm:rounded-xl sm:p-4">
            <FrameTitle className="min-h-5 text-[10px] font-medium leading-tight text-muted-foreground sm:min-h-0 sm:text-[12px]">
              {`Est. cost (${displayCurrency})`}
            </FrameTitle>
            <p className="mt-1 min-w-0 max-w-full truncate text-lg font-semibold leading-none tabular-nums sm:text-2xl">
              {loading ? "—" : (
                <Tooltip label={displayCost}>
                  <span
                    className="inline-block max-w-full truncate align-bottom"
                    title={displayCost}
                  >
                    <SlidingNumber
                      value={usdToDisplay(totalCostUsd, displayCurrency, usdToIdrRate)}
                      prefix={displayCurrency === "IDR" ? "Rp" : "$"}
                      locale={displayCurrency === "IDR" ? "id-ID" : "en-US"}
                      decimals={displayCurrency === "IDR" ? 0 : totalCostUsd < 0.01 ? 4 : 2}
                      className="text-[clamp(1rem,4vw,1.5rem)]"
                    />
                  </span>
                </Tooltip>
              )}
            </p>
          </FramePanel>
        </Frame>
      </div>

      <Frame className="flex min-h-0 flex-1 flex-col rounded-xl bg-transparent p-0 sm:rounded-2xl sm:bg-muted/72 sm:p-1">
        <FrameHeader className="border-b border-border/70 px-3 py-3 sm:border-0 sm:px-5 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div>
              <FrameTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Request history
              </FrameTitle>
              <p className="mt-1 text-[11px] text-muted-foreground">
                To view payload details, enable “Capture full request payloads” in Settings.
              </p>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-0.5 sm:hidden">
                <Tooltip label={providerColumnHidden ? "Show provider names" : "Hide provider names"}>
                  <button
                    type="button"
                    aria-label={providerColumnHidden ? "Show provider names" : "Hide provider names"}
                    aria-pressed={providerColumnHidden}
                    onClick={() => setProviderColumnHidden((hidden) => !hidden)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {providerColumnHidden ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                    <span>Provider</span>
                  </button>
                </Tooltip>
                <Tooltip label={modelColumnHidden ? "Show full model names" : "Hide provider prefixes from models"}>
                  <button
                    type="button"
                    aria-label={modelColumnHidden ? "Show full model names" : "Hide provider prefixes from models"}
                    aria-pressed={modelColumnHidden}
                    onClick={() => setModelColumnHidden((hidden) => !hidden)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {modelColumnHidden ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                    <span>Model</span>
                  </button>
                </Tooltip>
              </div>
              <Tooltip label="Clear history">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-7 sm:w-auto sm:px-2 sm:text-[11px]"
                  onClick={() => {
                    setClearRange(range);
                    setClearConfirmOpen(true);
                  }}
                  disabled={clearHistoryMutation.isPending}
                  aria-label="Clear history"
                >
                  <Trash2 className="h-3.5 w-3.5 sm:hidden" />
                  <span className="hidden sm:inline">Clear history</span>
                </Button>
              </Tooltip>
              <Tooltip label="Sort by date">
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-md px-0 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:h-7 sm:w-auto sm:gap-1.5 sm:px-2"
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                  aria-label={sortDir === "desc" ? "Sort oldest first" : "Sort newest first"}
                >
                {sortDir === "desc" ? (
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ArrowUpWideNarrow className="h-3.5 w-3.5" aria-hidden />
                )}
                  <span className="hidden sm:inline">Sort by date</span>
                </button>
              </Tooltip>
            </div>
          </div>
        </FrameHeader>

        {clearHistoryMutation.isError ? (
          <div className="mx-5 mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Failed to clear Usage history. Try again.
          </div>
        ) : null}

        <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 px-3 pb-3 sm:flex-row sm:items-center sm:border-0 sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search model, provider, status, connection…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-9 pl-9 pr-8 leading-none"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:contents">
            <Select
              items={providerItems}
              value={provider}
              onValueChange={(value) => setProvider(value ?? PROVIDER_ALL)}
            >
              <SelectTrigger className="h-9 w-full sm:w-48">
                <SelectValue placeholder="All providers" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value={PROVIDER_ALL}>All providers</SelectItem>
                {providerOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {providerLabel(p)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Select
              items={{ all: "All statuses", ...Object.fromEntries(statusOptions.map((s) => [s, s.toUpperCase()])) }}
              value={status || "all"}
              onValueChange={(value) => setStatus(value === "all" ? "" : value ?? "")}
            >
              <SelectTrigger className="h-9 w-full sm:w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>

        <div className="min-h-0 flex-1 px-3 pb-1 sm:px-1">
          <ScrollArea overscrollContain className="h-full">
            <div className="w-full min-w-0 rounded-xl border border-border/70 bg-card sm:hidden">
              {loading ? (
                <div className="divide-y divide-border/70">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="px-2.5 py-2.5">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="mt-2 h-3 w-full" />
                    </div>
                  ))}
                </div>
              ) : pageRows.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No usage rows for {RANGE_LABEL[range].toLowerCase()}
                </div>
              ) : (
                <div className="divide-y divide-border/70">
                  {pageRows.map((row, index) => {
                    const cache = getCacheDisplay(row);
                    return (
                      <article
                        key={row.id ?? `${row.timestamp}-${index}`}
                        className="min-w-0 px-2.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-xs font-medium">
                              {providerColumnHidden ? "Hidden" : providerLabel(row.provider)}
                            </p>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px] font-normal">
                                <span aria-hidden="true" className={cn("size-1.5 rounded-full", statusDot(row))} />
                                {statusLabel(row)}
                              </Badge>
                              <Tooltip label="View details">
                                <Button
                                  variant="outline"
                                  size="icon-xs"
                                  className="size-6 shrink-0 p-0 [&_svg]:size-3"
                                  onClick={() => setDetailTarget(row)}
                                  aria-label="View request details"
                                >
                                  <Eye className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              </Tooltip>
                            </div>
                          </div>
                          <Tooltip label={modelColumnHidden ? "Showing model slug only" : row.model || "—"}>
                            <p className="mt-0.5 max-w-full truncate whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                              {modelColumnHidden ? modelSlug(row.model) : row.model || "—"}
                            </p>
                          </Tooltip>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[10px] tabular-nums text-muted-foreground">
                            <span className="shrink-0">{fmtTime(row.timestamp)}</span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0 text-success">In {fmtTokens(row.promptTokens || 0)}</span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0 text-destructive">Out {fmtTokens(row.completionTokens || 0)}</span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0 text-foreground">{fmtCost(row.cost ?? 0, displayCurrency, usdToIdrRate)}</span>
                            <span aria-hidden="true">·</span>
                            <Tooltip label={cache.title}>
                              <span className={cn("shrink-0", cache.hit ? "text-warning" : "text-muted-foreground")}>{cache.label}</span>
                            </Tooltip>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="hidden sm:block">
            <Table variant="card" className="min-w-[900px] text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-2">Time</TableHead>
                <TableHead className="px-3 py-2">
                  <div className="group/column flex items-center gap-1.5">
                    <span>Provider</span>
                    <Tooltip label={providerColumnHidden ? "Show provider names" : "Hide provider names"}>
                      <button
                        type="button"
                        aria-label={providerColumnHidden ? "Show provider names" : "Hide provider names"}
                        onClick={() => setProviderColumnHidden((hidden) => !hidden)}
                        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/column:opacity-100"
                      >
                        {providerColumnHidden ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                      </button>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead className="px-3 py-2">
                  <div className="group/column flex items-center gap-1.5">
                    <span>Model</span>
                    <Tooltip label={modelColumnHidden ? "Show full model names" : "Hide provider prefixes from models"}>
                      <button
                        type="button"
                        aria-label={modelColumnHidden ? "Show full model names" : "Hide provider prefixes from models"}
                        onClick={() => setModelColumnHidden((hidden) => !hidden)}
                        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/column:opacity-100"
                      >
                        {modelColumnHidden ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                      </button>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead className="px-3 py-2 text-success">In</TableHead>
                <TableHead className="px-3 py-2 text-destructive">
                  Out
                </TableHead>
                <TableHead className="px-3 py-2">Cache</TableHead>
                <TableHead className="px-3 py-2">Cost</TableHead>
                <TableHead className="px-3 py-2">Status</TableHead>
                <TableHead className="px-3 py-2 text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9} className="px-4 py-2">
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No usage rows for {RANGE_LABEL[range].toLowerCase()}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, i) => (
                  <TableRow key={row.id ?? `${row.timestamp}-${i}`}>
                    <TableCell className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {fmtTime(row.timestamp)}
                    </TableCell>
                    <TableCell className="px-3 py-2 font-medium">
                      <span className={cn(providerColumnHidden && "font-normal italic text-muted-foreground")}>
                        {providerColumnHidden ? "Hidden" : providerLabel(row.provider)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2">
                      <Tooltip label={modelColumnHidden ? "Showing model slug only" : row.model || "—"}>
                        <span className="block min-w-max whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                          {modelColumnHidden ? modelSlug(row.model) : row.model || "—"}
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 tabular-nums text-success">
                        <ArrowDown className="h-3 w-3" />
                        {fmtTokens(row.promptTokens || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 tabular-nums text-destructive">
                        <ArrowUp className="h-3 w-3" />
                        {fmtTokens(row.completionTokens || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {(() => {
                        const cache = getCacheDisplay(row);
                        return (
                          <Tooltip label={cache.title}>
                            <span
                              className={cn(
                                "whitespace-nowrap text-[11px] font-medium tabular-nums",
                                cache.hit ? "text-warning" : "text-muted-foreground"
                              )}
                            >
                              {cache.label}
                            </span>
                          </Tooltip>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-muted-foreground tabular-nums">
                      {fmtCost(row.cost ?? 0, displayCurrency, usdToIdrRate)}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <Badge variant="outline" className="font-normal">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-1.5 rounded-full",
                            statusDot(row)
                          )}
                        />
                        {statusLabel(row)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => setDetailTarget(row)}
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
            </div>
          </ScrollArea>
        </div>

        {totalItems > 0 ? (
          <FrameFooter className="px-3 py-3 sm:px-5 sm:py-4">
            <div className="flex items-center justify-end gap-2">
              <p className="text-[10px] tabular-nums text-muted-foreground sm:text-[11px]">
                {safePage}/{totalPages}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="size-8 px-0 sm:h-7 sm:w-auto sm:px-2.5"
                  loading={paginationLoading}
                  disabled={paginationLoading || safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label={paginationLoading ? "Loading page" : "Previous page"}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Prev</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="size-8 px-0 sm:h-7 sm:w-auto sm:px-2.5"
                  loading={paginationLoading}
                  disabled={paginationLoading || safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label={paginationLoading ? "Loading page" : "Next page"}
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
          </FrameFooter>
        ) : null}
      </Frame>

      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="max-w-[25rem] overflow-hidden p-0">
          <div className="border-b border-border/70 bg-destructive/[0.06] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden />
              </div>
              <DialogHeader className="gap-1 text-left">
                <DialogTitle className="text-sm font-semibold">Clear Usage history?</DialogTitle>
                <DialogDescription className="text-xs leading-5">
                  Remove request history, daily totals, and captured details for the selected time range.
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-2">
              <label htmlFor="clear-history-range" className="text-xs font-medium text-foreground">
                Time range
              </label>
              <Select
                items={Object.fromEntries(CLEAR_RANGE_OPTS.map((option) => [option.value, option.label]))}
                value={clearRange}
                onValueChange={(value) => setClearRange((value as ClearHistoryRange) || "today")}
              >
                <SelectTrigger id="clear-history-range" className="h-9 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup className="max-h-52 overscroll-contain">
                  {CLEAR_RANGE_OPTS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="min-h-8 py-1.5"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">{CLEAR_RANGE_LABEL[clearRange]}</span> will be removed. Providers, API keys, and settings will not be affected.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setClearConfirmOpen(false)} disabled={clearHistoryMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => clearHistoryMutation.mutate(clearRange)}
                disabled={clearHistoryMutation.isPending}
              >
                {clearHistoryMutation.isPending ? "Clearing…" : clearRange === "all" ? "Clear all history" : `Clear ${CLEAR_RANGE_LABEL[clearRange].toLowerCase()}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {
                                                                        }
      <Sheet
        open={!!detailTarget}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null);
        }}
      >
        <SheetPopup variant="inset">
          <SheetHeader className="px-4 py-3 sm:px-5 sm:py-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-8 w-fit gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setDetailTarget(null)}
              aria-label="Back to usage history"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            <div className="mt-2 flex min-w-0 items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <SheetTitle className="text-lg sm:text-xl">Request detail</SheetTitle>
                <SheetDescription className="break-words font-mono text-[11px] leading-4 sm:text-xs">
                  {detailTarget?.model || "Unknown model"} ·{" "}
                  {detailTarget ? providerLabel(detailTarget.provider) : ""}
                </SheetDescription>
              </div>
              {detailTarget ? (
                <StatusBadge
                  tone={
                    detailTarget.status === "ok" || detailTarget.status === "success"
                      ? "ok"
                      : detailTarget.status === "error"
                        ? "err"
                        : "muted"
                  }
                  className="shrink-0 text-[10px]"
                >
                  {(detailTarget.status || "—").toUpperCase()}
                </StatusBadge>
              ) : null}
            </div>
          </SheetHeader>
          <SheetPanel className="space-y-3 px-4 py-3 sm:space-y-4 sm:px-5 sm:py-4">
            <section className="rounded-xl border border-border/70 bg-surface/35 p-3 sm:p-3.5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Request summary
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {[
                  ["Time", fmtTime(detailTarget?.timestamp), false],
                  ["Provider", detailTarget ? providerLabel(detailTarget.provider) : "—", false],
                  [
                    "Latency",
                    detail?.latency?.total != null
                      ? `${Math.round(detail.latency.total)} ms`
                      : detailTarget?.latencyMs != null
                        ? `${detailTarget.latencyMs} ms`
                        : "—",
                    false,
                  ],
                  ["Cost", fmtCost(detailTarget?.cost ?? detail?.cost ?? 0, displayCurrency, usdToIdrRate), false],
                  ["Connection ID", detail?.connectionId || detailTarget?.connectionId || "—", true],
                  ["Endpoint", detailTarget?.endpoint || "—", true],
                ].map(([label, value, mono]) => (
                  <div
                    key={String(label)}
                    className={cn(
                      "min-w-0",
                      label === "Connection ID" && "col-span-2 sm:col-span-2",
                    )}
                  >
                    <dt className="text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">
                      {String(label)}
                    </dt>
                    <dd className="mt-0.5 flex min-w-0 items-center gap-2">
                      <Tooltip label={String(value)}>
                        <span className={cn(
                          "min-w-0 flex-1 text-[11px] text-foreground sm:text-xs",
                          Boolean(mono) && "font-mono text-[10px] sm:text-[11px]",
                          label === "Connection ID" ? "break-all" : "truncate",
                        )}>
                          {String(value)}
                        </span>
                      </Tooltip>
                      {label === "Connection ID" && value !== "—" ? (
                        <CopyButton
                          value={String(value)}
                          label="Copy"
                          iconOnly
                          className="size-6 shrink-0 p-0 [&_svg]:mx-0 [&_svg]:size-3"
                        />
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {detailTarget?.error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-destructive-foreground">
                {detailTarget.error}
              </p>
            ) : null}

            <section className="rounded-xl border border-border/70 bg-surface/35 p-3 sm:p-3.5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Token usage
              </p>
              <div className="grid grid-cols-3 divide-x divide-border/70">
                {[
                  ["Prompt", fmtTokens(promptTokens ?? detailTarget?.promptTokens ?? 0), "text-success"],
                  ["Cached", fmtTokens(cachedTokens ?? 0), "text-foreground"],
                  ["Completion", fmtTokens(completionTokens ?? detailTarget?.completionTokens ?? 0), "text-destructive"],
                ].map(([label, value, color], index) => (
                  <div
                    key={String(label)}
                    className={cn(
                      "min-w-0 px-3 first:pl-0 last:pr-0",
                      index === 0 && "pl-0",
                    )}
                  >
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">
                      {String(label)}
                    </p>
                    <p className={cn("mt-0.5 text-sm font-semibold tabular-nums sm:text-base", String(color))}>
                      {String(value)}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-[11px]">
                    Payload
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {detailPayloadCaptured
                      ? "Select a captured payload to inspect and copy its JSON."
                      : "Full payload was not captured. Metadata remains available above."}
                  </p>
                </div>
                <Badge
                  variant={detailPayloadCaptured ? "success" : "outline"}
                  className="text-[10px] font-normal"
                >
                  {detailPayloadCaptured ? "Payload captured" : "Metadata only"}
                </Badge>
                {!detailPayloadCaptured ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-[11px]"
                    onClick={() => navigate("/dashboard/settings?tab=security")}
                  >
                    <Settings2 className="size-3.5" aria-hidden="true" />
                    Enable in Settings
                  </Button>
                ) : null}
              </div>
              {detailQ.isLoading ? (
                <div className="space-y-2 rounded-xl border border-border/70 p-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : detail ? (() => {
                const payloads: PayloadSection[] = [
                  {
                    key: "request",
                    label: "Request",
                    filename: `${detail.request?.method ?? "REQUEST"}.json`,
                    value: detail.request,
                  },
                  {
                    key: "providerRequest",
                    label: "Provider request",
                    filename: "provider-request.json",
                    value: detail.providerRequest,
                  },
                  {
                    key: "providerResponse",
                    label: "Provider response",
                    filename: "provider-response.json",
                    value: detail.providerResponse,
                  },
                  {
                    key: "response",
                    label: "Response",
                    filename: "response.json",
                    value: detail.response,
                  },
                ] satisfies PayloadSection[];
                const capturedPayloads = payloads.filter(
                  (item) => item.value !== undefined && item.value !== null,
                );

                return capturedPayloads.length ? (
                  <Accordion
                    multiple
                    defaultValue={capturedPayloads[0] ? [capturedPayloads[0].key] : []}
                    className="w-full min-w-0 overflow-hidden rounded-xl border border-border/70 bg-surface/30"
                  >
                    {capturedPayloads.map((payload) => {
                      const marker = isCaptureMarker(payload.value);
                      return (
                        <AccordionItem
                          key={payload.key}
                          value={payload.key}
                          className="border-border/70 px-3 last:border-b-0"
                        >
                          <AccordionTrigger className="gap-2 py-2 sm:py-2.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-xs sm:text-sm">{payload.label}</span>
                              <span className="truncate text-[9px] font-normal text-muted-foreground sm:text-[10px]">
                                {payloadSummary(payload.value)}
                              </span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="min-w-0 overflow-hidden pb-3">
                            {marker ? (
                              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                                Payload capture was unavailable for this field. Metadata is still available above.
                              </div>
                            ) : (
                              <CodeBlock
                                code={pretty(payload.value)}
                                language="json"
                                filename={payload.filename}
                                className="max-h-80 max-w-full min-w-0 overflow-auto"
                              />
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                ) : (
                  <p className="rounded-xl border border-border/70 bg-surface/30 px-3 py-3 text-xs text-muted-foreground">
                    Full request and response payloads were not captured for this request.
                  </p>
                );
              })() : (
                <p className="rounded-xl border border-border/70 bg-surface/30 px-3 py-3 text-xs text-muted-foreground">
                  Full request and response payloads were not captured for this request.
                </p>
              )}
            </section>
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </div>
  );
}
