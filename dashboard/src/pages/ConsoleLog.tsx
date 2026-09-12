import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Copy,
  Search,
  Trash2,
  WrapText,
} from "lucide-react";
import { Header } from "@/components/Header";
import { StatusDot } from "@/components/animate/status-dot";
import { RippleButton } from "@/components/animate/ripple-button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Frame, FrameHeader, FramePanel } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { api, getErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { displayConsoleSource, humanizeConsoleLogMessage } from "@/lib/console-log-format";

const MAX_LINES = 1000;
const LEVELS = ["LOG", "INFO", "SUCCESS", "WARN", "ERROR", "DEBUG"] as const;
type LogLevel = (typeof LEVELS)[number];
type FilterLevel = LogLevel | "all";
type LogEntry = { line: string; ts: number };

type ConsoleEvent =
  | { type: "init"; entries: Array<{ line: string; ts: number }> }
  | { type: "line"; line: string; ts?: number }
  | { type: "lines"; lines: string[] | Array<{ line: string; ts: number }> }
  | { type: "clear" };

const LEVEL_TAG_RE = /^\s*\[([A-Za-z]+)\]/;
const LEVEL_WORD_RE = /^\s*([A-Za-z]+)\b/;
const ERROR_MARKER_RE = /(?:\bERROR\b|\b(?:Reference|Type|Syntax|Range|URI)Error\b|\b(?:Error|Exception):|\bstatus\s*[=:]\s*5\d\d\b|\bHTTP\s+5\d\d\b)/i;
const WARN_MARKER_RE = /(?:\bWARN(?:ING)?\b|\bstatus\s*[=:]\s*4\d\d\b|\bHTTP\s+4\d\d\b)/i;
const SUCCESS_MARKER_RE = /(?:\b(?:HTTP\s*)?2\d\d\b|\bstatus\s*[=:]\s*2\d\d\b|\b(?:OK|SUCCESS|PASSED|HEALTHY)\b)/i;
const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}�️‍]/gu;
const PRIVATE_DATABASE_PATH_RE = /(?:[A-Za-z]:[\\/]|\/)[^|]*?\.swayrouter[\\/]+db[\\/]+data\.sqlite/gi;
const EVENT_LABEL_RE = /^(?:(\w[\w-]*)\s+)?(START|FETCH|RESPONSE|RETRY|DONE|WARN|ERROR|FALLBACK|LOCK|REQUEST|STREAM)\s+([\s\S]+)$/i;
const DEBUG_EVENT_RE = /^(?:(\w[\w-]*)\s+)?DEBUG\s+([A-Z][A-Z0-9_-]*)\s*(?:·\s*)?([\s\S]*)$/i;

function normalizeLogLine(line: string): string {
  return line
    .split(/\r?\n/)
    .map((part) => part.replace(/[ \t]+/g, " ").trimEnd())
    .filter((part, index, parts) => part.length > 0 || index < parts.length - 1)
    .join("\n")
    .trim();
}

function cleanRawLine(line: string): string {
  return normalizeLogLine(
    line
      .replace(EMOJI_RE, "")
      .replace(PRIVATE_DATABASE_PATH_RE, ".swayrouter\\db\\data.sqlite")
      .replace(/^\s*\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, "")
  );
}

function stripLevelTag(line: string): string {
  const tag = line.match(/^\s*\[(?:LOG|INFO|WARN|ERROR|DEBUG)\]\s*/i);
  if (tag) return line.slice(tag[0].length);
  const word = line.match(/^\s*(?:LOG|INFO|WARN|ERROR|DEBUG)\b\s*/i);
  return word ? line.slice(word[0].length) : line;
}

function parseEventLabel(line: string): { tag: string | null; label: string; message: string } | null {
  const value = stripLevelTag(line).trim();
  const debugMatch = value.match(DEBUG_EVENT_RE);
  if (debugMatch) {
    return {
      tag: debugMatch[1] ?? null,
      label: debugMatch[2].toUpperCase(),
      message: debugMatch[3].trim(),
    };
  }

  const match = value.match(EVENT_LABEL_RE);
  if (!match) return null;
  return {
    tag: match[1] ?? null,
    label: match[2].toUpperCase(),
    message: match[3],
  };
}

