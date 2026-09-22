import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Brain,
  Check,
  CircleAlert,
  Eye,
  GripVertical,
  Layers,
  Plus,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { ProviderModelIcon } from "@/components/ProviderModelAccordion";
import { RippleButton } from "@/components/animate/ripple-button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { getErrorMessage } from "@/lib/api";
import { groupModels, type ModelInfo } from "@/lib/chatStudio";
import { moveComboModel, toggleComboModel } from "@/lib/comboForm";
import { providerName } from "@/lib/providers";
import { cn } from "@/lib/utils";

export function modelProviderId(id: string): string {
  const parts = id.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "other";
}

export function modelShortName(id: string): string {
  const parts = id.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : id;
}

export type CapabilityFlag = {
  key: string;
  label: string;
  desc: string;
  tone: string;
  Icon: LucideIcon;
};

/** 9router capacity badges: one tinted icon per capability, tooltip explains it. */
export function modelCapabilityFlags(
  capabilities?: Record<string, unknown>,
): CapabilityFlag[] {
  const caps = capabilities ?? {};
  const flags: CapabilityFlag[] = [];
  if (caps.vision)
    flags.push({
      key: "vision",
      label: "Vision",
      desc: "Supports image input",
      tone: "text-sky-400",
      Icon: Eye,
    });
  if (caps.reasoning)
    flags.push({
      key: "reasoning",
      label: "Reasoning",
      desc: "Supports reasoning / thinking",
      tone: "text-amber-400",
      Icon: Brain,
    });
  return flags;
}

export function ModelCapabilityChips({
  capabilities,
  className,
  iconClassName,
  toneClassName,
}: {
  capabilities?: Record<string, unknown>;
  className?: string;
  iconClassName?: string;
  toneClassName?: string;
}) {
  const flags = modelCapabilityFlags(capabilities);
  if (!flags.length) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      {flags.map(({ key, label, desc, tone, Icon }) => (
        <span
          key={key}
          title={`${label} — ${desc}`}
          className={cn("inline-flex cursor-help items-center", toneClassName ?? tone)}
        >
          <Icon className={cn("size-3.5", iconClassName)} aria-hidden />
        </span>
      ))}
    </span>
  );
}

type ModelPickDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ModelInfo[];
  picked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  loading?: boolean;
  error?: unknown;
  title?: string;
  description?: string;
  ordered?: string[];
  onReorder?: (fromId: string, toId: string) => void;
  /** Existing combos offered as one-tap bundles; ids are bare combo names. */
  combos?: ModelInfo[];
};

