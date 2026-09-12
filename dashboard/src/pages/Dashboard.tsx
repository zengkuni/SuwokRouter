import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/Header";
import { SlidingNumber } from "@/components/animate/sliding-number";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/ui/frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchUsageHeatmap,
  fetchUsageHistory,
  fetchUsageStats,
  type UsageHeatmapPoint,
  type UsageRow,
} from "@/lib/api";
import { listNodes } from "@/lib/admin-extras-api";
import { providerName } from "@/lib/providers";
import { probeEnabled } from "@/lib/live-mode";
import { useUsageStore } from "@/stores/usageStore";
import { getCacheDisplay } from "@/lib/cache-display";
import { cn } from "@/lib/utils";
import { useUsageRealtime } from "@/lib/usage-realtime";
import { fetchCurrencySettings } from "@/lib/currency-api";
import {
  FALLBACK_USD_TO_IDR,
  formatCostFromUsd,
  normalizeCurrency,
  usdToDisplay,
} from "@/lib/currency";

type DashboardRange = "today" | "7d" | "30d" | "90d" | "1y";

const RANGE_OPTS: { value: DashboardRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "1y" },
];

function historyLimit(range: DashboardRange) {
  switch (range) {
    case "today":
      return 100;
    case "7d":
      return 250;
    case "30d":
      return 400;
    case "90d":
      return 500;
    case "1y":
      return 500;
    default:
      return 200;
  }
}

function fmtTokens(n: number) {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("id-ID");
}

function fmtCount(n: number) {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("id-ID");
}

