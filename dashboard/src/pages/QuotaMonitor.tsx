import { useEffect, useMemo, useState } from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
  type QueryFunctionContext,
} from "@tanstack/react-query";
import axios from "axios";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Frame, FrameFooter, FrameHeader, FramePanel } from "@/components/ui/frame";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  fetchUsageForConnection,
  getErrorMessage,
  resetCodexCredits,
  type ProviderUsage,
} from "@/lib/api";
import {
  listConnectionsPage,
  listProviderCounts,
  type Connection,
  type ProviderCount,
} from "@/lib/connections-api";
import { getProviderIconSrc } from "@/lib/provider-icon";
import { providerColor, providerIcon, providerName } from "@/lib/providers";
import { probeEnabled } from "@/lib/live-mode";

const USAGE_PROVIDERS = new Set([
  "github",
  "gemini-cli",
  "antigravity",
  "claude",
  "codex",
  "kiro",
  "qoder",
  "ollama",
  "glm",
  "glm-cn",
  "minimax",
  "minimax-cn",
  "vercel-ai-gateway",
  "codebuddy-cn",
  "codebuddy-intl",
  "grok-cli",
  "kimi",
  "deepseek",
]);

const QUOTA_PAGE_SIZE = 25;
const QUOTA_MAX_ACCOUNTS_PER_PROVIDER = 200;
const QUOTA_FETCH_CONCURRENCY = 6;
const QUOTA_VISIBLE_ROWS = 3;

type QuotaFetchJob = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  started: boolean;
  cleanup: () => void;
};

const quotaFetchQueue: QuotaFetchJob[] = [];
let quotaFetchActive = 0;

function drainQuotaFetchQueue() {
  while (quotaFetchActive < QUOTA_FETCH_CONCURRENCY && quotaFetchQueue.length > 0) {
    const job = quotaFetchQueue.shift();
    if (!job) return;
    if (job.signal?.aborted) {
      job.cleanup();
      job.reject(job.signal.reason ?? new DOMException("Quota request aborted", "AbortError"));
      continue;
    }
    quotaFetchActive += 1;
    job.started = true;
    void job.run()
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        job.cleanup();
        quotaFetchActive -= 1;
        drainQuotaFetchQueue();
      });
  }
}

function scheduleQuotaFetch<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Quota request aborted", "AbortError"));
      return;
    }

    const job: QuotaFetchJob = {
      run: async () => run(),
      resolve: resolve as (value: unknown) => void,
      reject,
      signal,
      started: false,
      cleanup: () => undefined,
    };
    const onAbort = () => {
      if (job.started) return;
      const index = quotaFetchQueue.indexOf(job);
      if (index === -1) return;
      quotaFetchQueue.splice(index, 1);
      job.cleanup();
      reject(signal?.reason ?? new DOMException("Quota request aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    job.cleanup = () => signal?.removeEventListener("abort", onAbort);
    quotaFetchQueue.push(job);
    drainQuotaFetchQueue();
  });
}

const AUTH_EXPIRED_PATTERNS = [
  "expired",
  "authentication",
  "unauthorized",
  "401",
  "re-authorize",
];

function isAuthExpired(msg?: string | null): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => m.includes(p));
}

function authExpiredFromError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 401) return true;
    const data = err.response?.data as
      | { error?: string; message?: string }
      | undefined;
    const msg = data?.error || data?.message || "";
    if (AUTH_EXPIRED_PATTERNS.some((p) => msg.toLowerCase().includes(p))) {
      return true;
    }
  }
  const text = err instanceof Error ? err.message : "";
  return AUTH_EXPIRED_PATTERNS.some((p) => text.toLowerCase().includes(p));
}

type NormalizedQuota = {
  name: string;
  used: number;
  total: number;

  remaining: number;
  resetAt: string | null;
  recurring: boolean;
  unlimited: boolean;
  unit?: string;
};

function calculatePercentage(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  if (!used || used < 0) return 100;
  if (used >= total) return 0;
  return Math.round(((total - used) / total) * 100);
}

