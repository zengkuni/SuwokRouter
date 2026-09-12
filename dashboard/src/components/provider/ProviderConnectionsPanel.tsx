import type { RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { FlipButton } from "@/components/animate/flip-button";
import { StatusBadge } from "@/components/StatusBadge";
import { TestBtn } from "@/components/provider/TestBtn";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { TabsContent } from "@/components/ui/tabs";
import type { ReactVirtualizer } from "@tanstack/react-virtual";
import { type AvailableProvider, type Connection } from "@/lib/connections-api";
import { connectionCtaLabel } from "@/lib/providers-mock";
import { type RotationStrategy } from "@/lib/settings-api";
import { type ThinkingLevel, thinkingLabel } from "@/lib/thinking";
import { cn } from "@/lib/utils";

type ConnectionTestResult = {
  ok: boolean;
  label: string;
  message: string;
  status?: number | string | null;
  detail?: string | null;
};

function formatLastChecked(value?: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type ProviderConnectionsPanelProps = {
  selected: AvailableProvider;
  connsAll: Connection[];
  conns: Connection[];
  strategy: RotationStrategy;
  strategyPending: boolean;
  stickyDraft: string;
  thinkingLevels: ThinkingLevel[] | null;
  thinkingValue: ThinkingLevel;
  thinkingPending: boolean;
  selectedKeys: Set<string>;
  connectionsCapped: boolean;
  totalConnections: number;
  batchKind: "conn" | "model" | null;
  testingConnId: string | null;
  togglingConnId: string | null;
  connQuery: string;
  connListRef: RefObject<HTMLDivElement | null>;
  connVirtualizer: ReactVirtualizer<HTMLDivElement, Element>;
  connResults: Record<string, ConnectionTestResult>;
  onStrategyChange: (value: RotationStrategy) => void | Promise<void>;
  onStickyDraftChange: (value: string) => void;
  onSaveSticky: () => void | Promise<void>;
  onThinkingChange: (value: ThinkingLevel) => void | Promise<void>;
  onRequestBulkDelete: () => void;
  onClearSelection: () => void;
  onToggleSelection: (id: string) => void;
  onSelectAll: () => void;
  onTestConnections: (ids: string[]) => void | Promise<void>;
  onTestConnection: (id: string) => void | Promise<void>;
  onStopTests: () => void;
  onConnQueryChange: (value: string) => void;
  onOpenAddConnection: () => void;
  onMovePriority: (id: string, direction: -1 | 1) => void | Promise<void>;
  onToggleConnection: (id: string) => void | Promise<void>;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (id: string) => void;
};

export function ProviderConnectionsPanel({
  selected,
  connsAll,
  conns,
  strategy,
  strategyPending,
  stickyDraft,
  thinkingLevels,
  thinkingValue,
  thinkingPending,
  selectedKeys,
  connectionsCapped,
  totalConnections,
  batchKind,
  testingConnId,
  togglingConnId,
  connQuery,
  connListRef,
  connVirtualizer,
  connResults,
  onStrategyChange,
  onStickyDraftChange,
  onSaveSticky,
  onThinkingChange,
  onRequestBulkDelete,
  onClearSelection,
  onToggleSelection,
  onSelectAll,
  onTestConnections,
  onTestConnection,
  onStopTests,
  onConnQueryChange,
  onOpenAddConnection,
  onMovePriority,
  onToggleConnection,
  onEditConnection,
  onDeleteConnection,
}: ProviderConnectionsPanelProps) {
  return (
                  <TabsContent
                    value="connections"
                    keepMounted
                    className="flex min-h-0 h-full flex-1 flex-col overflow-hidden p-1.5 sm:p-5"
                  >
                    <div className="flex min-h-0 h-full flex-1 flex-col gap-1.5 overflow-hidden sm:gap-3">
                      <div className="flex shrink-0 flex-wrap items-end justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-3 sm:gap-y-2">
                            <div className="flex min-w-0 basis-full items-center gap-1.5 sm:basis-auto sm:gap-2">
                              <span className="text-[11px] font-medium text-muted-foreground sm:hidden">
                                Routing
                              </span>
                              <span className="hidden whitespace-nowrap text-xs font-medium text-muted-foreground sm:inline">
                                Account routing:
                              </span>
                              <div className="min-w-0 flex-1 overflow-hidden sm:flex-none">
                                <Segmented
                                  size="sm"
                                  className="w-full min-w-0 sm:w-auto sm:min-w-[15rem] sm:flex-none"
                                  value={strategy}
                                  disabled={strategyPending}
                                  onChange={onStrategyChange}
                                  options={[
                                    { value: "fill-first", label: "Fill-first", mobileLabel: "Fill" },
                                    { value: "round-robin", label: "Round-robin", mobileLabel: "Round" },
                                    { value: "least-inflight", label: "Least-inflight", mobileLabel: "Least" },
                                  ]}
                                />
                              </div>
                            </div>

                            <div
                              className={cn(
                                "inline-flex items-center gap-1.5 sm:gap-1.5",
                                strategy !== "round-robin" && "hidden sm:inline-flex",
                              )}
                            >
                              <label
                                htmlFor="provider-sticky-limit"
                                className="text-xs font-medium text-muted-foreground"
                              >
                                Sticky
                              </label>
                              <Input
                                id="provider-sticky-limit"
                                size="sm"
                                type="number"
                                min={1}
                                value={stickyDraft}
                                disabled={strategyPending || strategy !== "round-robin"}
                                onChange={(event) => onStickyDraftChange(event.target.value)}
                                className="w-14 shrink-0"
                              />
                              <RippleButton
                                size="sm"
                                variant="outline"
                                disabled={strategyPending || strategy !== "round-robin"}
                                onClick={onSaveSticky}
                              >
                                Save
                              </RippleButton>
                            </div>
                          </div>

                          {thinkingLevels && thinkingLevels.length > 0 ? (
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                Thinking Mode:
                              </span>
                              <div className="w-full min-w-0 max-w-[26rem] overflow-hidden pb-0.5 sm:flex-none sm:overflow-visible sm:pb-0">
                                <Segmented
                                  size="compact"
                                  value={thinkingValue}
                                  disabled={thinkingPending}
                                  onChange={onThinkingChange}
                                  options={thinkingLevels.map((level) => ({
                                    value: level,
                                    label: thinkingLabel(level),
                                    compactLabel:
                                      level === "minimal"
                                        ? "Min"
                                        : level === "medium"
                                          ? "Med"
                                          : level === "thinking"
                                            ? "Think"
                                            : level === "ultra"
                                              ? "Ultra"
                                              : undefined,
                                  }))}
                                  className="w-full min-w-0 gap-1 p-1"
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {connsAll.length > 0 ? (
                          <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end xl:w-auto">
                            {selectedKeys.size > 0 ? (
                              <>
                                <RippleButton
                                  size="sm"
                                  variant="destructive"
                                  onClick={onRequestBulkDelete}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete selected
                                </RippleButton>
                                <RippleButton
                                  size="sm"
                                  variant="outline"
                                  onClick={onClearSelection}
                                >
                                  Unselect
                                </RippleButton>
                                <TestBtn
                                  busy={
                                    batchKind === "conn" ||
                                    conns.some((connection) =>
                                      testingConnId === connection.id
                                    )
                                  }
                                  label="Test selected"
                                  onTest={() =>
                                    void onTestConnections([...selectedKeys])
                                  }
                                  onStop={onStopTests}
                                />
                              </>
                            ) : (
                              <>
                                <RippleButton
                                  size="sm"
                                  variant="outline"
                                  onClick={onSelectAll}
                                >
                                  Select all
                                </RippleButton>
                                <TestBtn
                                  busy={
                                    batchKind === "conn" ||
                                    conns.some((connection) =>
                                      testingConnId === connection.id
                                    )
                                  }
                                  label="Test all"
                                  onTest={() =>
                                    void onTestConnections(
                                      conns.map((connection) => connection.id)
                                    )
                                  }
                                  onStop={onStopTests}
                                />
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>

                      {connectionsCapped ? (
                        <div className="shrink-0 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                          Showing the first {connsAll.length.toLocaleString()} of {totalConnections.toLocaleString()} connections. Use search to find accounts beyond this limit.
                        </div>
                      ) : null}

                      {connsAll.length > 0 ? (
                        <div className="relative shrink-0">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            className="h-8 pl-8 text-xs"
                            placeholder="Search name, id, key hint…"
                            value={connQuery}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            data-1p-ignore="true"
                            data-lpignore="true"
                            onChange={(e) => onConnQueryChange(e.target.value)}
                          />
                        </div>
                      ) : null}

                      {connsAll.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                          No connections yet
                          <div className="mt-3">
                            <RippleButton
                              size="sm"
                              onClick={onOpenAddConnection}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {connectionCtaLabel(
                                selected.authType,
                                selected.noAuth
                              )}
                            </RippleButton>
                          </div>
                        </div>
                      ) : conns.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                          No matches for "{connQuery}"
                        </div>
                      ) : (

                        <div className="relative min-h-0 flex-1 overflow-hidden">
                          <ScrollArea
                            overscrollContain
                            scrollFade
                            viewportRef={connListRef}
                            className="absolute inset-0"
                          >
                            <div className="touch-pan-y [-webkit-overflow-scrolling:touch]">
                          <div
                            className="relative w-full"
                            style={{
                              height: `${connVirtualizer.getTotalSize()}px`,
                            }}
                          >
                            {connVirtualizer.getVirtualItems().map((vRow) => {
                              const c = conns[vRow.index];
                              if (!c) return null;
                              const idx = vRow.index;
                              const sel = selectedKeys.has(c.id);
                              const result = connResults[c.id];
                              const busy = testingConnId === c.id;
                              const inactive = c.isActive === false;
                              const credentialStale = c.testStatus === "stale" || c.testStatus === "expired";
                              const healthStatus = c.healthStatus && c.healthStatus !== "unknown"
                                ? c.healthStatus
                                : (c.testStatus === "active" ? "healthy" : c.testStatus === "error" ? "error" : null);
                              const checkedLabel = c.lastTested
                                ? formatLastChecked(c.lastTested)
                                : null;
                              return (
                                <div
                                  key={c.id}
                                  data-index={vRow.index}
                                  ref={connVirtualizer.measureElement}
                                  className="absolute left-0 top-0 w-full pb-1"
                                  style={{
                                    transform: `translateY(${vRow.start}px)`,
                                  }}
                                >
                                  <div
                                    className={cn(

                                      "rounded-lg border bg-surface px-2 py-1.5 sm:p-3 transition-[border-color,background-color] duration-150 ease-out",
                                      sel
                                        ? "border-foreground/40"
                                        : inactive
                                          ? "border-border/70 bg-muted/30 text-muted-foreground opacity-60"
                                          : "border-border hover:border-border/80 hover:bg-surface-hover/40"
                                    )}
                                  >
                                    <div className="flex flex-nowrap items-center gap-1 sm:gap-3">
                                      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 sm:gap-2.5">
                                        <Checkbox
                                          checked={sel}
                                          onCheckedChange={() => {
                                            onToggleSelection(c.id);
                                          }}
                                        />
                                        <div className="hidden shrink-0 flex-col gap-0.5 sm:flex">
                                          <Tooltip label="Move up">
                                            <button
                                              type="button"
                                              disabled={idx === 0}
                                              onClick={() =>
                                                void onMovePriority(c.id, -1)
                                              }
                                              aria-label="Move up"
                                              className="rounded p-0.5 text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground disabled:opacity-30"
                                            >
                                              <ArrowUp className="h-3.5 w-3.5" />
                                            </button>
                                          </Tooltip>
                                          <Tooltip label="Move down">
                                            <button
                                              type="button"
                                              disabled={
                                                idx === conns.length - 1
                                              }
                                              onClick={() =>
                                                void onMovePriority(c.id, 1)
                                              }
                                              aria-label="Move down"
                                              className="rounded p-0.5 text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground disabled:opacity-30"
                                            >
                                              <ArrowDown className="h-3.5 w-3.5" />
                                            </button>
                                          </Tooltip>
                                        </div>
                                        <div className="min-w-0 flex-1 overflow-hidden">
                                          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                                            <span className="truncate text-[13px] font-medium leading-tight sm:text-sm">
                                              {c.name ||
                                                c.email ||
                                                c.id.slice(0, 8)}
                                            </span>
                                            {busy ? (
                                              <span
                                                className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-foreground/90"
                                                aria-live="polite"
                                                aria-label={`Checking ${c.name || c.email || c.id}`}
                                              >
                                                <span>Checking</span>
                                                <span className="inline-flex w-3 justify-start" aria-hidden="true">
                                                  <span className="animate-pulse">.</span>
                                                  <span className="animate-pulse [animation-delay:150ms]">.</span>
                                                  <span className="animate-pulse [animation-delay:300ms]">.</span>
                                                </span>
                                              </span>
                                            ) : null}
                                            {result && !result.ok ? (
                                              <>
                                                <span className="max-w-[4.5rem] shrink truncate text-[10px] font-medium text-destructive sm:max-w-none">
                                                  {result.label}
                                                </span>
                                                <Tooltip label="Copy full error">
                                                  <button
                                                    type="button"
                                                    className="hidden rounded p-0.5 text-muted-foreground hover:text-foreground sm:inline-flex"
                                                    aria-label="Copy full error"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      navigator.clipboard.writeText(result.message || "").catch(() => {});
                                                    }}
                                                  >
                                                    <Copy className="h-3 w-3" />
                                                  </button>
                                                </Tooltip>
                                              </>
                                            ) : null}
                                          </div>
                                          <div className="mt-0.5 hidden flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground sm:flex">
                                            <span>
                                              #{idx + 1}
                                            </span>
                                            {healthStatus ? (
                                              <Tooltip label={c.healthError || (healthStatus === "healthy" ? "Connection is healthy" : "Connection has an error")}>
                                                <StatusBadge
                                                  tone={
                                                    healthStatus === "healthy"
                                                      ? "ok"
                                                      : "err"
                                                  }
                                                  className="max-w-[10rem] truncate text-[10px]"
                                                >
                                                  {healthStatus === "healthy" ? "OK" : "Error"}
                                                </StatusBadge>
                                              </Tooltip>
                                            ) : null}
                                            {checkedLabel ? (
                                              <span>checked {checkedLabel}</span>
                                            ) : null}
                                            {credentialStale ? (
                                              <Tooltip label={c.lastError || "Credentials may be expired; reconnect this provider."}>
                                                <StatusBadge tone="warn" className="max-w-[10rem] truncate text-[10px]">
                                                  Stale
                                                </StatusBadge>
                                              </Tooltip>
                                            ) : null}
                                            {inactive ? (
                                              <>
                                                <span>·</span>
                                                <span>off</span>
                                              </>
                                            ) : null}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-0.5 sm:gap-1.5">
                                        <FlipButton
                                          active={c.isActive !== false}
                                          disabled={togglingConnId === c.id}
                                          onToggle={() => void onToggleConnection(c.id)}
                                          activeLabel=""
                                          inactiveLabel=""
                                        />
                                        <Tooltip label={busy ? "Stop" : "Test"}>
                                          <RippleButton
                                            size="icon-sm"
                                            variant="outline"
                                            className="h-7 w-7 sm:hidden"
                                            aria-label={busy ? "Stop test" : "Test connection"}
                                            onClick={() =>
                                              busy ? onStopTests() : void onTestConnection(c.id)
                                            }
                                          >
                                            {busy ? (
                                              <Square className="h-3 w-3 fill-current" />
                                            ) : (
                                              <Play className="h-3.5 w-3.5 fill-current" />
                                            )}
                                          </RippleButton>
                                        </Tooltip>
                                        <span className="hidden sm:inline-flex [&>button]:h-7 [&>button]:text-sm">
                                          <TestBtn
                                            busy={busy}
                                            onTest={() =>
                                              void onTestConnection(c.id)
                                            }
                                            onStop={onStopTests}
                                          />
                                        </span>
                                        <Tooltip label="Edit">
                                          <RippleButton
                                            size="sm"
                                            variant="outline"
                                            className="h-7 w-7 px-0 sm:w-auto sm:px-3 sm:text-sm"
                                            onClick={() => onEditConnection(c)}
                                            aria-label="Edit connection"
                                          >
                                            <Pencil className="size-4 sm:hidden" />
                                            <span className="hidden font-medium sm:inline">Edit</span>
                                          </RippleButton>
                                        </Tooltip>
                                        <Tooltip label="Delete">
                                          <RippleButton
                                            size="sm"
                                            variant="outline"
                                            className="h-7 w-7 px-0 sm:w-auto sm:px-3 sm:text-sm"
                                            onClick={() => onDeleteConnection(c.id)}
                                            aria-label="Delete connection"
                                          >
                                            <Trash2 className="size-4 sm:hidden" />
                                            <span className="hidden font-medium sm:inline">Delete</span>
                                          </RippleButton>
                                        </Tooltip>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </div>
                  </TabsContent>
  );
}
