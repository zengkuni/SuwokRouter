import { Fragment, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  GripVertical,
  Hash,
  Pencil,
  Plus,
  Route,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  ComboModelBoard,
  ModelCapabilityChips,
  ModelPickDialog,
  modelProviderId,
  modelShortName,
} from "@/components/ComboModelBoard";
import { ProviderModelIcon } from "@/components/ProviderModelAccordion";
import { Header } from "@/components/Header";
import { CopyButton } from "@/components/animate/copy-button";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import { TestBtn } from "@/components/provider/TestBtn";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
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
import { listGatewayModels } from "@/lib/model-catalog-api";
import {
  fetchSettings,
  updateSettings,
  type AppSettings,
} from "@/lib/settings-api";
import { probeEnabled } from "@/lib/live-mode";
import { comboNameError } from "@/lib/comboForm";
import {
  distinctModelIds,
  formatModelTestResult,
  runModelTests,
  testGatewayModel,
  type ModelTestStatus,
} from "@/lib/comboModelTest";
import { toast } from "@/components/ui/toast";

const STRATEGY_META: Record<ComboStrategy, { label: string; hint: string }> = {
  fallback: { label: "Fallback", hint: "first healthy model answers" },
  "round-robin": { label: "Round-robin", hint: "load spread across models" },
  fusion: { label: "Fusion", hint: "a judge routes each request" },
};