function parseQuotaData(provider: string, data: ProviderUsage): NormalizedQuota[] {
  const quotas = data?.quotas;
  if (!quotas || typeof quotas !== "object") return [];
  const p = provider.toLowerCase();
  return Object.entries(quotas).flatMap(([key, q]) => {
    const used = Number.isFinite(Number(q.used)) ? Number(q.used) : 0;
    const total = Number.isFinite(Number(q.total)) ? Number(q.total) : 0;
    const remaining = p === "codex" && q.remaining !== undefined
      ? Math.max(0, Math.round(Number(q.remaining)))
      : q.remainingPercentage !== undefined
        ? Math.max(0, Math.round(Number(q.remainingPercentage)))
        : calculatePercentage(used, total);
    if (p === "qoder" && key === "organization" && total <= 0) return [];
    return [{
      name: p === "antigravity" ? q.displayName || key : p === "qoder"
        ? key === "user" ? "Personal" : key === "organization" ? "Organization" : key
        : key,
      used,
      total,
      remaining,
      resetAt: q.resetAt ?? null,
      recurring: q.recurring !== false,
      unlimited: q.unlimited === true || total <= 0,
      unit: q.unit,
    }];
  });
}

function formatResetTime(date?: string | null): string | null {
  if (!date) return null;
  const diffMs = new Date(date).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ${minutes % 60}m`;
}

function fmtCount(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("id-ID") : "0";
}

function getColorClasses(remaining: number) {
  if (remaining > 70) return { text: "text-success", bg: "bg-success", bgLight: "bg-success/10" };
  if (remaining >= 30) return { text: "text-warning", bg: "bg-warning", bgLight: "bg-warning/10" };
  return { text: "text-destructive", bg: "bg-destructive", bgLight: "bg-destructive/10" };
}

type QuotaCard = {
  conn: Connection;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  authExpired: boolean;
  usage: ProviderUsage | null;
  quotas: NormalizedQuota[];
  message: string | null;
  resetCredits: number;
  plan: string | null;
};

type QuotaProviderGroup = ProviderCount & { provider: string };

type ProviderPageState = {
  loading: boolean;
  fetching: boolean;
  error: boolean;
  hasNext: boolean;
  capped: boolean;
  loaded: number;
};

function quotaStatus(card: QuotaCard): React.ReactNode {
  if (card.loading) return null;
  if (card.authExpired) return <StatusBadge tone="warn">Auth expired</StatusBadge>;
  if (card.error) return <StatusBadge tone="err">Error</StatusBadge>;
  if (card.conn.isActive === false) return <StatusBadge tone="muted">Disabled</StatusBadge>;
  if (card.quotas.length === 0) return <StatusBadge tone="muted">No quota</StatusBadge>;
  const min = Math.min(...card.quotas.map((q) => q.remaining));
  if (min <= 0) return <StatusBadge tone="err">Limit reached</StatusBadge>;
  if (min < 30) return <StatusBadge tone="warn">Low quota</StatusBadge>;
  return <StatusBadge tone="ok">OK</StatusBadge>;
}

function ProviderMark({ provider }: { provider: string }) {
  const Icon = providerIcon(provider);
  const color = providerColor(provider);
  const iconSrc = getProviderIconSrc(provider);
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      {iconSrc ? (
        <span
          aria-hidden="true"
          className="block h-4 w-4 shrink-0"
          style={{
            backgroundColor: color,
            WebkitMaskImage: `url(${iconSrc})`,
            maskImage: `url(${iconSrc})`,
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      ) : (
        <Icon className="h-4 w-4" />
      )}
    </span>
  );
}

export default function QuotaMonitor() {
  const qc = useQueryClient();
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [providerPages, setProviderPages] = useState<Record<string, number>>({});

  const [, setCountdownTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdownTick((tick) => tick + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const providerCountsQ = useQuery({
    queryKey: ["quota-provider-counts"],
    queryFn: listProviderCounts,
    enabled: probeEnabled(),
    retry: false,
  });

  const providerGroups = useMemo<QuotaProviderGroup[]>(() => {
    return (providerCountsQ.data ?? [])
      .map((row) => ({ ...row, provider: String(row.provider || "").trim() }))
      .filter((row) => USAGE_PROVIDERS.has(row.provider) && row.total > 0);
  }, [providerCountsQ.data]);

  useEffect(() => {
    setProviderPages((previous) => {
      const next: Record<string, number> = {};
      for (const group of providerGroups) {
        next[group.provider] = Math.max(1, previous[group.provider] ?? 1);
      }
      return next;
    });
  }, [providerGroups]);

  const pageRequests = useMemo(
    () => providerGroups.flatMap((group) => {
      const pageCount = providerPages[group.provider] ?? 1;
      return Array.from({ length: pageCount }, (_, index) => ({
        provider: group.provider,
        page: index + 1,
      }));
    }),
    [providerGroups, providerPages],
  );

  const connectionPageQueries = useQueries({
    queries: pageRequests.map((request) => ({
      queryKey: ["quota-connections", request.provider, request.page],
      queryFn: () => listConnectionsPage({
        provider: request.provider,
        page: request.page,
        pageSize: QUOTA_PAGE_SIZE,
      }),
      enabled: probeEnabled(),
      retry: false,
      staleTime: 30_000,
    })),
  });

  const connectionsByProvider = useMemo(() => {
    const grouped = new Map<string, Connection[]>();
    pageRequests.forEach((request, index) => {
      const page = connectionPageQueries[index]?.data?.connections ?? [];
      const current = grouped.get(request.provider) ?? [];
      const seen = new Set(current.map((connection) => connection.id));
      grouped.set(
        request.provider,
        [...current, ...page.filter((connection) => !seen.has(connection.id))],
      );
    });
    return grouped;
  }, [connectionPageQueries, pageRequests]);

  const pageStateByProvider = useMemo(() => {
    const state = new Map<string, ProviderPageState>();
    for (const group of providerGroups) {
      const indexes = pageRequests
        .map((request, index) => request.provider === group.provider ? index : -1)
        .filter((index) => index >= 0);
      const queries = indexes.map((index) => connectionPageQueries[index]);
      const lastQuery = queries[queries.length - 1];
      const lastMeta = lastQuery?.data?.pagination;
      const loaded = connectionsByProvider.get(group.provider)?.length ?? 0;
      const capped = loaded >= QUOTA_MAX_ACCOUNTS_PER_PROVIDER && loaded < group.total;
      state.set(group.provider, {
        loading: Boolean(queries[0]?.isPending),
        fetching: queries.some((query) => query?.isFetching),
        error: queries.some((query) => query?.isError),
        hasNext: !capped && (Boolean(lastMeta?.hasNext) || loaded < group.total),
        capped,
        loaded,
      });
    }
    return state;
  }, [connectionPageQueries, connectionsByProvider, pageRequests, providerGroups]);

  const connections = useMemo(
    () => providerGroups.flatMap((group) => connectionsByProvider.get(group.provider) ?? []),
    [connectionsByProvider, providerGroups],
  );
  const usageQueries = useQueries({
    queries: connections.map((connection) => ({
      queryKey: ["quota-usage", connection.id],
      queryFn: ({ signal }: QueryFunctionContext) => scheduleQuotaFetch(
        () => fetchUsageForConnection(connection.id, signal),
        signal,
      ),
      enabled: Boolean(connection.id),
      retry: false,
      staleTime: 30_000,
    })),
  });

  const cardsByProvider = useMemo(() => {
    const grouped = new Map<string, QuotaCard[]>();
    connections.forEach((conn, index) => {
      const q = usageQueries[index];
      let card: QuotaCard;
      if (!q || q.isPending) {
        card = {
          conn,
          loading: true,
          fetching: Boolean(q?.isFetching),
          error: null,
          authExpired: false,
          usage: null,
          quotas: [],
          message: null,
          resetCredits: 0,
          plan: null,
        };
      } else if (q.isError) {
        const msg = getErrorMessage(q.error, "Failed to fetch quota");
        card = {
          conn,
          loading: false,
          fetching: q.isFetching,
          error: msg,
          authExpired: authExpiredFromError(q.error),
          usage: null,
          quotas: [],
          message: msg,
          resetCredits: 0,
          plan: null,
        };
      } else {
        const usage: ProviderUsage = q.data ?? ({} as ProviderUsage);
        card = {
          conn,
          loading: false,
          fetching: q.isFetching,
          error: null,
          authExpired: isAuthExpired(usage.message),
          usage,
          quotas: parseQuotaData(conn.provider, usage),
          message: usage.message ?? null,
          resetCredits: usage.resetCredits?.availableCount ?? 0,
          plan: usage.plan ?? null,
        };
      }
      const current = grouped.get(conn.provider) ?? [];
      grouped.set(conn.provider, [...current, card]);
    });
    return grouped;
  }, [connections, usageQueries]);

  function flash(msg: string, tone: "success" | "error" | "default" = "default") {
    if (tone === "success") toast.success(msg);
    else if (tone === "error") toast.error(msg);
    else toast(msg);
  }

  async function onRefreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["quota-provider-counts"] }),
      qc.invalidateQueries({ queryKey: ["quota-connections"] }),
      qc.invalidateQueries({ queryKey: ["quota-usage"] }),
    ]);
    flash("Refreshed", "success");
  }

  function onRefreshProvider(provider: string, cards: QuotaCard[]) {
    void Promise.all([
      qc.invalidateQueries({ queryKey: ["quota-connections", provider] }),
      ...cards.map((card) =>
        qc.invalidateQueries({ queryKey: ["quota-usage", card.conn.id] }),
      ),
    ]);
  }

  function onRefreshCard(connectionId: string) {
    void qc.invalidateQueries({ queryKey: ["quota-usage", connectionId] });
  }

  function onLoadMore(provider: string) {
    const loaded = connectionsByProvider.get(provider)?.length ?? 0;
    if (loaded >= QUOTA_MAX_ACCOUNTS_PER_PROVIDER) {
      flash(`Quota view is limited to ${fmtCount(QUOTA_MAX_ACCOUNTS_PER_PROVIDER)} accounts per provider`);
      return;
    }
    setProviderPages((previous) => ({
      ...previous,
      [provider]: (previous[provider] ?? 1) + 1,
    }));
  }

  async function onResetCodex(conn: Connection) {
    if (resettingId) return;
    setResettingId(conn.id);
    try {
      const res = await resetCodexCredits(conn.id);
      if (res.reset === false || res.code === "no_credit") {
        flash(res.message || "No Codex reset credits available", "error");
      } else {
        flash("Codex quota reset", "success");
      }
      await qc.invalidateQueries({ queryKey: ["quota-usage", conn.id] });
    } catch (err) {
      flash(getErrorMessage(err, "Reset failed"), "error");
    } finally {
      setResettingId(null);
    }
  }

  const loadingProviders = providerCountsQ.isLoading;
  const noProviders = !loadingProviders && providerGroups.length === 0;
  const refreshingAll = providerCountsQ.isFetching
    || connectionPageQueries.some((query) => query?.isFetching)
    || usageQueries.some((query) => query?.isFetching);

  return (
    <div className="space-y-4">
      <Header
        title="Quota"
        actions={
          <RippleButton
            size="sm"
            variant="outline"
            disabled={refreshingAll}
            onClick={() => void onRefreshAll()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshingAll && "animate-spin")} />
            Refresh
          </RippleButton>
        }
      />

      {providerCountsQ.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Unable to load live quota providers. Check your session and backend connection.
        </div>
      ) : null}

      {loadingProviders ? (
        <div className="space-y-4">
          {["provider-skeleton-a", "provider-skeleton-b"].map((key) => (
            <Frame key={key}>
              <FrameHeader className="flex flex-row items-center gap-3 p-4">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-44" />
                </div>
              </FrameHeader>
              <FramePanel className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-48 w-full rounded-xl" />
                ))}
              </FramePanel>
            </Frame>
          ))}
        </div>
      ) : noProviders ? (
        <Frame>
          <FramePanel className="p-10 text-center">
            <p className="text-sm font-medium">No providers connected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect an OAuth provider to track API quota limits and usage.
            </p>
          </FramePanel>
        </Frame>
      ) : (
        <div className="space-y-4">
          {providerGroups.map((group) => {
            const cards = cardsByProvider.get(group.provider) ?? [];
            const pageState = pageStateByProvider.get(group.provider) ?? {
              loading: true,
              fetching: false,
              error: false,
              hasNext: false,
              capped: false,
              loaded: 0,
            };
            return (
              <ProviderSection
                key={group.provider}
                group={group}
                cards={cards}
                pageState={pageState}
                onRefreshProvider={() => onRefreshProvider(group.provider, cards)}
                onRefreshCard={onRefreshCard}
                onLoadMore={() => onLoadMore(group.provider)}
                onResetCodex={onResetCodex}
                resettingId={resettingId}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderSection({
  group,
  cards,
  pageState,
  onRefreshProvider,
  onRefreshCard,
  onLoadMore,
  onResetCodex,
  resettingId,
}: {
  group: QuotaProviderGroup;
  cards: QuotaCard[];
  pageState: ProviderPageState;
  onRefreshProvider: () => void;
  onRefreshCard: (connectionId: string) => void;
  onLoadMore: () => void;
  onResetCodex: (conn: Connection) => void;
  resettingId: string | null;
}) {
  return (
    <Frame>
      <FrameHeader className="flex flex-row items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderMark provider={group.provider} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{providerName(group.provider)}</h2>
            <p className="text-[11px] text-muted-foreground">
              {pageState.loaded > 0 ? `${pageState.loaded} of ${fmtCount(group.total)} accounts loaded` : `${fmtCount(group.total)} accounts`}
            </p>
          </div>
        </div>
        <Tooltip label={`Refresh ${providerName(group.provider)} quota`}>
          <button
            type="button"
            onClick={onRefreshProvider}
            disabled={pageState.fetching}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
            aria-label={`Refresh ${providerName(group.provider)} quota`}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", pageState.fetching && "animate-spin")} />
          </button>
        </Tooltip>
      </FrameHeader>

      <FramePanel className="p-3">
        {pageState.error ? (
          <div className="mb-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            Some {providerName(group.provider)} accounts could not be loaded. Refresh this section to retry.
          </div>
        ) : null}
        {pageState.loading && cards.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-48 w-full rounded-xl" />
            ))}
          </div>
        ) : cards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <ProviderCard
                key={card.conn.id}
                card={card}
                onRefresh={() => onRefreshCard(card.conn.id)}
                onResetCodex={() => onResetCodex(card.conn)}
                resetting={resettingId === card.conn.id}
              />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-[11px] text-muted-foreground">
            No accounts available for this provider.
          </div>
        )}
      </FramePanel>

      {pageState.hasNext || pageState.capped ? (
        <FrameFooter className="flex items-center justify-between gap-3 border-t border-border p-3">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {pageState.capped
              ? `Showing ${fmtCount(pageState.loaded)} of ${fmtCount(group.total)} accounts. Quota loading is capped for performance.`
              : `Showing ${fmtCount(pageState.loaded)} of ${fmtCount(group.total)} accounts`}
          </span>
          {pageState.hasNext ? (
            <RippleButton
              size="sm"
              variant="outline"
              onClick={onLoadMore}
              disabled={pageState.fetching}
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {pageState.fetching ? "Loading…" : "Load more"}
            </RippleButton>
          ) : null}
        </FrameFooter>
      ) : null}
    </Frame>
  );
}

function ProviderCard({
  card,
  onRefresh,
  onResetCodex,
  resetting,
}: {
  card: QuotaCard;
  onRefresh: () => void;
  onResetCodex: () => void;
  resetting: boolean;
}) {
  const { conn } = card;
  const [showAllQuotas, setShowAllQuotas] = useState(false);
  const resetTitle = card.authExpired
    ? "Re-authorize the connection first"
    : card.resetCredits <= 0
      ? "No Codex reset credits available"
      : "Spend one Codex reset credit to reset the quota window";
  const visibleQuotas = showAllQuotas
    ? card.quotas
    : card.quotas.slice(0, QUOTA_VISIBLE_ROWS);

  return (
    <Frame className="flex flex-col">
      <FrameHeader className="flex flex-row items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderMark provider={conn.provider} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium leading-tight">
              {conn.name || conn.email || conn.provider}
            </h3>
            <p className="truncate text-[11px] text-muted-foreground">
              {conn.email && conn.name ? conn.email : `Connection ID · ${conn.id}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {quotaStatus(card)}
          <Tooltip label="Refresh quota">
            <button
              type="button"
              onClick={onRefresh}
              disabled={card.fetching}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
              aria-label={card.fetching ? "Refreshing quota" : "Refresh quota"}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", card.fetching && "animate-spin")} />
            </button>
          </Tooltip>
        </div>
      </FrameHeader>

      <FramePanel className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {card.plan ? (
          <Badge variant="outline" className="w-fit text-[10px]">
            {card.plan}
          </Badge>
        ) : null}

        <div className="min-h-[3.5rem] flex-1">
          {card.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-1.5 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : card.authExpired ? (
            <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2">
              <p className="text-xs font-medium text-warning">Authentication expired</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {card.message || card.error}
              </p>
              <Link
                to="/dashboard/provider"
                className="mt-1.5 inline-block text-[11px] font-medium text-warning underline underline-offset-2"
              >
                Re-authorize in Providers
              </Link>
            </div>
          ) : card.error ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2">
              <p className="text-xs font-medium text-destructive">Failed to load quota</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{card.error}</p>
            </div>
          ) : card.quotas.length > 0 ? (
            <div className="space-y-3">
              {card.message ? (
                <p className="text-[11px] text-muted-foreground">{card.message}</p>
              ) : null}
              {visibleQuotas.map((q) => (
                <QuotaRow key={`${q.name}-${q.unit ?? ""}`} quota={q} />
              ))}
              {card.quotas.length > QUOTA_VISIBLE_ROWS ? (
                <button
                  type="button"
                  onClick={() => setShowAllQuotas((value) => !value)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", showAllQuotas && "rotate-180")} />
                  {showAllQuotas ? "Show less" : `Show ${card.quotas.length - QUOTA_VISIBLE_ROWS} more`}
                </button>
              ) : null}
            </div>
          ) : card.message ? (
            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
              {card.message}
            </div>
          ) : (
            <div className="py-6 text-center text-[11px] text-muted-foreground">
              No quota data available
            </div>
          )}
        </div>
      </FramePanel>

      {conn.provider === "codex" ? (
        <FrameFooter className="flex items-center justify-between gap-2 border-t border-border p-4">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {card.resetCredits} reset credit{card.resetCredits === 1 ? "" : "s"}
          </span>
          <Tooltip label={resetTitle}>
            <RippleButton
              size="sm"
              variant="outline"
              onClick={onResetCodex}
              disabled={card.resetCredits <= 0 || card.authExpired || resetting || card.loading}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {resetting ? "Resetting…" : "Reset quota"}
            </RippleButton>
          </Tooltip>
        </FrameFooter>
      ) : null}
    </Frame>
  );
}

function QuotaRow({ quota }: { quota: NormalizedQuota }) {
  const colors = getColorClasses(quota.remaining);
  const countdown = formatResetTime(quota.resetAt);
  const resetWord = quota.recurring ? "Reset" : "Expires";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium">{quota.name}</span>
        <span className={cn("shrink-0 text-xs font-medium tabular-nums", colors.text)}>
          {quota.remaining}%
        </span>
      </div>
      {quota.unlimited ? (
        <p className="text-[11px] text-muted-foreground">Unlimited</p>
      ) : (
        <>
          <div className={cn("h-1.5 overflow-hidden rounded-full", colors.bgLight)}>
            <div
              className={cn("h-full rounded-full transition-all duration-300", colors.bg)}
              style={{ width: `${Math.min(quota.remaining, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="tabular-nums">
              {fmtCount(quota.used)} / {quota.total > 0 ? fmtCount(quota.total) : "∞"}
            </span>
            {countdown ? (
              <span className="tabular-nums">
                {resetWord} in {countdown}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
