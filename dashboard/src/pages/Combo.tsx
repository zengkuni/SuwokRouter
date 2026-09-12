import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Header } from "@/components/Header";
import { RippleButton } from "@/components/animate/ripple-button";
import {
  ProviderModelAccordion,
  ProviderModelIcon,
} from "@/components/ProviderModelAccordion";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getErrorMessage } from "@/lib/api";
import {
  createCombo,
  deleteCombo,
  listCombos,
  updateCombo,
  type Combo,
  type ComboStrategy,
  type ComboStrategyConfig,
} from "@/lib/admin-extras-api";
import { groupModels, type ModelInfo } from "@/lib/chatStudio";
import { listGatewayModels } from "@/lib/model-catalog-api";
import {
  fetchSettings,
  updateSettings,
  type AppSettings,
} from "@/lib/settings-api";
import { probeEnabled } from "@/lib/live-mode";
import { toast } from "@/components/ui/toast";

type ModelPickerProps = {
  models: ModelInfo[];
  selected: string[];
  onChange: (models: string[]) => void;
  loading?: boolean;
  error?: unknown;
  multiple?: boolean;
  placeholder?: string;
};

type ModelPickerPopupPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  listHeight: number;
};

function ModelPicker({
  models,
  selected,
  onChange,
  loading = false,
  error,
  multiple = true,
  placeholder = "Select models",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState<ModelPickerPopupPosition | null>(null);

  function updatePopupPosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const edgeGap = 12;
    const popupGap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - edgeGap;
    const spaceAbove = rect.top - edgeGap;
    const openAbove = spaceBelow < 230 && spaceAbove > spaceBelow;
    const availableSpace = Math.max(144, openAbove ? spaceAbove : spaceBelow);
    const listHeight = Math.max(120, Math.min(256, availableSpace - 54));
    const width = rect.width;
    const left = Math.min(
      Math.max(edgeGap, rect.left),
      Math.max(edgeGap, window.innerWidth - width - edgeGap),
    );

    setPopupPosition(
      openAbove
        ? { left, bottom: window.innerHeight - rect.top + popupGap, width, listHeight }
        : { left, top: rect.bottom + popupGap, width, listHeight },
    );
  }

  useEffect(() => {
    if (!open) return;
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !popupRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPopupPosition(null);
      return;
    }

    updatePopupPosition();
    const onViewportChange = () => updatePopupPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  const catalog = useMemo(() => {
    const known = new Set(models.map((model) => model.id));
    const missing = selected
      .filter((id) => id && !known.has(id))
      .map((id) => {
        const parts = id.split("/").filter(Boolean);
        return {
          id,
          name: parts[parts.length - 1] || id,
          provider: parts.length > 1 ? parts[0] : "other",
        } satisfies ModelInfo;
      });
    return [...models, ...missing];
  }, [models, selected]);

  const groups = useMemo(() => groupModels(catalog, query), [catalog, query]);

  function toggleModel(id: string) {
    if (!multiple) {
      onChange([id]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-surface px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
          {selected.length === 0
            ? placeholder
            : multiple
              ? `${selected.length} model${selected.length === 1 ? "" : "s"} selected`
              : selected[0]}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/45 px-2 py-1 text-[11px] text-foreground"
            >
              <Tooltip label={id}><span className="max-w-[15rem] truncate font-mono">{id}</span></Tooltip>
              <button
                type="button"
                onClick={() => onChange(selected.filter((item) => item !== id))}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                aria-label={`Remove ${id}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {open && popupPosition
        ? createPortal(
            <div
              ref={popupRef}
              className="fixed z-[100] overflow-hidden rounded-xl border border-border bg-card"
              style={{
                left: popupPosition.left,
                top: popupPosition.top,
                bottom: popupPosition.bottom,
                width: popupPosition.width,
              }}
            >
              <div className="border-b border-border p-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search models…"
                    aria-label="Search models"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
              </div>
              {loading ? (
                <p className="px-3 py-5 text-center text-xs text-muted-foreground">Loading models…</p>
              ) : error ? (
                <div className="flex items-start gap-2 px-3 py-4 text-xs text-destructive">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>{getErrorMessage(error, "Unable to load models")}</span>
                </div>
              ) : (
                <ScrollArea
                  className="min-h-0"
                  style={{ height: popupPosition.listHeight }}
                  overscrollContain
                >
                  <div role="listbox" aria-multiselectable={multiple} className="py-1">
                    <ProviderModelAccordion
                      groups={groups}
                      query={query}
                      empty={(
                        <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                          {catalog.length ? "No models match" : "No provider models available"}
                        </p>
                      )}
                      renderItem={(model, provider) => {
                        const isSelected = selected.includes(model.id);
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => toggleModel(model.id)}
                            className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-surface-hover"
                          >
                            <ProviderModelIcon provider={provider} className="mt-0.5 size-5" />
                            <Tooltip label={model.id}>
                              <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-4">
                                {model.id}
                              </span>
                            </Tooltip>
                            {isSelected ? <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> : null}
                          </button>
                        );
                      }}
                    />
                  </div>
                </ScrollArea>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default function Combo() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editCombo, setEditCombo] = useState<Combo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Combo | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<ComboStrategy>("fallback");
  const [judgeModel, setJudgeModel] = useState("");

  const combosQ = useQuery({
    queryKey: ["combos"],
    queryFn: listCombos,
    enabled: probeEnabled(),
    retry: false,
  });
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    enabled: probeEnabled(),
    retry: false,
  });
  const modelsQ = useQuery({
    queryKey: ["combos", "models"],
    queryFn: listGatewayModels,
    enabled: probeEnabled() && createOpen,
    retry: 1,
  });

  const combos = combosQ.data ?? [];
  const loading = combosQ.isLoading;
  const providerModels = useMemo(
    () => (modelsQ.data ?? []).filter((model) => model.provider !== "combo"),
    [modelsQ.data],
  );

  const strategies: Record<string, ComboStrategyConfig> =
    ((settingsQ.data?.comboStrategies as Record<
      string,
      ComboStrategyConfig
    >) ?? {});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return combos;
    return combos.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.models.some((m) => m.toLowerCase().includes(q))
    );
  }, [combos, query]);

  function flash(msg: string, tone: "success" | "error" | "default" = "default") {
    if (tone === "success") toast.success(msg);
    else if (tone === "error") toast.error(msg);
    else toast(msg);
  }

  function resetForm() {
    setName("");
    setSelectedModels([]);
    setStrategy("fallback");
    setJudgeModel("");
  }

  function openCreate() {
    resetForm();
    setEditCombo(null);
    setCreateOpen(true);
  }

  function openEdit(c: Combo) {
    setEditCombo(c);
    setName(c.name);
    setSelectedModels(c.models);
    const cfg = strategies[c.name] || {};
    setStrategy(
      cfg.fallbackStrategy === "round-robin" ||
        cfg.fallbackStrategy === "fusion" ||
        cfg.fallbackStrategy === "fallback"
        ? cfg.fallbackStrategy
        : "fallback"
    );
    setJudgeModel(cfg.judgeModel || "");
    setCreateOpen(true);
  }

  async function persistStrategy(
    comboName: string,
    cfg: ComboStrategyConfig,
    baseSettings?: AppSettings
  ) {
    const current = baseSettings || settingsQ.data || {};
    const prev =
      (current.comboStrategies as Record<string, ComboStrategyConfig>) || {};
    await updateSettings({
      comboStrategies: {
        ...prev,
        [comboName]: { ...prev[comboName], ...cfg },
      },
    });
    await qc.invalidateQueries({ queryKey: ["settings"] });
  }

  async function onSave() {
    const n = name.trim();
    const models = selectedModels;
    if (!n) return flash("Name required", "error");
    if (!models.length) return flash("Add at least one model", "error");
    setSaving(true);
    try {
      const cfg: ComboStrategyConfig = {
        fallbackStrategy: strategy,
        judgeModel:
          strategy === "fusion" ? judgeModel.trim() || undefined : undefined,
      };
      if (editCombo) {

        await updateCombo(editCombo.id || editCombo.name, {
          models,
          name: n !== editCombo.name ? n : undefined,
        });
        await persistStrategy(n, cfg, settingsQ.data);
        await qc.invalidateQueries({ queryKey: ["combos"] });
        flash("Combo updated", "success");
      } else {
        await createCombo({ name: n, models });
        await persistStrategy(n, cfg, settingsQ.data);
        await qc.invalidateQueries({ queryKey: ["combos"] });
        flash("Combo created", "success");
      }
      setCreateOpen(false);
      setEditCombo(null);
      resetForm();
    } catch (err) {
      flash(getErrorMessage(err, "Save failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    const target = deleteTarget;
    if (!target) return;
    setSaving(true);
    try {
      await deleteCombo(target.id || target.name);
      const current = settingsQ.data || {};
      const prev =
        (current.comboStrategies as Record<string, ComboStrategyConfig>) ||
        {};
      if (prev[target.name]) {
        const next = { ...prev };
        delete next[target.name];
        await updateSettings({ comboStrategies: next });
        await qc.invalidateQueries({ queryKey: ["settings"] });
      }
      await qc.invalidateQueries({ queryKey: ["combos"] });
      flash("Combo deleted", "success");
      setDeleteTarget(null);
    } catch (err) {
      flash(getErrorMessage(err, "Delete failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Header
        title="Combos"
        actions={combos.length > 0 ? (
          <RippleButton size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add combo
          </RippleButton>
        ) : null}
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search combos…"
          className="pl-9"
        />
      </div>

      <Frame className="overflow-hidden">
        <FramePanel className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : combos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">No combos yet</p>
            <RippleButton size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Create first combo
            </RippleButton>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            No combos match your search.
          </div>
        ) : (
          <>
          <div className="divide-y divide-border/70 rounded-xl border border-border/70 bg-card sm:hidden">
            {filtered.map((c) => {
              const cfg = strategies[c.name] || {};
              const strat = cfg.fallbackStrategy || "fallback";
              return (
                <article key={c.id || c.name} className="min-w-0 space-y-2.5 p-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        {strat}
                      </Badge>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Tooltip label="Edit">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                          onClick={() => openEdit(c)}
                          aria-label="Edit combo"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget(c)}
                          aria-label="Delete combo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Models
                    </p>
                    <p className="mt-1 break-words font-mono text-[11px] leading-4 text-muted-foreground">
                      {c.models.join(" → ")}
                    </p>
                    {strat === "fusion" && cfg.judgeModel ? (
                      <p className="mt-1 break-words text-[10px] text-muted-foreground">
                        Judge: {cfg.judgeModel}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden sm:block">
          <Table className="min-w-[40rem] text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-background text-[10px] uppercase text-muted-foreground">
              <TableRow className="border-b border-border/80">
                <TableHead className="px-4 py-2 font-medium">Name</TableHead>
                <TableHead className="px-2 py-2 font-medium">Strategy</TableHead>
                <TableHead className="px-2 py-2 font-medium">Models</TableHead>
                <TableHead className="px-4 py-2 font-medium text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const cfg = strategies[c.name] || {};
                const strat = cfg.fallbackStrategy || "fallback";
                return (
                  <TableRow
                    key={c.id || c.name}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                  >
                    <TableCell className="max-w-[12rem] truncate px-4 py-2 font-medium">
                      {c.name}
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {strat}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <div className="min-w-0">
                        <p className="max-w-[24rem] truncate font-mono text-[11px] text-muted-foreground">
                          {c.models.join(" → ")}
                        </p>
                        {strat === "fusion" && cfg.judgeModel ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            judge: {cfg.judgeModel}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <Tooltip label="Edit">
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                            onClick={() => openEdit(c)}
                            aria-label="Edit combo"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Delete">
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleteTarget(c)}
                            aria-label="Delete combo"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          </>
        )}
        </FramePanel>
      </Frame>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditCombo(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {editCombo ? "Edit combo" : "Create combo"}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="smart"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">
                Models
              </span>
              <ModelPicker
                models={providerModels}
                selected={selectedModels}
                onChange={setSelectedModels}
                loading={modelsQ.isLoading}
                error={modelsQ.error}
                placeholder="Select provider models"
              />
            </label>
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">
                Strategy
              </span>
              <Segmented
                size="sm"
                value={strategy}
                onChange={setStrategy}
                options={[
                  { value: "fallback", label: "Fallback" },
                  { value: "round-robin", label: "Round-robin" },
                  { value: "fusion", label: "Fusion" },
                ]}
              />
            </div>
            {strategy === "fusion" ? (
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">
                  Judge model
                </span>
                <ModelPicker
                  models={providerModels}
                  selected={judgeModel ? [judgeModel] : []}
                  onChange={(models) => setJudgeModel(models[0] || "")}
                  loading={modelsQ.isLoading}
                  error={modelsQ.error}
                  multiple={false}
                  placeholder="Select judge model"
                />
              </label>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditCombo(null);
              }}
              disabled={saving}
            >
              Cancel
            </RippleButton>
            <RippleButton onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : editCombo ? "Save" : "Create"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete combo?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>{" "}
              and its strategy override will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={saving}
            >
              Cancel
            </RippleButton>
            <RippleButton
              variant="destructive"
              onClick={onDelete}
              disabled={saving}
            >
              {saving ? "Deleting…" : "Delete"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