function formatPayload(message: string): string {
  const normalized = normalizeLogLine(message);
  const match = normalized.match(/^(.*?)(?:\s+)(\{[\s\S]*\})$/);
  if (!match) return normalized;

  try {
    const payload = JSON.parse(match[2]) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return normalized;
    const fields = Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      if (typeof value === "string") return `${key}=${value}`;
      if (value === null) return `${key}=null`;
      try {
        return `${key}=${JSON.stringify(value)}`;
      } catch {
        return `${key}=${String(value)}`;
      }
    });
    return fields.length ? `${match[1].trim()} · ${fields.join(" · ")}` : match[1].trim();
  } catch {
    return normalized;
  }
}

function parseLevel(line: string): LogLevel {
  const event = parseEventLabel(line);
  if (ERROR_MARKER_RE.test(line)) return "ERROR";
  if (SUCCESS_MARKER_RE.test(line) || event?.label === "DONE") return "SUCCESS";

  const tag = line.match(LEVEL_TAG_RE);
  const raw = tag ? tag[1] : (line.match(LEVEL_WORD_RE)?.[1] ?? "");
  const upper = raw.toUpperCase();
  if (LEVELS.includes(upper as LogLevel)) return upper as LogLevel;
  if (/^(?:\w[\w-]*\s+)?DEBUG\b/i.test(stripLevelTag(line).trim())) return "DEBUG";
  if (event) {
    if (event.label === "ERROR") return "ERROR";
    if (["WARN", "RETRY", "FALLBACK"].includes(event.label)) return "WARN";
    return "INFO";
  }
  if (ERROR_MARKER_RE.test(line)) return "ERROR";
  if (WARN_MARKER_RE.test(line)) return "WARN";
  return "LOG";
}

function parseSource(line: string): string {
  const event = parseEventLabel(line);
  if (event) return event.label;
  const source = stripLevelTag(line).match(/^\s*(?:\[([^\]]+)\]\s*)+/)?.[1];
  return source ? source.trim().slice(0, 32) : "runtime";
}

function displaySource(source: string): string {
  return displayConsoleSource(source);
}

function displayMessage(line: string): string {
  const event = parseEventLabel(line);
  if (event) {
    return humanizeConsoleLogMessage(formatPayload(event.message), {
      label: event.label,
      source: event.label,
    });
  }
  const withoutLevel = stripLevelTag(line);
  const source = withoutLevel.match(/^\s*(?:\[([^\]]+)\]\s*)+/)?.[1] || "";
  const message = withoutLevel.replace(/^\s*(?:\[[^\]]+\]\s*)+/, "");
  return humanizeConsoleLogMessage(
    formatPayload(message),
    { source },
  );
}

function capLogs(entries: LogEntry[]): LogEntry[] {
  return entries.length > MAX_LINES ? entries.slice(-MAX_LINES) : entries;
}

function toEntries(lines: string[]): LogEntry[] {
  const ts = Date.now();
  return lines.map((line) => ({ line, ts }));
}

function toTimedEntries(entries: Array<{ line: string; ts: number }>): LogEntry[] {
  const fallbackTs = Date.now();
  return entries
    .filter((entry) => typeof entry?.line === "string")
    .map((entry) => ({
      line: entry.line,
      ts: entry.ts > 0 && Number.isFinite(entry.ts) ? entry.ts : fallbackTs,
    }));
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function levelDotClass(level: LogLevel): string {
  switch (level) {
    case "SUCCESS":
      return "bg-success";
    case "ERROR":
      return "bg-destructive";
    case "WARN":
      return "bg-warning";
    case "INFO":
      return "bg-info";
    case "DEBUG":
      return "bg-debug";
    default:
      return "bg-muted-foreground/55";
  }
}

function levelBadgeVariant(level: LogLevel) {
  switch (level) {
    case "SUCCESS":
      return "success" as const;
    case "ERROR":
      return "error" as const;
    case "WARN":
      return "warning" as const;
    case "INFO":
      return "info" as const;
    case "DEBUG":
      return "debug" as const;
    default:
      return "outline" as const;
  }
}

function LevelFilter({
  label,
  value,
  count,
  active,
  onClick,
}: {
  label: string;
  value: FilterLevel;
  count: number;
  active: boolean;
  onClick: (value: FilterLevel) => void;
}) {
  const level = value === "all" ? null : value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onClick(value)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "border-border bg-white/[0.08] text-foreground"
          : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-white/[0.04] hover:text-foreground"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          level ? levelDotClass(level) : "bg-foreground/80"
        )}
      />
      <span>{label}</span>
      <span className="tabular-nums text-[11px] text-muted-foreground">{count}</span>
    </button>
  );
}

