import type { RefObject } from "react";
import { motion } from "motion/react";
import {
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  MonitorSmartphone,
  Search,
  Server,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Frame, FrameHeader, FramePanel } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/StatusBadge";
import { ProviderBrandIcon } from "@/components/provider/ProviderBrandIcon";
import {
  authModeLabels,
  providerIcon,
  resolveAuthFlow,
  type AuthFlow,
} from "@/lib/providers";
import { type AvailableProvider, type Connection } from "@/lib/connections-api";
import { cn } from "@/lib/utils";

type ProviderSidebarProps = {
  byProvider: Map<string, Connection[]>;
  filter: "all" | "active" | "idle";
  hiddenProviders: string[];
  loading: boolean;
  query: string;
  providerListRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  sorted: AvailableProvider[];
  onFilterChange: (value: "all" | "active" | "idle") => void;
  onQueryChange: (value: string) => void;
  onSelectProvider: (id: string) => void;
  onToggleProviderHidden: (id: string) => void;
};

export function ProviderSidebar({
  byProvider,
  filter,
  hiddenProviders,
  loading,
  query,
  providerListRef,
  selectedId,
  sorted,
  onFilterChange,
  onQueryChange,
  onSelectProvider,
  onToggleProviderHidden,
}: ProviderSidebarProps) {
  return (
        <Frame
          className={cn(
            "flex shrink-0 flex-col overflow-hidden",

            "w-full h-[24dvh] max-h-[24dvh] min-h-0 sm:h-[30dvh] sm:max-h-[30dvh] lg:h-full lg:max-h-none lg:min-h-0 lg:w-[300px] xl:w-[340px]"
          )}
        >
          <FrameHeader className="space-y-1.5 border-b border-border p-2.5 sm:space-y-2 sm:p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className={cn("pl-8", query ? "pr-8" : undefined)}
                placeholder="Search providers…"
                value={query}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                onChange={(e) => onQueryChange(e.target.value)}
              />
              {query ? (
                <Tooltip label="Clear search">
                  <button
                    type="button"
                    aria-label="Clear provider search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => onQueryChange("")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Tooltip>
              ) : null}
            </div>
            <Segmented
              size="sm"
              value={filter}
              onChange={onFilterChange}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "idle", label: "Idle" },
              ]}
            />
          </FrameHeader>

          <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <ScrollArea
            overscrollContain
            scrollFade
            scrollbarGutter
            viewportRef={providerListRef}
            className="min-h-0 flex-1"
          >
            <div className="p-2">
            {loading ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No providers match
              </p>
            ) : (
              <ul className="space-y-1">
                {sorted.map((p) => {
                  const list = byProvider.get(p.id) || [];
                  const connectionCount = p.id === selectedId ? list.length : (p.connected || 0);
                  const active = p.id === selectedId
                    ? list.filter((c) => c.isActive !== false).length
                    : connectionCount;
                  const inactive = p.id === selectedId ? list.length - active : 0;
                  const on = selectedId === p.id;
                  const hidden = hiddenProviders.includes(p.id);
                  const Icon = providerIcon(p.id);
                  const flow = p.isCustom
                    ? ("apikey" as AuthFlow)
                    : resolveAuthFlow(p.id, p.authType, p.noAuth);
                  const AuthIcon =
                    flow === "apikey"
                      ? KeyRound
                      : flow === "oauth" || flow === "device"
                        ? Fingerprint
                        : flow === "import"
                          ? MonitorSmartphone
                          : Server;
                  return (
                    <li key={p.id} data-provider-id={p.id}>
                      <div
                        className={cn(
                          "group relative flex w-full items-center rounded-lg transition-colors duration-100",
                          on ? "text-foreground" : "hover:bg-surface-hover/70",
                          hidden && "opacity-55"
                        )}
                      >
                        {on ? (
                          <motion.span
                            layoutId="provider-highlight"
                            className="absolute inset-0 rounded-lg bg-white/15"
                            transition={{
                              type: "spring",
                              stiffness: 520,
                              damping: 36,
                              mass: 0.4,
                            }}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onSelectProvider(p.id)}
                          className={cn(
                            "relative z-10 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-white/20 sm:gap-3 sm:px-3 sm:py-2.5"
                          )}
                        >
                          <span
                            className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white p-1.5 outline outline-1 outline-white/30 outline-offset-2 sm:size-8"
                          >
                            <ProviderBrandIcon
                              id={p.id}
                              color="var(--background)"
                              size={20}
                              fallbackIcon={Icon}
                            />
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border/60 bg-card/90 text-muted-foreground">
                              <AuthIcon className="h-2 w-2" />
                            </span>
                          </span>
                          <div className="relative z-10 min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                              <span className="truncate text-[13px] font-medium sm:text-sm">
                                {p.name}
                              </span>
                              <Badge variant="outline" size="sm" className="max-w-[5.5rem] truncate font-mono text-[9px] text-muted-foreground sm:max-w-none sm:text-[10px]">
                                {p.alias || p.id}
                              </Badge>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground sm:gap-x-2 sm:text-[11px]">
                              {authModeLabels(p.authType, p.noAuth, p.authModes).map(
                                (mode) => (
                                  <span
                                    key={mode}
                                    className="inline-flex items-center gap-0.5 rounded border border-border bg-background/50 px-1 py-px font-medium sm:gap-1 sm:px-1.5"
                                  >
                                    <AuthIcon className="h-2.5 w-2.5" />
                                    {mode}
                                  </span>
                                )
                              )}
                              {connectionCount > 0 ? (
                                <>
                                  {inactive > 0 ? (
                                    <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground sm:gap-1 sm:px-1.5 sm:text-[11px]">
                                      {inactive} off
                                    </span>
                                  ) : null}
                                  <StatusBadge
                                    tone="ok"
                                    className="text-[10px] font-medium sm:text-[11px]"
                                  >
                                    {connectionCount} connection{connectionCount === 1 ? "" : "s"}
                                  </StatusBadge>
                                </>
                              ) : (
                                <span className="text-muted-foreground/60">no connections</span>
                              )}
                            </div>
                          </div>
                        </button>
                        <Tooltip label={hidden ? "Show provider" : "Hide provider"}>
                          <button
                            type="button"
                            aria-label={hidden ? `Show ${p.name}` : `Hide ${p.name}`}
                            aria-pressed={hidden}
                            onClick={() => onToggleProviderHidden(p.id)}
                            className="relative z-10 mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[background-color,opacity,color] hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 sm:mr-2"
                          >
                            {hidden ? (
                              <EyeOff className="size-3.5" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                          </button>
                        </Tooltip>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            </div>
          </ScrollArea>
          </FramePanel>
        </Frame>

  );
}