export function ModelPickDialog({
  open,
  onOpenChange,
  catalog,
  picked,
  onToggle,
  loading = false,
  error,
  title = "Select models",
  description = "Click a chip to add or remove it from the combo. Changes apply immediately.",
  ordered = [],
  onReorder,
  combos = [],
}: ModelPickDialogProps) {
  const [query, setQuery] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const cleanQuery = query.trim().toLowerCase();

  const groups = useMemo(() => {
    return groupModels(catalog, query);
  }, [catalog, query]);

  const shortNameById = useMemo(
    () => new Map(catalog.map((m) => [m.id, modelShortName(m.id)])),
    [catalog],
  );

  const comboEntries = useMemo(
    () =>
      cleanQuery
        ? combos.filter((combo) => combo.id.toLowerCase().includes(cleanQuery))
        : combos,
    [combos, cleanQuery],
  );
  const pickedComboCount = comboEntries.filter((combo) =>
    picked.has(combo.id),
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-h-[85vh] sm:max-w-xl">
        <DialogHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-sm font-semibold tracking-tight">
                {title}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground/70">
                {description}
              </DialogDescription>
            </div>
            {ordered.length > 0 ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {ordered.length} in combo
              </span>
            ) : null}
          </div>
        </DialogHeader>

        <DialogPanel className="space-y-3">
          {/* Compact search input — 9router style */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models or providers…"
              aria-label="Search models"
              className="h-8 w-full rounded-md border border-white/[0.08] bg-black/20 pl-8 pr-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
              autoFocus
            />
          </div>

          {/* Kanban / Multi-column board: Active combo column + Provider pill sections */}
          {loading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Loading models…
            </p>
          ) : error ? (
            <div className="flex items-start gap-2 py-4 text-xs text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{getErrorMessage(error, "Unable to load models")}</span>
            </div>
          ) : (
            <div className="max-h-[380px] space-y-3.5 overflow-y-auto pr-1">
              {/* Kanban Lane: In combo priority lane (draggable pills) */}
              {ordered.length > 0 && !cleanQuery ? (
                <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-2.5">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-primary">
                      <Layers className="size-3.5" />
                      In combo
                      <span className="text-[10px] text-muted-foreground">
                        ({ordered.length} · drag to reorder)
                      </span>
                    </span>
                  </div>
                  <div
                    aria-label="In combo models lane"
                    className="flex max-h-[92px] flex-wrap gap-1.5 overflow-y-auto overscroll-contain pr-0.5"
                  >
                    {ordered.map((id, index) => (
                      <div
                        key={id}
                        draggable={Boolean(onReorder)}
                        onDragStart={(e) => {
                          if ((e.target as HTMLElement).closest("button")) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", id);
                          setDraggedId(id);
                        }}
                        onDragOver={(e) => {
                          if (!draggedId || draggedId === id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverId(id);
                        }}
                        onDragLeave={() =>
                          setDragOverId((cur) => (cur === id ? null : cur))
                        }
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = draggedId;
                          setDraggedId(null);
                          setDragOverId(null);
                          if (from && from !== id) onReorder?.(from, id);
                        }}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDragOverId(null);
                        }}
                        className={cn(
                          "group flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 font-mono text-xs text-primary transition-colors hover:bg-primary/25",
                          draggedId === id && "opacity-30",
                          dragOverId === id &&
                            draggedId !== id &&
                            "ring-1 ring-primary",
                        )}
                      >
                        <span className="text-[10px] font-semibold text-primary/70">
                          {index + 1}.
                        </span>
                        <span>{shortNameById.get(id) ?? modelShortName(id)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${id}`}
                          onClick={() => onToggle(id)}
                          className="ml-0.5 rounded p-0.5 text-primary/60 hover:bg-destructive/20 hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Combos: one dashed chip inserts an existing combo as a single route step */}
              {comboEntries.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-card py-0.5 text-xs">
                    <Boxes className="size-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">Combos</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      ({pickedComboCount > 0 ? `${pickedComboCount}/` : ""}
                      {comboEntries.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {comboEntries.map((combo) => {
                      const isPicked = picked.has(combo.id);
                      return (
                        <button
                          key={combo.id}
                          type="button"
                          aria-pressed={isPicked}
                          aria-label={`${isPicked ? "Remove" : "Add"} combo ${combo.id}`}
                          title="Insert this combo as a single route step"
                          onClick={() => onToggle(combo.id)}
                          className={cn(
                            "flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs transition-colors",
                            isPicked
                              ? "bg-primary text-primary-foreground font-medium"
                              : "border border-dashed border-white/[0.08] bg-white/[0.02] text-foreground/80 hover:border-primary/40 hover:bg-primary/[0.05]",
                          )}
                        >
                          <Layers
                            className={cn(
                              "size-3 shrink-0",
                              isPicked
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground/60",
                            )}
                          />
                          <span>{combo.id}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Provider groups with wrap chips (9router ModelSelectModal style) */}
              {groups.length === 0 && comboEntries.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No models match query
                </p>
              ) : (
                groups.map(({ provider, items }) => {
                  const addedCount = items.filter((m) => picked.has(m.id)).length;
                  return (
                    <div key={provider} className="space-y-1.5">
                      <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-card py-0.5 text-xs">
                        <ProviderModelIcon provider={provider} className="size-3.5" />
                        <span className="font-medium text-foreground">
                          {providerName(provider)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          ({addedCount > 0 ? `${addedCount}/` : ""}
                          {items.length})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((model) => {
                          const isPicked = picked.has(model.id);
                          return (
                            <button
                              key={model.id}
                              type="button"
                              aria-pressed={isPicked}
                              aria-label={`${isPicked ? "Remove" : "Add"} ${model.id}`}
                              onClick={() => onToggle(model.id)}
                              className={cn(
                                "flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs transition-colors",
                                isPicked
                                  ? "bg-primary text-primary-foreground font-medium"
                                  : "border border-white/[0.08] bg-white/[0.02] text-foreground/80 hover:border-primary/40 hover:bg-primary/[0.05]",
                              )}
                            >
                              {isPicked && <Check className="size-3 shrink-0" />}
                              <span>{modelShortName(model.id)}</span>
                              <ModelCapabilityChips
                                capabilities={model.capabilities}
                                toneClassName={
                                  isPicked ? "text-primary-foreground/80" : undefined
                                }
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </DialogPanel>

        <DialogFooter variant="bare" className="border-t border-white/[0.06] pt-2">
          <RippleButton
            size="sm"
            onClick={() => onOpenChange(false)}
            className="ml-auto"
          >
            Done
          </RippleButton>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

type ComboModelBoardProps = {
  models: ModelInfo[];
  selected: string[];
  onModelsChange: Dispatch<SetStateAction<string[]>>;
  loading?: boolean;
  error?: unknown;
  renderSelectedExtra?: (modelId: string) => ReactNode;
  /** Existing combos offered as bundles in the picker; ids are bare combo names. */
  combos?: ModelInfo[];
};

/**
 * 9router-style clean model rows:
 * - subtle hover bg
 * - index number (1, 2, 3)
 * - mono model name
 * - ghost arrow buttons (up/down)
 * - ghost close button
 * - dashed "+ Add model" button
 * - max 3 rows visible (max-h-[108px]), smooth scroll on 4th
 */
export function ComboModelBoard({
  models,
  selected,
  onModelsChange,
  loading = false,
  error,
  renderSelectedExtra,
  combos = [],
}: ComboModelBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const catalog = useMemo(() => {
    const known = new Set(models.map((m) => m.id));
    const missing = selected
      .filter((id) => id && !known.has(id))
      .map((id): ModelInfo => {
        const parts = id.split("/").filter(Boolean);
        return {
          id,
          name: parts[parts.length - 1] || id,
          provider: parts.length > 1 ? parts[0] : "other",
        };
      });
    return [...models, ...missing];
  }, [models, selected]);

  const modelById = useMemo(
    () => new Map(catalog.map((m) => [m.id, m])),
    [catalog],
  );

  const picked = useMemo(() => new Set(selected), [selected]);

  function moveBefore(targetId: string) {
    const from = draggedId;
    setDraggedId(null);
    setDragOverId(null);
    if (!from || from === targetId) return;
    onModelsChange((current) => {
      const fromIndex = current.indexOf(from);
      const toIndex = current.indexOf(targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      return moveComboModel(current, fromIndex, toIndex);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
      {selected.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.08] p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No models in combo yet
          </p>
        </div>
      ) : (
        /* Kanban (vertical): each picked model = a row card. Rows measure 46px
           (2.875rem) + 6px (0.375rem) gap => max-h = 4 rows + 3 gaps = 202px;
           the 5th row triggers vertical scroll. `shrink` lets the box give up
           height below that cap on short viewports instead of clipping the
           dialog — it stays the only scroll area of the dialog. */
        <ul
          aria-label="Selected models in combo order"
          className="flex min-h-0 shrink max-h-[calc(4*2.875rem+3*0.375rem)] snap-y snap-mandatory flex-col gap-1.5 overflow-y-auto overscroll-y-contain pr-1"
        >
          {selected.map((id, index) => {
            const info = modelById.get(id);
            const provider = modelProviderId(id);
            const isFirst = index === 0;
            const isLast = index === selected.length - 1;

            return (
              <li
                key={id}
                draggable
                onDragStart={(e) => {
                  if ((e.target as HTMLElement).closest("button")) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                  setDraggedId(id);
                }}
                onDragOver={(e) => {
                  if (!draggedId || draggedId === id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverId(id);
                }}
                onDragLeave={() =>
                  setDragOverId((cur) => (cur === id ? null : cur))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  moveBefore(id);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverId(null);
                }}
                className={cn(
                  "group flex w-full shrink-0 snap-start items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 transition-colors hover:bg-white/[0.05]",
                  draggedId === id && "opacity-30",
                  dragOverId === id &&
                    draggedId !== id &&
                    "border-primary/40 bg-primary/10 ring-1 ring-primary/40",
                )}
              >
                {/* Order index badge */}
                <span className="w-3.5 shrink-0 text-center font-mono text-[10px] font-medium text-muted-foreground/70">
                  {index + 1}
                </span>

                {/* Drag grip */}
                <span
                  aria-hidden="true"
                  className="cursor-grab text-muted-foreground/30 transition-colors hover:text-muted-foreground group-hover:text-muted-foreground/60"
                >
                  <GripVertical className="size-3.5" />
                </span>

                {/* Provider icon + model name + provider */}
                <Tooltip label={id}>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <ProviderModelIcon provider={provider} className="size-4 shrink-0" />
                    <span className="truncate font-mono text-xs text-foreground/90">
                      {modelShortName(id)}
                    </span>
                    <span className="hidden truncate text-[10px] text-muted-foreground/40 sm:inline">
                      {provider}
                    </span>
                  </div>
                </Tooltip>

                {/* Capability badges */}
                <ModelCapabilityChips
                  capabilities={info?.capabilities}
                  className="hidden sm:flex"
                />

                {renderSelectedExtra?.(id)}

                {/* Reorder + remove */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move ${id} up`}
                    disabled={isFirst}
                    onClick={() =>
                      onModelsChange((cur) => moveComboModel(cur, index, index - 1))
                    }
                    className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${id} down`}
                    disabled={isLast}
                    onClick={() =>
                      onModelsChange((cur) => moveComboModel(cur, index, index + 1))
                    }
                    className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                  >
                    <ArrowDown className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${id}`}
                    onClick={() =>
                      onModelsChange((cur) => toggleComboModel(cur, id))
                    }
                    className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {loading ? (
        <p className="px-1 text-[11px] text-muted-foreground">Loading models…</p>
      ) : error ? (
        <div className="flex items-start gap-1.5 px-1 text-[11px] text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{getErrorMessage(error, "Unable to load models")}</span>
        </div>
      ) : null}

      {/* 9router-style Dashed Add Model button */}
      <button
        type="button"
        disabled={loading}
        onClick={() => setPickerOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-white/[0.12] py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/[0.04] hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/[0.12] disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Plus className="size-3.5" />
        <span>Add Model</span>
      </button>

      <ModelPickDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        catalog={catalog}
        picked={picked}
        onToggle={(id) =>
          onModelsChange((current) => toggleComboModel(current, id))
        }
        ordered={selected}
        onReorder={(fromId, toId) =>
          onModelsChange((current) => {
            const fromIndex = current.indexOf(fromId);
            const toIndex = current.indexOf(toId);
            if (fromIndex < 0 || toIndex < 0) return current;
            return moveComboModel(current, fromIndex, toIndex);
          })
        }
        loading={loading}
        error={error}
        combos={combos}
      />
    </div>
  );
}