export default function ConsoleLog() {
  const [connected, setConnected] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [activeLevel, setActiveLevel] = useState<FilterLevel>("all");
  const [wrapped, setWrapped] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let lastActivityAt = 0;
    const keepaliveMs = 25000;
    const watchdogMs = keepaliveMs * 2 + 5000;

    const clearWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = null;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      const jitter = Math.floor(Math.random() * Math.min(500, retryDelay / 2));
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, retryDelay + jitter);
      retryDelay = Math.min(retryDelay * 2, 10000);
    };

    const scheduleWatchdog = () => {
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        if (disposed || !eventSource) return;
        if (Date.now() - lastActivityAt < watchdogMs) {
          scheduleWatchdog();
          return;
        }
        eventSource.close();
        eventSource = null;
        setConnected(false);
        scheduleRetry();
      }, watchdogMs);
    };

    const connect = () => {
      if (disposed || eventSource) return;
      const next = new EventSource("/api/translator/console-logs/stream");
      eventSource = next;
      lastActivityAt = Date.now();
      scheduleWatchdog();

      next.onopen = () => {
        if (disposed || eventSource !== next) return;
        retryDelay = 1000;
        lastActivityAt = Date.now();
        setConnected(true);
        scheduleWatchdog();
      };

      next.onerror = () => {
        if (eventSource !== next) return;
        clearWatchdog();
        setConnected(false);
        next.close();
        eventSource = null;
        scheduleRetry();
      };

      next.onmessage = (event) => {
        if (disposed || eventSource !== next) return;
        lastActivityAt = Date.now();
        scheduleWatchdog();

        let message: ConsoleEvent;
        try {
          message = JSON.parse(event.data) as ConsoleEvent;
        } catch {
          return;
        }

        if (message.type === "init") {
          setLogs(capLogs(toTimedEntries(message.entries)));
        } else if (message.type === "line") {
          setLogs((previous) => capLogs([
            ...previous,
            {
              line: message.line,
              ts: typeof message.ts === "number" && Number.isFinite(message.ts)
                ? message.ts
                : Date.now(),
            },
          ]));
        } else if (message.type === "lines") {
          const entries = Array.isArray(message.lines) && typeof message.lines[0] === "object"
            ? toTimedEntries(message.lines as Array<{ line: string; ts: number }>)
            : toEntries(message.lines as string[]);
          setLogs((previous) => capLogs([...previous, ...entries]));
        } else if (message.type === "clear") {
          setLogs([]);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      clearWatchdog();
      eventSource?.close();
      eventSource = null;
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setAutoFollow(distanceFromBottom < 28);
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!autoFollow) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [logs, autoFollow]);

  useEffect(() => () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
  }, []);

  async function onClear() {
    setClearConfirmOpen(false);
    setClearing(true);
    try {
      await api.delete("/translator/console-logs");
      setLogs([]);
      toast.success("Console logs cleared");
    } catch (error) {
      toast.error(getErrorMessage(error, "Clear failed"));
    } finally {
      setClearing(false);
    }
  }

  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = {
      LOG: 0,
      INFO: 0,
      SUCCESS: 0,
      WARN: 0,
      ERROR: 0,
      DEBUG: 0,
    };
    for (const entry of logs) counts[parseLevel(cleanRawLine(entry.line))] += 1;
    return counts;
  }, [logs]);

  const visible = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return logs
      .map(({ line, ts }, index) => {
        const raw = cleanRawLine(line);
        return {
          raw,
          message: displayMessage(raw),
          source: displaySource(parseSource(raw)),
          level: parseLevel(raw),
          ts,
          index,
        };
      })
      .filter(({ level }) => activeLevel === "all" || activeLevel === level)
      .filter(({ raw, message, source }) => (
        !query || `${raw} ${message} ${source}`.toLowerCase().includes(query)
      ));
  }, [activeLevel, deferredSearch, logs]);

  async function copyVisibleLogs() {
    const text = visible
      .map(({ message, source, level, ts }) => `${formatTime(ts)} ${level} ${source} — ${message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      toast.error(getErrorMessage(error, "Copy failed"));
    }
  }

  const shownCount = visible.length;

  return (
    <div className="space-y-4">
      <Header
        title="Console Logs"
        actions={
          <RippleButton
            size="sm"
            variant="outline"
            onClick={() => setClearConfirmOpen(true)}
            disabled={clearing}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {clearing ? "Clearing…" : "Clear"}
          </RippleButton>
        }
      />

      <Frame className="overflow-hidden">
        <FrameHeader className="gap-3 border-b border-border px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={connected ? "active" : "down"} pulse={connected} />
              <span className={cn("text-xs font-medium", connected ? "text-emerald-400" : "text-destructive")}>
                {connected ? "Live" : "Reconnecting"}
              </span>
              <span className="text-xs text-muted-foreground">
                {logs.length.toLocaleString()} {logs.length === 1 ? "event" : "events"}
              </span>
              {shownCount !== logs.length ? (
                <span className="text-xs text-muted-foreground/70">
                  {shownCount.toLocaleString()} shown
                </span>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search logs"
                  aria-label="Search console logs"
                  className="h-8 w-full pl-8 text-xs"
                />
              </div>
              <Tooltip label={wrapped ? "Long lines wrap" : "Long lines scroll horizontally"}>
                <button
                  type="button"
                  aria-pressed={wrapped}
                  onClick={() => setWrapped((value) => !value)}
                  aria-label="Toggle line wrapping"
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-md border transition-colors",
                    wrapped
                      ? "border-border bg-white/[0.08] text-foreground"
                      : "border-border text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  )}
                >
                  <WrapText className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip label={copied ? "Copied" : "Copy visible logs"}>
                <RippleButton
                  size="sm"
                  variant="outline"
                  onClick={() => void copyVisibleLogs()}
                  disabled={visible.length === 0}
                  aria-label="Copy visible logs"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
                </RippleButton>
              </Tooltip>
            </div>
          </div>
        </FrameHeader>

        <FramePanel className="border-b border-border p-2">
          <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Filter logs by level">
            <LevelFilter
              label="All"
              value="all"
              count={logs.length}
              active={activeLevel === "all"}
              onClick={setActiveLevel}
            />
            {LEVELS.map((level) => (
              <LevelFilter
                key={level}
                label={level}
                value={level}
                count={levelCounts[level]}
                active={activeLevel === level}
                onClick={setActiveLevel}
              />
            ))}
          </div>
        </FramePanel>

        <FramePanel className="min-h-0 p-0">
          <ScrollArea
            overscrollContain
            scrollFade
            scrollbarGutter
            viewportRef={viewportRef}
            className="h-[calc(100dvh-285px)] min-h-[24rem]"
          >
            <div className="font-mono text-xs leading-relaxed">
              {visible.length === 0 ? (
                <div className="flex min-h-[20rem] items-center justify-center px-6 text-center">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {logs.length === 0 ? "No logs yet" : "No matching logs"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {logs.length === 0
                        ? "New runtime logs will appear here."
                        : "Try another level or search term."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/45">
                  {visible.map(({ raw, message, source, level, ts, index }) => (
                    <div
                      key={`${index}-${ts}-${raw}`}
                      className={cn(
                        "grid min-w-0 grid-cols-[4rem_3.75rem_5rem_minmax(0,1fr)] items-start gap-x-2 px-3 py-2.5 transition-colors hover:bg-white/[0.035] sm:grid-cols-[4.5rem_4rem_6rem_minmax(0,1fr)] sm:gap-x-3 sm:px-4",
                        level === "ERROR" && "bg-destructive/[0.035]"
                      )}
                    >
                      <span className="pt-1 text-[10px] tabular-nums text-muted-foreground/70">
                        {formatTime(ts)}
                      </span>
                      <Badge variant={levelBadgeVariant(level)} size="sm" className="w-fit font-sans">
                        <span
                          aria-hidden="true"
                          className={cn("mr-1 inline-block size-1.5 rounded-full", levelDotClass(level))}
                        />
                        {level}
                      </Badge>
                      <span
                        className={cn(
                          "min-w-0 pt-1 text-[10px] text-muted-foreground",
                          wrapped
                            ? "break-words whitespace-normal [overflow-wrap:anywhere]"
                            : "overflow-x-auto whitespace-nowrap"
                        )}
                        title={source}
                      >
                        {source}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 text-foreground/90 [overflow-wrap:anywhere]",
                          wrapped
                            ? "whitespace-pre-wrap break-words"
                            : "overflow-x-auto whitespace-pre"
                        )}
                        title={message || raw}
                      >
                        {message || raw}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </FramePanel>
      </Frame>

      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear console logs?</DialogTitle>
            <DialogDescription>
              This removes the current in-memory log buffer. New logs will continue to appear.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton variant="outline" onClick={() => setClearConfirmOpen(false)}>
              Cancel
            </RippleButton>
            <RippleButton variant="destructive" onClick={() => void onClear()}>
              Clear logs
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