export default function Combo() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editCombo, setEditCombo] = useState<Combo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Combo | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [draggedCombo, setDraggedCombo] = useState<string | null>(null);
  const [dragOverCombo, setDragOverCombo] = useState<string | null>(null);
  const [orderSaving, setOrderSaving] = useState(false);
  const orderSavingRef = useRef(false);
  const strategySavingRef = useRef(false);

  const [name, setName] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  // Judge is edited from the combo card (list), not from this dialog.
  const [judgeTarget, setJudgeTarget] = useState<Combo | null>(null);
  const [testingModels, setTestingModels] = useState<ReadonlySet<string>>(new Set<string>());
  const [modelTestResults, setModelTestResults] = useState<Readonly<Record<string, ModelTestStatus>>>({});
  const [modelTestProgress, setModelTestProgress] = useState<{ settled: number; total: number } | null>(null);
  const modelTestRunning = modelTestProgress !== null;
  const modelTestControllersRef = useRef<Map<string, AbortController>>(new Map());
  const modelTestBatchRef = useRef<AbortController | null>(null);
  // Latest run owning each model's probe; a stale (cancelled) run must not
  // touch the flag or result of the run that replaced it.
  const modelTestOwnerRef = useRef<Map<string, AbortController>>(new Map());

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
    enabled: probeEnabled() && (createOpen || judgeTarget !== null),
    retry: 1,
  });

  const combos = useMemo(() => {
    const items = combosQ.data ?? [];
    const order = pendingOrder ?? settingsQ.data?.comboOrder ?? [];
    const remaining = new Map(items.map((combo) => [combo.id || combo.name, combo]));
    const ordered: Combo[] = [];
    for (const id of order) {
      const combo = remaining.get(id);
      if (combo) {
        ordered.push(combo);
        remaining.delete(id);
      }
    }
    return [...ordered, ...remaining.values()];
  }, [combosQ.data, settingsQ.data?.comboOrder, pendingOrder]);
  const loading = combosQ.isLoading;
  const providerModels = useMemo(
    () => (modelsQ.data ?? []).filter((model) => model.provider !== "combo"),
    [modelsQ.data],
  );
  const comboModels = useMemo(
    () => (modelsQ.data ?? []).filter((model) => model.provider === "combo"),
    [modelsQ.data],
  );

  const takenComboNames = useMemo(
    () =>
      combos
        .filter(
          (combo) =>
            (combo.id || combo.name) !== (editCombo?.id || editCombo?.name)
        )
        .map((combo) => combo.name),
    [combos, editCombo]
  );
  const nameError = comboNameError(name, takenComboNames);

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

  function clearDrag() {
    setDraggedCombo(null);
    setDragOverCombo(null);
  }

  async function onDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const sourceId = draggedCombo;
    clearDrag();
    if (!sourceId || sourceId === targetId || orderSavingRef.current) return;
    const order = combos.map((combo) => combo.id || combo.name);
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, sourceId);
    orderSavingRef.current = true;
    setOrderSaving(true);
    setPendingOrder(order);
    try {
      await qc.cancelQueries({ queryKey: ["settings"] });
      await updateSettings({ comboOrder: order });
      qc.setQueryData<AppSettings>(["settings"], (current) => ({
        ...current,
        comboOrder: order,
      }));
    } catch (err) {
      flash(getErrorMessage(err, "Failed to save combo order"), "error");
    } finally {
      setPendingOrder(null);
      orderSavingRef.current = false;
      setOrderSaving(false);
    }
  }

  function dragProps(combo: Combo) {
    const id = combo.id || combo.name;
    return {
      draggable: !orderSaving && !saving && !createOpen && !deleteTarget && settingsQ.isSuccess,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest("button, input, select, textarea, a")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        setDraggedCombo(id);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!draggedCombo || orderSavingRef.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOverCombo(id);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOverCombo((current) => current === id ? null : current);
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => void onDrop(event, id),
      onDragEnd: clearDrag,
    };
  }

  function dragClassName(combo: Combo) {
    const id = combo.id || combo.name;
    return `${draggedCombo === id ? "opacity-40" : ""} ${
      dragOverCombo === id && draggedCombo !== id
        ? "bg-primary/10 ring-2 ring-inset ring-primary/50"
        : ""
    }`;
  }

  function resetForm() {
    stopModelTests();
    setModelTestResults({});
    setName("");
    setSelectedModels([]);
  }

  function openCreate() {
    resetForm();
    setEditCombo(null);
    setCreateOpen(true);
  }

  function openEdit(c: Combo) {
    stopModelTests();
    setModelTestResults({});
    setEditCombo(c);
    setName(c.name);
    setSelectedModels(c.models);
    setCreateOpen(true);
  }

  function markModelTesting(modelId: string, active: boolean) {
    setTestingModels((previous) => {
      const next = new Set(previous);
      if (active) next.add(modelId);
      else next.delete(modelId);
      return next;
    });
  }

  async function probeModel(modelId: string, signal: AbortSignal, owner: AbortController): Promise<ModelTestStatus | null> {
    modelTestOwnerRef.current.set(modelId, owner);
    markModelTesting(modelId, true);
    const isCurrent = () => modelTestOwnerRef.current.get(modelId) === owner;
    try {
      const status = await testGatewayModel(modelId, signal);
      if (isCurrent()) setModelTestResults((previous) => ({ ...previous, [modelId]: status }));
      return status;
    } catch (error) {

      if (signal.aborted) return null;
      const status = formatModelTestResult({
        ok: false,
        error: getErrorMessage(error, "Model test failed"),
      });
      if (isCurrent()) setModelTestResults((previous) => ({ ...previous, [modelId]: status }));
      return status;
    } finally {
      if (isCurrent()) {
        modelTestOwnerRef.current.delete(modelId);
        markModelTesting(modelId, false);
      }
    }
  }

  function stopModelTests() {
    modelTestBatchRef.current?.abort();
    modelTestBatchRef.current = null;
    for (const controller of modelTestControllersRef.current.values()) controller.abort();
    modelTestControllersRef.current.clear();
    modelTestOwnerRef.current.clear();
    setTestingModels(new Set<string>());
    setModelTestProgress(null);
  }

  function stopSingleModelTest(modelId: string) {
    modelTestControllersRef.current.get(modelId)?.abort();
    modelTestControllersRef.current.delete(modelId);
    modelTestOwnerRef.current.delete(modelId);
    markModelTesting(modelId, false);
  }

  async function runSingleModelTest(modelId: string) {
    if (modelTestRunning || modelTestControllersRef.current.has(modelId)) return;
    const controller = new AbortController();
    modelTestControllersRef.current.set(modelId, controller);
    try {
      const status = await probeModel(modelId, controller.signal, controller);
      if (status) flash(`${modelId}: ${status.message}`, status.ok ? "success" : "error");
    } finally {
      modelTestControllersRef.current.delete(modelId);
    }
  }

  async function runAllModelTests() {
    if (modelTestRunning) return;
    if (modelTestControllersRef.current.size > 0) {
      return flash("Cancel the running model test first");
    }
    const targetIds = distinctModelIds(selectedModels);
    if (!targetIds.length) return flash("Add at least one model first");
    const controller = new AbortController();
    modelTestBatchRef.current = controller;
    setModelTestProgress({ settled: 0, total: targetIds.length });
    let passed = 0;
    try {
      await runModelTests({
        targetIds,
        signal: controller.signal,
        onProgress: (settled) => {
          if (modelTestBatchRef.current === controller) setModelTestProgress({ settled, total: targetIds.length });
        },
        run: async (modelId, signal) => {
          const status = await probeModel(modelId, signal, controller);
          if (status?.ok) passed += 1;
        },
      });
      if (!controller.signal.aborted) {
        flash(
          `Models: ${passed}/${targetIds.length} passed`,
          passed === targetIds.length ? "success" : "default",
        );
      }
    } finally {
      // A cancelled batch must not clear the progress of the run that replaced it.
      if (modelTestBatchRef.current === controller) {
        modelTestBatchRef.current = null;
        setModelTestProgress(null);
      }
    }
  }

  function renderModelTest(modelId: string): ReactNode {
    const status = modelTestResults[modelId];
    const checking = testingModels.has(modelId);
    return (
      <>
        {checking ? (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-foreground/90"
            aria-live="polite"
            aria-label={`Checking ${modelId}`}
          >
            <span>Checking</span>
            <span className="inline-flex w-3 justify-start" aria-hidden="true">
              <span className="animate-pulse">.</span>
              <span className="animate-pulse [animation-delay:150ms]">.</span>
              <span className="animate-pulse [animation-delay:300ms]">.</span>
            </span>
          </span>
        ) : null}
        {status ? (
          <Tooltip label={status.message || status.label}>
            <StatusBadge
              tone={status.ok ? "ok" : "err"}
              className="max-w-[9rem] shrink-0 truncate text-[11px] font-semibold"
            >
              {status.label}
            </StatusBadge>
          </Tooltip>
        ) : null}
        <TestBtn
          compact
          busy={modelTestRunning || checking}
          label="Test"
          onTest={() => void runSingleModelTest(modelId)}
          onStop={() => (modelTestRunning ? stopModelTests() : stopSingleModelTest(modelId))}
        />
      </>
    );
  }

  async function persistStrategy(comboName: string, cfg: ComboStrategyConfig) {
    if (strategySavingRef.current) return;
    strategySavingRef.current = true;
    try {
      const current = settingsQ.data || {};
      const prev =
        (current.comboStrategies as Record<string, ComboStrategyConfig>) || {};
      await updateSettings({
        comboStrategies: {
          ...prev,
          [comboName]: { ...prev[comboName], ...cfg },
        },
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } finally {
      strategySavingRef.current = false;
    }
  }

  async function persistComboOrder(
    order: string[],
    rename?: { from: string; to: string },
  ) {
    const current = settingsQ.data || {};
    const prev =
      (current.comboStrategies as Record<string, ComboStrategyConfig>) || {};
    const renaming = rename !== undefined && rename.from !== rename.to;
    let comboStrategies = prev;
    if (renaming) {
      // The strategy entry is keyed by combo name — carry it through a rename
      // instead of leaving the new name on the global default.
      const { [rename.from]: moved, ...rest } = prev;
      comboStrategies = moved ? { ...rest, [rename.to]: moved } : rest;
    }
    await updateSettings({
      comboOrder: order,
      ...(renaming ? { comboStrategies } : {}),
    });
    await qc.invalidateQueries({ queryKey: ["settings"] });
  }

  async function onSave() {
    if (orderSavingRef.current) return;
    const n = name.trim();
    const models = selectedModels;
    if (nameError) {
      return flash(nameError, "error");
    }
    if (!models.length) return flash("Add at least one model", "error");
    setSaving(true);
    try {
      if (editCombo) {
        await updateCombo(editCombo.id || editCombo.name, {
          models,
          name: n !== editCombo.name ? n : undefined,
        });
        await persistComboOrder(
          combos.map((combo) =>
            (combo.id || combo.name) === (editCombo.id || editCombo.name)
              ? combo.id || n
              : combo.id || combo.name
          ),
          { from: editCombo.name, to: n },
        );
        await qc.invalidateQueries({ queryKey: ["combos"] });
        flash("Combo updated", "success");
      } else {
        const created = await createCombo({ name: n, models });
        await persistComboOrder([
          ...combos.map((combo) => combo.id || combo.name),
          created.id || created.name,
        ]);
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
    if (orderSavingRef.current) return;
    const target = deleteTarget;
    if (!target) return;
    setSaving(true);
    try {
      await deleteCombo(target.id || target.name);
      const current = settingsQ.data || {};
      const prev =
        (current.comboStrategies as Record<string, ComboStrategyConfig>) ||
        {};
      const next = { ...prev };
      delete next[target.name];
      await updateSettings({
        comboStrategies: next,
        comboOrder: combos
          .filter((combo) => (combo.id || combo.name) !== (target.id || target.name))
          .map((combo) => combo.id || combo.name),
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Header
        title="Combos"
        description={loading ? undefined : `${combos.length} combo${combos.length === 1 ? "" : "s"} · drag cards to reorder routes`}
        actions={
          <RippleButton size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add combo
          </RippleButton>
        }
      />

      <div className="relative max-w-md shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search combos…"
          className="pl-9"
        />
      </div>

      <Frame className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none bg-transparent p-0">
        <FramePanel className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-none border-0 bg-transparent p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : combos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground ring-1 ring-inset ring-border">
              <Route className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium">No combos yet</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Group models into one endpoint with automatic fallback.
              </p>
            </div>
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
          <div className="grid gap-3">
            {filtered.map((c) => {
              const cfg = strategies[c.name] || {};
              const strat = cfg.fallbackStrategy || "fallback";
              const meta = STRATEGY_META[strat];
              return (
                <article key={c.id || c.name} {...dragProps(c)} className={`group/card min-w-0 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-surface-hover/60 ${dragClassName(c)}`}>
                  <div className="flex items-start gap-3">
                    <span title="Drag to reorder" className="mt-2 shrink-0 cursor-grab text-muted-foreground/50 transition-colors group-hover/card:text-muted-foreground"><GripVertical className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><Route className="size-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm font-medium leading-tight">{c.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.models.length} model{c.models.length === 1 ? "" : "s"} · {meta.hint}</p>
                        </div>
                        <div className="relative shrink-0">
                          <Route className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <select aria-label={`Strategy for ${c.name}`} value={strat} disabled={saving || orderSaving} onChange={async (event) => { try { await persistStrategy(c.name, { ...cfg, fallbackStrategy: event.target.value as ComboStrategy }); flash("Strategy updated", "success"); } catch (err) { flash(getErrorMessage(err, "Strategy update failed"), "error"); } }} className="h-8 appearance-none rounded-lg border border-transparent bg-transparent pl-7 pr-7 text-[11px] font-medium text-foreground outline-none transition-colors hover:border-border/60 hover:bg-surface focus-visible:border-primary/50">
                            <option value="fallback">Fallback</option>
                            <option value="round-robin">Round-robin</option>
                            <option value="fusion">Fusion</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.models.map((model, index) => {
                          const caps = providerModels.find((item) => item.id === model)?.capabilities || {};
                          return (
                            <Fragment key={model}>
                              {index > 0 ? <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground/40" /> : null}
                              <Tooltip label={model}>
                                <span className="inline-flex min-w-0 max-w-[15rem] items-center gap-1.5 rounded-md border border-border/50 bg-surface/60 py-1 pl-1 pr-2 text-[11px]">
                                  <ProviderModelIcon provider={modelProviderId(model)} className="size-4" />
                                  <span className="truncate font-mono">{modelShortName(model)}</span>
                                  <ModelCapabilityChips capabilities={caps} />
                                </span>
                              </Tooltip>
                            </Fragment>
                          );
                        })}
                      </div>
                      {strat === "fusion" ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-medium text-muted-foreground">Judge</span>
                          <button
                            type="button"
                            onClick={() => setJudgeTarget(c)}
                            title="Pick the model that fuses panel answers"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed border-primary/40 px-1.5 py-0.5 font-mono text-[11px] text-primary transition-colors hover:border-primary hover:bg-primary/5"
                          >
                            <Sparkles className="size-3 shrink-0" />
                            <span className="truncate">{cfg.judgeModel || `Auto — ${c.models[0] || "first model"}`}</span>
                          </button>
                          {cfg.judgeModel ? (
                            <button
                              type="button"
                              title="Reset judge to Auto"
                              aria-label={`Reset judge for ${c.name}`}
                              onClick={async () => {
                                try {
                                  await persistStrategy(c.name, { ...cfg, judgeModel: undefined });
                                  flash("Judge reset to Auto", "success");
                                } catch (err) {
                                  flash(getErrorMessage(err, "Judge reset failed"), "error");
                                }
                              }}
                              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <X className="size-3" />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <CopyButton value={c.name} label="" iconOnly className="h-8 w-8 border-transparent bg-transparent px-0 text-muted-foreground hover:bg-surface-hover hover:text-foreground dark:bg-transparent dark:hover:bg-surface-hover" onCopy={() => flash("Copied", "success")} onCopyError={() => flash("Copy unavailable", "error")} />
                      <Tooltip label="Edit">
                        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground" onClick={() => openEdit(c)} aria-label="Edit combo"><Pencil className="h-3.5 w-3.5" /></button>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget(c)} aria-label="Delete combo"><Trash2 className="h-3.5 w-3.5" /></button>
                      </Tooltip>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
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
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-xl">
          <DialogHeader className="pb-1">
            <DialogTitle className="text-base font-semibold tracking-tight">
              {editCombo ? "Edit combo" : "Create combo"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Name the route and order its models. Requests walk the list top to bottom.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel
            scroll={false}
            className="flex min-h-0 flex-1 flex-col space-y-4"
          >
            <div className="space-y-2">
              <label
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70"
                htmlFor="combo-name"
              >
                Name
              </label>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  id="combo-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="smart"
                  className="h-10 items-center rounded-xl border-0 bg-white/[0.03] font-mono text-sm ring-1 ring-inset ring-white/[0.06] [&_input]:pl-9 dark:bg-white/[0.03] has-focus-visible:border-transparent has-focus-visible:ring-1 has-focus-visible:ring-primary/40"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only letters, numbers, <code className="font-mono">-</code>,{" "}
                <code className="font-mono">_</code> and{" "}
                <code className="font-mono">.</code> allowed
              </p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  Route order
                </span>
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {selectedModels.length}
                </span>
                <div className="flex-1" />
                {modelTestProgress ? (
                  <span
                    className="text-[11px] text-muted-foreground tabular-nums"
                    aria-live="polite"
                  >
                    {modelTestProgress.settled}/{modelTestProgress.total} tested
                  </span>
                ) : null}
                <TestBtn
                  busy={modelTestRunning}
                  label="Test all"
                  disabled={selectedModels.length === 0 || testingModels.size > 0}
                  onTest={() => void runAllModelTests()}
                  onStop={stopModelTests}
                />
              </div>
              <ComboModelBoard
                models={providerModels}
                selected={selectedModels}
                onModelsChange={setSelectedModels}
                loading={modelsQ.isLoading}
                error={modelsQ.error}
                renderSelectedExtra={renderModelTest}
                combos={comboModels.filter((combo) => combo.id !== name)}
              />
            </div>

          </DialogPanel>
          <DialogFooter variant="bare" className="border-t border-white/[0.06]">
            <span className="mr-auto hidden text-[11px] text-muted-foreground sm:block">
              {selectedModels.length} model{selectedModels.length === 1 ? "" : "s"} in route order
            </span>
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
            <RippleButton onClick={onSave} disabled={saving || orderSaving}>
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
              disabled={saving || orderSaving}
            >
              {saving ? "Deleting…" : "Delete"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModelPickDialog
        open={judgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setJudgeTarget(null);
        }}
        catalog={providerModels}
        picked={
          judgeTarget && strategies[judgeTarget.name]?.judgeModel
            ? new Set([strategies[judgeTarget.name].judgeModel as string])
            : new Set<string>()
        }
        onToggle={(id) => {
          const target = judgeTarget;
          if (!target) return;
          setJudgeTarget(null);
          void persistStrategy(target.name, {
            ...(strategies[target.name] || {}),
            judgeModel: id,
          })
            .then(() => flash("Judge updated", "success"))
            .catch((err) =>
              flash(getErrorMessage(err, "Judge update failed"), "error")
            );
        }}
        loading={modelsQ.isLoading}
        error={modelsQ.error}
        title="Select judge model"
        description="The judge fuses panel answers. Leave Auto to use the first model in the combo."
      />
    </div>
  );
}