function modelSlug(model?: string) {
  const value = model?.trim();
  if (!value) return "—";
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function statusDot(row: UsageRow): string {
  if (row.status === "ok" || row.status === "success") return "bg-emerald-500";
  if (row.status === "error" || row.error) return "bg-red-500";
  if (row.status === "pending" || row.status === "processing")
    return "bg-amber-500";
  return "bg-muted-foreground/64";
}

function statusLabel(row: UsageRow): string {
  if (row.status) return row.status.toUpperCase();
  if (row.error) return "ERROR";
  return "—";
}

function fmtTime(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtRelativeTime(iso?: string, now = Date.now()) {
  if (!iso) return "—";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return fmtTime(iso);

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 1) return "now";
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  return fmtTime(iso);
}

function heatmapLevel(
  requests: number,
  maxRequests: number,
  tokens: number,
  maxTokens: number,
) {
  const requestRatio = Math.min(Math.max(requests / maxRequests, 0), 1);
  const tokenRatio = maxTokens > 0
    ? Math.min(Math.max(tokens / maxTokens, 0), 1)
    : requestRatio;
  const activityRatio = (requestRatio + tokenRatio) / 2;

  if (activityRatio <= 0) return "bg-muted/45";
  if (activityRatio <= 0.25) return "bg-primary/30";
  if (activityRatio <= 0.5) return "bg-primary/55";
  if (activityRatio <= 0.75) return "bg-primary/80";
  return "bg-primary";
}

function formatHeatmapDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function shiftHeatmapDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function emptyHeatmapPoint(date: string): UsageHeatmapPoint {
  return {
    date,
    key: date,
    requests: 0,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cost: 0,
    errors: 0,
  };
}

function dailyHeatmapTooltipText(point: UsageHeatmapPoint) {
  return `${formatHeatmapDate(point.date)} · ${fmtCount(point.requests)} requests · ${fmtTokens(point.tokens)} total tokens`;
}

function dailyHeatmapTooltip(point: UsageHeatmapPoint) {
  return (
    <div className="min-w-40 space-y-2">
      <div>
        <div className="font-semibold">{formatHeatmapDate(point.date)}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {fmtCount(point.requests)} requests
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/70 pt-1.5 text-[11px]">
        <span className="text-muted-foreground">Total tokens</span>
        <span className="text-right font-semibold tabular-nums">{fmtTokens(point.tokens)}</span>
      </div>
    </div>
  );
}

function HeatmapScroller({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [scrollState, setScrollState] = useState({ ratio: 1, progress: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const updateScrollState = (element: HTMLDivElement) => {
    const scrollWidth = element.scrollWidth;
    const viewportWidth = element.clientWidth;
    const maxScroll = Math.max(scrollWidth - viewportWidth, 0);
    const ratio = scrollWidth > 0 ? Math.min(viewportWidth / scrollWidth, 1) : 1;
    const progress = maxScroll > 0 ? Math.min(Math.max(element.scrollLeft / maxScroll, 0), 1) : 0;
    setScrollState({ ratio, progress });
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const measure = () => updateScrollState(viewport);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const moveToPointer = (clientX: number) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const scrollWidth = viewport.scrollWidth;
    const viewportWidth = viewport.clientWidth;
    const maxScroll = Math.max(scrollWidth - viewportWidth, 0);
    if (!maxScroll) return;

    const trackWidth = track.clientWidth;
    const thumbRatio = Math.min(viewportWidth / scrollWidth, 1);
    const thumbWidth = trackWidth * thumbRatio;
    const maxThumbLeft = trackWidth - thumbWidth;
    if (!maxThumbLeft) return;

    const nextThumbLeft = Math.min(
      Math.max(clientX - track.getBoundingClientRect().left - thumbWidth / 2, 0),
      maxThumbLeft,
    );
    viewport.scrollLeft = (nextThumbLeft / maxThumbLeft) * maxScroll;
  };

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    moveToPointer(event.clientX);
  };

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) moveToPointer(event.clientX);
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const maxScroll = Math.max(viewport.scrollWidth - viewport.clientWidth, 0);
    if (!maxScroll) return;

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const normalizedDelta = event.deltaMode === 1 ? delta * 16 : delta;
    const nextScrollLeft = Math.min(Math.max(viewport.scrollLeft + normalizedDelta, 0), maxScroll);
    if (nextScrollLeft === viewport.scrollLeft) return;

    event.preventDefault();
    viewport.scrollLeft = nextScrollLeft;
  };

  return (
    <div className="min-w-0">
      <div
        ref={viewportRef}
        id="router-activity-heatmap"
        data-custom-scrollbar="true"
        className="w-full min-w-0 max-w-full touch-pan-x overflow-x-auto overscroll-x-contain pb-1"
        onScroll={(event) => updateScrollState(event.currentTarget)}
        onWheel={handleWheel}
      >
        {children}
      </div>
      {scrollState.ratio < 1 ? (
        <div
          ref={trackRef}
          role="scrollbar"
          aria-label="Router activity horizontal scroll"
          aria-controls="router-activity-heatmap"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(scrollState.progress * 100)}
          aria-orientation="horizontal"
          tabIndex={0}
          className={cn(
            "relative mt-1.5 h-1.5 w-full cursor-grab touch-none select-none rounded-full active:cursor-grabbing",
            isDragging ? "bg-foreground/10" : "bg-foreground/5",
          )}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onKeyDown={(event) => {
            const viewport = viewportRef.current;
            if (!viewport) return;
            const maxScroll = viewport.scrollWidth - viewport.clientWidth;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              viewport.scrollLeft += event.key === "ArrowLeft" ? -96 : 96;
            } else if (event.key === "Home") {
              event.preventDefault();
              viewport.scrollLeft = 0;
            } else if (event.key === "End") {
              event.preventDefault();
              viewport.scrollLeft = maxScroll;
            }
          }}
        >
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              isDragging ? "bg-foreground/20" : "bg-foreground/10",
            )}
            style={{
              width: `${scrollState.ratio * 100}%`,
              left: `${scrollState.progress * (1 - scrollState.ratio) * 100}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

type HeatmapColumn = {
  monthLabel: string;
  cells: UsageHeatmapPoint[];
};

const HEATMAP_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function Stat({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Frame
      className="h-full min-w-0 w-full rounded-xl p-0.5 sm:rounded-2xl sm:p-1"
    >
      <FramePanel className="h-full min-w-0 rounded-lg p-2 sm:rounded-xl sm:p-4">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1 sm:block">
          <FrameTitle className="min-w-0 truncate text-[10px] font-medium leading-tight text-muted-foreground sm:min-h-0 sm:text-[13px]">
            {label}
          </FrameTitle>
          <div className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold leading-none tracking-tight tabular-nums sm:mt-2 sm:text-[1.5rem]">
            {loading ? <Skeleton className="h-6 w-16 sm:h-7 sm:w-20" /> : value}
          </div>
        </div>
        {detail ? (
          <div className="mt-1 min-h-4 min-w-0 text-[10px] leading-tight text-muted-foreground sm:mt-2 sm:min-h-0 sm:text-[12px]">
            {detail}
          </div>
        ) : null}
      </FramePanel>
    </Frame>
  );
}

export default function Dashboard() {
  const setStats = useUsageStore((s) => s.setStats);

  const [statsRange, setStatsRange] = useState<DashboardRange>("today");
  const [providerColumnHidden, setProviderColumnHidden] = useState(false);
  const [modelColumnHidden, setModelColumnHidden] = useState(false);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());

  useUsageRealtime();

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const statsQ = useQuery({
    queryKey: ["usage-stats", statsRange],
    queryFn: () => fetchUsageStats({ range: statsRange }),
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
  const heatmapQ = useQuery({
    queryKey: ["usage-heatmap", "year"],
    queryFn: () => fetchUsageHeatmap("year"),
    enabled: probeEnabled(),
    retry: false,
  });
  const historyQ = useQuery({
    queryKey: ["usage-history", statsRange, historyLimit(statsRange)],
    queryFn: () =>
      fetchUsageHistory({ limit: historyLimit(statsRange), range: statsRange }),
    enabled: probeEnabled(),
    retry: false,
  });

  const nodesQ = useQuery({
    queryKey: ["nodes"],
    queryFn: listNodes,
    enabled: probeEnabled(),
    retry: false,
  });

  const stats = statsQ.data;
  const history: UsageRow[] = historyQ.data ?? [];
  const loading = statsQ.isLoading;
  const historyLoading = historyQ.isLoading;
  const heatmapLoading = heatmapQ.isLoading;
  const displayCurrency = normalizeCurrency(currencyQ.data?.currency);
  const usdToIdrRate = currencyQ.data?.usdToIdr ?? FALLBACK_USD_TO_IDR;
  const totalCostUsd = stats?.totalCost ?? 0;
  const displayCost = formatCostFromUsd(totalCostUsd, displayCurrency, usdToIdrRate);

  useEffect(() => {
    if (stats) {
      setStats({
        total: stats.total ?? 0,
        totalCost: stats.totalCost ?? 0,
        byProvider: stats.byProvider ?? {},
      });
    }
  }, [stats, setStats]);

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

  const recent = useMemo(() => history.slice(0, 8), [history]);

  const avgLatency = useMemo(() => {
    const vals = history
      .map((r) => r.latencyMs)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [history]);

  const latencyDisplay = useMemo(() => {
    if (avgLatency === null) return null;
    if (avgLatency < 1000) return { value: avgLatency, unit: "ms" };

    return {
      value: Number((avgLatency / 1000).toFixed(1)),
      unit: "s",
    };
  }, [avgLatency]);

  const heatmap = heatmapQ.data ?? [];

  const heatmapMaxRequests = useMemo(
    () => Math.max(...heatmap.map((point) => point.requests), 1),
    [heatmap],
  );
  const heatmapMaxTokens = useMemo(
    () => Math.max(...heatmap.map((point) => point.tokens), 1),
    [heatmap],
  );

  const heatmapColumns = useMemo<HeatmapColumn[]>(() => {
    if (!heatmap.length) return [];

    const firstDate = new Date(`${heatmap[0].date}T12:00:00`);
    const firstDateKey = heatmap[0].date;
    const leadingEmptyDays = Number.isNaN(firstDate.getTime())
      ? 0
      : (firstDate.getDay() + 6) % 7;
    const cells: UsageHeatmapPoint[] = [
      ...Array.from({ length: leadingEmptyDays }, (_, index) =>
        emptyHeatmapPoint(shiftHeatmapDate(firstDateKey, index - leadingEmptyDays)),
      ),
      ...heatmap,
    ];
    const lastDate = heatmap[heatmap.length - 1]?.date || firstDateKey;
    while (cells.length % 7 !== 0) {
      const trailingOffset = cells.length - leadingEmptyDays - heatmap.length + 1;
      cells.push(emptyHeatmapPoint(shiftHeatmapDate(lastDate, trailingOffset)));
    }

    const actualDateKeys = new Set(heatmap.map((point) => point.date));
    let previousMonth = "";
    const columns: HeatmapColumn[] = [];
    for (let index = 0; index < cells.length; index += 7) {
      const columnCells = cells.slice(index, index + 7);
      const firstCell = columnCells.find((cell) => actualDateKeys.has(cell.date)) || columnCells[0];
      const monthKey = firstCell?.date.slice(0, 7) || "";
      const monthLabel = firstCell && monthKey !== previousMonth
        ? new Date(`${firstCell.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })
        : "";
      if (monthKey) previousMonth = monthKey;
      columns.push({ monthLabel, cells: columnCells });
    }
    return columns;
  }, [heatmap]);

  return (

    <div className="flex w-full flex-col gap-2.5 pb-6 lg:h-full lg:min-h-0 lg:overflow-hidden lg:pb-0">
      <Header
        className="mb-0 sm:mb-0 shrink-0 gap-2 sm:items-end"
        title="Dashboard"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[16rem] sm:min-w-[18rem]">
              <Segmented
                size="sm"
                value={statsRange}
                onChange={setStatsRange}
                options={RANGE_OPTS}
                className="w-full"
              />
            </div>
          </div>
        }
      />

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4">
        <Stat
          label="Requests"
          loading={loading}
          value={<SlidingNumber value={stats?.total ?? 0} decimals={0} />}
        />
        <Stat
          label="Total Tokens"
          loading={loading}
          value={
            <span className="tabular-nums">
              {fmtTokens(
                (stats?.totalPromptTokens ?? 0) +
                  (stats?.totalCompletionTokens ?? 0),
              )}
            </span>
          }
        />
        <Stat
          label={`Cost (${displayCurrency})`}
          loading={loading}
          value={
            <Tooltip label={displayCost}>
              <span
                className="block min-w-0 max-w-full truncate"
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
          }
        />
        <Stat
          label="Latency"
          loading={loading}
          value={
            latencyDisplay !== null ? (
              <SlidingNumber
                value={latencyDisplay.value}
                decimals={latencyDisplay.unit === "s" ? 1 : 0}
                suffix={` ${latencyDisplay.unit}`}
              />
            ) : "—"
          }
        />
      </div>

      <div className="w-full min-w-0">
      <Frame className="flex min-w-0 shrink-0 flex-col overflow-hidden">
        <FrameHeader className="gap-3 border-b border-border/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <FrameTitle className="text-[15px] font-medium tracking-tight">
                Router Activity
              </FrameTitle>
            </div>
          </div>
        </FrameHeader>

        <FramePanel className="flex min-w-0 flex-col overflow-hidden">
          <div className="mb-1 flex shrink-0 flex-wrap items-center justify-end gap-2">
            <div className="inline-flex items-center gap-2 text-[10px] text-muted-foreground" aria-label="Activity intensity: less to more">
              <span>Less</span>
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="size-3 rounded-[3px] border border-border/40 bg-muted/45" />
                <span className="size-3 rounded-[3px] border border-border/40 bg-primary/30" />
                <span className="size-3 rounded-[3px] border border-border/40 bg-primary/55" />
                <span className="size-3 rounded-[3px] border border-border/40 bg-primary/80" />
                <span className="size-3 rounded-[3px] border border-border/40 bg-primary" />
              </span>
              <span>More</span>
            </div>
          </div>

          <div>
            {heatmapLoading ? (
              <Skeleton className="h-56 w-full rounded-xl" />
            ) : (
              <div className="min-w-0 rounded-xl border border-border/70 bg-background/25 p-2.5 sm:p-3">
                <HeatmapScroller>
                  <div
                    className="grid w-max min-w-full grid-cols-[2.75rem_max-content] items-start 2xl:w-full 2xl:grid-cols-[2.75rem_minmax(0,1fr)]"
                    style={{
                      columnGap: "0.25rem",
                    }}
                  >
                    <div className="sticky left-0 z-10 grid h-max w-[calc(100%+0.25rem)] grid-rows-[1rem_repeat(7,1rem)] gap-y-2 bg-background">
                      <span className="h-4" aria-hidden="true" />
                      {HEATMAP_WEEKDAYS.map((weekday) => (
                        <span
                          key={weekday}
                          className="h-4 whitespace-nowrap pr-1 text-left font-sans font-semibold text-[9px] tabular-nums text-muted-foreground"
                        >
                          {weekday}
                        </span>
                      ))}
                    </div>
                    <div
                      className="grid w-max grid-cols-[repeat(var(--heatmap-columns),1.25rem)] items-center justify-items-center gap-x-1 gap-y-2 2xl:w-full 2xl:grid-cols-[repeat(var(--heatmap-columns),minmax(0,1fr))]"
                      style={{ "--heatmap-columns": heatmapColumns.length } as React.CSSProperties}
                    >
                      {heatmapColumns.map((column, index) => (
                        <span
                          key={`${column.monthLabel}-${index}`}
                          className="flex h-4 items-end justify-center font-sans font-semibold text-[9px] tabular-nums text-muted-foreground"
                        >
                          {column.monthLabel}
                        </span>
                      ))}
                      {HEATMAP_WEEKDAYS.map((weekday, weekdayIndex) => (
                        <Fragment key={weekday}>
                          {heatmapColumns.map((column, columnIndex) => {
                            const point = column.cells[weekdayIndex];
                            const hasActivity = point.requests > 0;
                            const label = hasActivity
                              ? dailyHeatmapTooltipText(point)
                              : "No activity on this day";
                            return (
                              <Tooltip
                                key={`${columnIndex}-${weekdayIndex}`}
                                label={hasActivity ? dailyHeatmapTooltip(point) : label}
                              >
                                <span
                                  role="img"
                                  aria-label={label}
                                  className={cn(
                                    "size-4 rounded-[3px] border border-border/40",
                                    heatmapLevel(
                                      point?.requests || 0,
                                      heatmapMaxRequests,
                                      point?.tokens || 0,
                                      heatmapMaxTokens,
                                    ),
                                  )}
                                />
                              </Tooltip>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </HeatmapScroller>
              </div>
            )}
          </div>
        </FramePanel>
      </Frame>
      </div>

      <Frame className="flex min-h-[240px] w-full flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        <FrameHeader className="border-b border-border/80">
          <FrameTitle className="text-[15px]">Recent requests</FrameTitle>
        </FrameHeader>

        <div className="min-h-0 flex-1 pb-1">
          <ScrollArea overscrollContain className="h-full">
            <div className="w-full min-w-0 divide-y divide-border/70 rounded-xl border border-border/70 bg-card sm:hidden">
              {historyLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="px-3 py-3">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="mt-2 h-3 w-full" />
                  </div>
                ))
              ) : historyQ.isError ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                  <span>Unable to load recent requests.</span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => void historyQ.refetch()}
                  >
                    <RefreshCw aria-hidden />
                    Retry
                  </Button>
                </div>
              ) : recent.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No requests yet
                </div>
              ) : (
                recent.map((row, i) => {
                  const cache = getCacheDisplay(row);
                  return (
                    <article
                      key={row.id ?? `${row.timestamp}-${i}`}
                      className="flex min-w-0 items-center gap-2.5 px-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className={cn(
                            "min-w-0 flex-1 truncate text-xs font-medium",
                            providerColumnHidden && "font-normal italic text-muted-foreground",
                          )}>
                            {providerColumnHidden ? "Hidden" : providerLabel(row.provider)}
                          </p>
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                            <span aria-hidden="true" className={cn("size-1.5 rounded-full", statusDot(row))} />
                            {statusLabel(row)}
                          </Badge>
                        </div>
                        <p className="mt-0.5 max-w-full truncate font-mono text-[11px] text-muted-foreground">
                          {modelColumnHidden ? modelSlug(row.model) : row.model || "—"}
                        </p>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[10px] tabular-nums text-muted-foreground">
                          <Tooltip label={fmtTime(row.timestamp)}>
                            <span className="shrink-0">{fmtRelativeTime(row.timestamp, relativeNow)}</span>
                          </Tooltip>
                          <span aria-hidden="true">·</span>
                          <span className="shrink-0 text-success">In {fmtTokens(row.promptTokens || 0)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="shrink-0 text-destructive">Out {fmtTokens(row.completionTokens || 0)}</span>
                          <span aria-hidden="true">·</span>
                          <Tooltip label={cache.title}>
                            <span className={cn("shrink-0", cache.hit ? "text-warning" : "text-muted-foreground")}>
                              {cache.label}
                            </span>
                          </Tooltip>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="hidden sm:block">
            <Table variant="card" className="min-w-[32rem] text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5 py-2.5">Time</TableHead>
                  <TableHead className="px-3 py-2.5">
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
                  <TableHead className="px-3 py-2.5">
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
                  <TableHead className="px-3 py-2.5 text-success">In</TableHead>
                  <TableHead className="px-3 py-2.5 text-destructive">
                    Out
                  </TableHead>
                  <TableHead className="px-3 py-2.5">Cache</TableHead>
                  <TableHead className="px-5 py-2.5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7} className="px-5 py-3">
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : historyQ.isError ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="px-5 py-10 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span>Unable to load recent requests.</span>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => void historyQ.refetch()}
                        >
                          <RefreshCw aria-hidden />
                          Retry
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : recent.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="px-5 py-12 text-center text-muted-foreground"
                    >
                      No requests yet
                    </TableCell>
                  </TableRow>
                ) : (
                  recent.map((row, i) => (
                    <TableRow key={row.id ?? `${row.timestamp}-${i}`}>
                      <TableCell className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                        <Tooltip label={fmtTime(row.timestamp)}>
                          <span>{fmtRelativeTime(row.timestamp, relativeNow)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2.5 font-medium">
                        {(() => {
                          const providerName = providerLabel(row.provider);
                          return (
                            <span
                              className={cn(
                                "truncate",
                                providerColumnHidden && "font-normal italic text-muted-foreground"
                              )}
                            >
                              {providerColumnHidden ? "Hidden" : providerName}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2.5">
                        {(() => {
                          const modelName = row.model || "—";
                          return (
                            <span className="block min-w-0 truncate font-mono text-[12px] text-muted-foreground">
                              {modelColumnHidden ? modelSlug(row.model) : modelName}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 tabular-nums text-success">
                          <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                          {fmtTokens(row.promptTokens || 0)}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 tabular-nums text-destructive">
                          <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                          {fmtTokens(row.completionTokens || 0)}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2.5">
                        {(() => {
                          const cache = getCacheDisplay(row);
                          return (
                            <Tooltip label={cache.title}>
                              <span
                                className={cn(
                                  "text-[11px] font-medium tabular-nums",
                                  cache.hit ? "text-warning" : "text-muted-foreground"
                                )}
                              >
                                {cache.label}
                              </span>
                            </Tooltip>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-5 py-2.5">
                        <Badge variant="outline" className="font-normal">
                          <span
                            aria-hidden="true"
                            className={cn("size-1.5 rounded-full", statusDot(row))}
                          />
                          {statusLabel(row)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </ScrollArea>
        </div>
      </Frame>
    </div>
  );
}
