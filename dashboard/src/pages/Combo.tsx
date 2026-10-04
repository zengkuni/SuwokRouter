import { Fragment, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Boxes,
  Columns3,
  GripVertical,
  Hash,
  LayoutList,
  Loader2,
  Layers2,
  Pencil,
  Plus,
  Route,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { comboGroupError, comboNameError } from "@/lib/comboForm";
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
  const [deleteTargets, setDeleteTargets] = useState<Combo[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [saving, setSaving] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [draggedCombo, setDraggedCombo] = useState<string | null>(null);
  const [dragOverCombo, setDragOverCombo] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [orderSaving, setOrderSaving] = useState(false);
  const orderSavingRef = useRef(false);
  const strategySavingRef = useRef(false);

  const [name, setName] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [group, setGroup] = useState("");
  // Judge is edited from the combo card (list), not from this dialog.
  const [judgeTarget, setJudgeTarget] = useState<Combo | null>(null);
  const [testingModels, setTestingModels] = useState<ReadonlySet<string>>(new Set<string>());
  const [modelTestResults, setModelTestResults] = useState<Readonly<Record<string, ModelTestStatus>>>({});
  const [disabledModels, setDisabledModels] = useState<ReadonlySet<string>>(new Set<string>());
  const [modelTestProgress, setModelTestProgress] = useState<{ settled: number; total: number } | null>(null);
  const modelTestRunning = modelTestProgress !== null;
  const modelTestControllersRef = useRef<Map<string, AbortController>>(new Map());
  const modelTestBatchRef = useRef<AbortController | null>(null);
  // Latest run owning each model's probe; a stale (cancelled) run must not
  // touch the flag or result of the run that replaced it.
  const modelTestOwnerRef = useRef<Map<string, AbortController>>(new Map());
  // Card-level tests are scoped per combo: results and running state must not
  // leak into other cards that share a model, nor into the dialog test state.
  const [cardTestResults, setCardTestResults] = useState<Readonly<Record<string, Readonly<Record<string, ModelTestStatus>>>>>({});
  const [cardTestRunning, setCardTestRunning] = useState<ReadonlySet<string>>(new Set<string>());
  const cardTestAbortRef = useRef<Map<string, AbortController>>(new Map());
  // Which cards' models accordion is open; a card test auto-opens its own list.
  const [openCardModels, setOpenCardModels] = useState<ReadonlySet<string>>(new Set<string>());

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
    enabled: probeEnabled(),
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

  // Same non-empty label = one section; empty/null renders under "Ungrouped" last.
  const existingGroups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const combo of combos) {
      const g = combo.group?.trim();
      if (!g) continue;
      const k = g.toLowerCase();
      if (!seen.has(k)) seen.set(k, g);
    }
    return [...seen.values()].sort();
  }, [combos]);
  const trimmedLabel = (g: string | null | undefined) => g?.trim() ?? "";
  const sections = useMemo(() => {
    const buckets = new Map<string, Combo[]>();
    for (const combo of filtered) {
      const trimmed = combo.group?.trim() ?? "";
      const key = trimmed ? trimmed.toLowerCase() : "__ungrouped__";
      const bucket = buckets.get(key);
      if (bucket) bucket.push(combo);
      else buckets.set(key, [combo]);
    }
    const grouped: { value: string; label: string; combos: Combo[] }[] = [];
    let ungrouped: Combo[] | null = null;
    for (const [key, items] of buckets) {
      if (key === "__ungrouped__") {
        ungrouped = items;
        continue;
      }
      grouped.push({ value: `g:${key}`, label: trimmedLabel(items[0].group), combos: items });
    }
    if (ungrouped) {
      grouped.push({ value: "g:__ungrouped__", label: "Ungrouped", combos: ungrouped });
    }
    return grouped;
  }, [filtered]);

  function flash(msg: string, tone: "success" | "error" | "default" = "default") {
    if (tone === "success") toast.success(msg);
    else if (tone === "error") toast.error(msg);
    else toast(msg);
  }

  function clearDrag() {
    setDraggedCombo(null);
    setDragOverCombo(null);
  }

  const combosById = useMemo(
    () => new Map(combos.map((combo) => [combo.id || combo.name, combo])),
    [combos],
  );
  function groupOf(id: string): string | null {
    const g = combosById.get(id)?.group?.trim();
    return g ? g.toLowerCase() : null;
  }

  async function onDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const sourceId = draggedCombo;
    clearDrag();
    if (!sourceId || sourceId === targetId || orderSavingRef.current) return;
    // Reordering is within a group only: a cross-group drop reassigns the
    // group instead (kanban), never reorders across sections.
    if (groupOf(sourceId) !== groupOf(targetId)) return;
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

  /** Shared drop-zone handlers: kanban sections and list accordion items both
   *  accept a dragged combo from a different group (moves it here) and a
   *  dragged group header (reorders this section). */
  function sectionDragProps(section: { value: string; label: string }) {
    return {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (orderSavingRef.current) return;
        if (draggedGroup ? draggedGroup === section.value : !draggedCombo) return;
        event.preventDefault();
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (orderSavingRef.current) return;
        if (draggedGroup) {
          if (draggedGroup === section.value) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOverGroup(section.value);
          return;
        }
        if (!draggedCombo) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOverSection(section.value);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOverSection((current) => (current === section.value ? null : current));
          setDragOverGroup((current) => (current === section.value ? null : current));
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const sourceId = draggedCombo;
        const sourceGroup = draggedGroup;
        clearDrag();
        setDraggedGroup(null);
        setDragOverSection(null);
        setDragOverGroup(null);
        if (sourceGroup && sourceGroup !== section.value) {
          void moveGroupBefore(sourceGroup, section.value);
          return;
        }
        if (sourceId) void moveToSection(section, sourceId);
      },
    };
  }

  /** Drag a group header (grip + name) to reorder sections. */
  function groupDragProps(section: { value: string; label: string }) {
    return {
      draggable: !orderSaving && !saving && !createOpen && !deleteTargets && settingsQ.isSuccess && !draggedCombo,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest("input, select, textarea, a")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `group:${section.value}`);
        clearDrag();
        setDraggedGroup(section.value);
      },
      onDragEnd: () => {
        setDraggedGroup(null);
        setDragOverGroup(null);
      },
    };
  }

  /** Drop-zone counterpart on another group's header. */
  function groupHeaderDropProps(section: { value: string; label: string }) {
    return {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!draggedGroup || draggedGroup === section.value || orderSavingRef.current) return;
        event.preventDefault();
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!draggedGroup || draggedGroup === section.value || orderSavingRef.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOverGroup(section.value);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOverGroup((current) => (current === section.value ? null : current));
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const source = draggedGroup;
        setDraggedGroup(null);
        setDragOverGroup(null);
        if (source && source !== section.value) void moveGroupBefore(source, section.value);
      },
    };
  }

  /** Reorder groups: move `sourceValue` to `targetValue`'s position by rewriting comboOrder. */
  async function moveGroupBefore(sourceValue: string, targetValue: string) {
    if (!sourceValue || sourceValue === targetValue || orderSavingRef.current) return;
    const key = (value: string) => value.replace(/^g:/, "");
    const currentOrder = sections.map((section) => section.value);
    const from = currentOrder.indexOf(sourceValue);
    const to = currentOrder.indexOf(targetValue);
    if (from < 0 || to < 0) return;
    const nextSections = [...currentOrder];
    const [moved] = nextSections.splice(from, 1);
    nextSections.splice(to, 0, moved);
    const groupKey = (combo: Combo) => {
      const trimmed = combo.group?.trim() ?? "";
      return trimmed ? trimmed.toLowerCase() : "__ungrouped__";
    };
    const byGroup = new Map<string, Combo[]>();
    for (const combo of combos) {
      const k = groupKey(combo);
      const bucket = byGroup.get(k);
      if (bucket) bucket.push(combo);
      else byGroup.set(k, [combo]);
    }
    const order: string[] = [];
    const placed = new Set<string>();
    for (const value of nextSections) {
      const k = key(value);
      placed.add(k);
      for (const combo of byGroup.get(k) ?? []) order.push(combo.id || combo.name);
    }
    // Groups hidden by the current filter keep their existing relative order at the end.
    for (const [k, items] of byGroup) {
      if (placed.has(k)) continue;
      for (const combo of items) order.push(combo.id || combo.name);
    }
    orderSavingRef.current = true;
    setOrderSaving(true);
    try {
      await qc.cancelQueries({ queryKey: ["settings"] });
      await updateSettings({ comboOrder: order });
      qc.setQueryData<AppSettings>(["settings"], (current) => ({
        ...current,
        comboOrder: order,
      }));
      const label = sections.find((section) => section.value === moved)?.label ?? moved;
      flash(`Moved ${label} to position ${to + 1}`, "success");
    } catch (err) {
      flash(getErrorMessage(err, "Failed to save group order"), "error");
    } finally {
      orderSavingRef.current = false;
      setOrderSaving(false);
    }
  }

  async function moveToSection(
    section: { value: string; label: string },
    sourceId: string,
  ) {
    if (!sourceId || orderSavingRef.current) return;
    const targetKey = section.value.replace(/^g:/, "");
    const targetGroup = targetKey === "__ungrouped__" ? null : section.label;
    if (groupOf(sourceId) === (targetGroup ? targetGroup.toLowerCase() : null)) return;
    const combo = combosById.get(sourceId);
    if (!combo) return;
    setSaving(true);
    try {
      await updateCombo(sourceId, { group: targetGroup });
      qc.setQueryData<{ combos: Combo[] }>(["combos"], (current) =>
        current
          ? {
              ...current,
              combos: current.combos.map((item) =>
                (item.id || item.name) === sourceId ? { ...item, group: targetGroup } : item,
              ),
            }
          : current,
      );
      flash(`Moved ${combo.name} to ${targetGroup ?? "Ungrouped"}`, "success");
    } catch (err) {
      flash(getErrorMessage(err, "Failed to move combo"), "error");
    } finally {
      setSaving(false);
    }
  }

  function dragProps(combo: Combo) {
    const id = combo.id || combo.name;
    return {
      draggable: !orderSaving && !saving && !createOpen && !deleteTargets && settingsQ.isSuccess && !draggedGroup,
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
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!draggedCombo || draggedCombo === id || orderSavingRef.current) return;
        event.preventDefault();
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOverCombo((current) => current === id ? null : current);
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const sourceId = draggedCombo;
        if (sourceId && sourceId !== id && groupOf(sourceId) !== groupOf(id)) {
          // Cross-group drop: leave the event unclaimed so the enclosing
          // section (kanban block / accordion item) moves the combo.
          return;
        }
        void onDrop(event, id);
      },
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
    setDisabledModels(new Set<string>());
    setGroup("");
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
    setDisabledModels(new Set(c.disabledModels ?? []));
    setGroup(c.group ?? "");
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
      if (isCurrent()) {
        setModelTestResults((previous) => ({ ...previous, [modelId]: status }));
        // A failed probe disables the model in the route; a passing probe re-enables it
        // so the checkbox tracks the latest result unless the user overrode it by hand.
        if (!status.ok) setDisabledModels((previous) => { const next = new Set(previous); next.add(modelId); return next; });
        else setDisabledModels((previous) => { const next = new Set(previous); next.delete(modelId); return next; });
      }
      return status;
    } catch (error) {

      if (signal.aborted) return null;
      const status = formatModelTestResult({
        ok: false,
        error: getErrorMessage(error, "Model test failed"),
      });
      if (isCurrent()) {
        setModelTestResults((previous) => ({ ...previous, [modelId]: status }));
        // A failed ping drops the model from the saved route until the user re-enables it.
        setDisabledModels((previous) => new Set(previous).add(modelId));
      }
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

  async function runModelTestBatch(targetIds: readonly string[], subject: string) {
    if (modelTestRunning) return;
    if (modelTestControllersRef.current.size > 0) {
      return flash("Cancel the running model test first");
    }
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
          `${subject}: ${passed}/${targetIds.length} passed`,
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

  function runAllModelTests() {
    void runModelTestBatch(distinctModelIds(selectedModels), "Models");
  }
  function comboTestKey(c: Combo) {
    return c.id || c.name;
  }

  // "Test all" semantics for a card: failed models are disabled (and passing
  // ones re-enabled) once, at the end of the batch, to avoid racing PATCHes.
  async function applyCardTestDisabled(c: Combo, outcomes: ReadonlyMap<string, boolean>) {
    const next = new Set(c.disabledModels ?? []);
    const failed: string[] = [];
    let changed = false;
    for (const [modelId, ok] of outcomes) {
      if (ok) {
        if (next.delete(modelId)) changed = true;
      } else {
        failed.push(modelShortName(modelId));
        if (!next.has(modelId)) {
          next.add(modelId);
          changed = true;
        }
      }
    }
    if (!changed) return;
    try {
      await updateCombo(comboTestKey(c), { disabledModels: [...next] });
      await qc.invalidateQueries({ queryKey: ["combos"] });
      if (failed.length) flash(`Disabled ${failed.join(", ")} in ${c.name}`, "default");
    } catch (error) {
      flash(getErrorMessage(error, "Failed to save disabled models"), "error");
    }
  }

  // Same batch engine as the dialog's "Test all", but every piece of state is
  // scoped to one combo so testing a card never touches other cards.
  async function runCardModelTest(c: Combo) {
    const key = comboTestKey(c);
    if (cardTestRunning.has(key)) return;
    const targetIds = distinctModelIds(c.models);
    if (!targetIds.length) return flash("This combo has no models to test");
    const controller = new AbortController();
    cardTestAbortRef.current.set(key, controller);
    setCardTestRunning((previous) => new Set(previous).add(key));
    setOpenCardModels((previous) => new Set(previous).add(key));
    let passed = 0;
    const outcomes = new Map<string, boolean>();
    try {
      await runModelTests({
        targetIds,
        signal: controller.signal,
        onProgress: () => {},
        run: async (modelId, signal) => {
          const status = await testGatewayModel(modelId, signal);
          outcomes.set(modelId, status.ok);
          setCardTestResults((previous) => ({ ...previous, [key]: { ...previous[key], [modelId]: status } }));
          if (status.ok) passed += 1;
        },
      });
      if (!controller.signal.aborted) {
        await applyCardTestDisabled(c, outcomes);
        flash(
          `${c.name}: ${passed}/${targetIds.length} passed`,
          passed === targetIds.length ? "success" : "default",
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) flash(getErrorMessage(error, "Combo test failed"), "error");
    } finally {
      // A cancelled run whose replacement started already must not clear the
      // state that now belongs to that newer run (mirrors modelTestBatchRef).
      if (cardTestAbortRef.current.get(key) === controller) {
        cardTestAbortRef.current.delete(key);
        setCardTestRunning((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    }
  }

  function stopCardModelTest(c: Combo) {
    const key = comboTestKey(c);
    cardTestAbortRef.current.get(key)?.abort();
    cardTestAbortRef.current.delete(key);
    setCardTestRunning((previous) => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
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
    if (!models.some((id) => !disabledModels.has(id))) {
      return flash(
        selectedModels.length === 0 ? "Add at least one model" : "Enable at least one model",
        "error",
      );
    }
    const groupError = comboGroupError(group);
    if (groupError) {
      return flash(groupError, "error");
    }
    const g = group.trim() || null;
    const disabledList = models.filter((id) => disabledModels.has(id));
    setSaving(true);
    try {
      if (editCombo) {
        await updateCombo(editCombo.id || editCombo.name, {
          models,
          name: n !== editCombo.name ? n : undefined,
          group: g,
          disabledModels: disabledList,
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
        const created = await createCombo({ name: n, models, group: g, disabledModels: disabledList });
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
    const targets = deleteTargets;
    if (!targets?.length) return;
    setSaving(true);
    try {
      const removed = new Set(targets.map((combo) => combo.id || combo.name));
      for (const combo of targets) {
        await deleteCombo(combo.id || combo.name);
      }
      const current = settingsQ.data || {};
      const prev =
        (current.comboStrategies as Record<string, ComboStrategyConfig>) ||
        {};
      const nextStrategies = { ...prev };
      for (const combo of targets) delete nextStrategies[combo.name];
      await updateSettings({
        comboStrategies: nextStrategies,
        comboOrder: combos
          .filter((combo) => !removed.has(combo.id || combo.name))
          .map((combo) => combo.id || combo.name),
      });
      setSelected(new Set<string>());
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["combos"] });
      const n = targets.length;
      flash(`${n} combo${n === 1 ? "" : "s"} deleted`, "success");
      setDeleteTargets(null);
    } catch (err) {
      flash(getErrorMessage(err, "Delete failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function applyBulkStrategy(value: ComboStrategy) {
    if (!selected.size || strategySavingRef.current) return;
    strategySavingRef.current = true;
    try {
      const current = settingsQ.data || {};
      const prev =
        (current.comboStrategies as Record<string, ComboStrategyConfig>) || {};
      const next = { ...prev };
      for (const combo of combos) {
        const id = combo.id || combo.name;
        if (selected.has(id)) {
          next[combo.name] = { ...prev[combo.name], fallbackStrategy: value };
        }
      }
      await updateSettings({ comboStrategies: next });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      flash(`Strategy applied to ${selected.size} combo${selected.size === 1 ? "" : "s"}`, "success");
    } catch (err) {
      flash(getErrorMessage(err, "Strategy update failed"), "error");
    } finally {
      strategySavingRef.current = false;
    }
  }

  function toggleSelected(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleSelected = useMemo(
    () => filtered.filter((combo) => selected.has(combo.id || combo.name)),
    [filtered, selected],
  );
  const allVisibleSelected =
    filtered.length > 0 && visibleSelected.length === filtered.length;

  const renderComboCard = (c: Combo, handlers = dragProps(c)) => {
    const cfg = strategies[c.name] || {};
    const strat = cfg.fallbackStrategy || "fallback";
    const meta = STRATEGY_META[strat];
    const cardKey = comboTestKey(c);
    const cardRunning = cardTestRunning.has(cardKey);
    const cardResults = cardTestResults[cardKey];
    return (
      <article {...handlers} className={`group/card min-w-0 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-surface-hover/60 ${dragClassName(c)}`}>
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selected.has(c.id || c.name)}
            onCheckedChange={() => toggleSelected(c.id || c.name)}
            aria-label={`Select ${c.name}`}
            className="mt-2 shrink-0"
          />
          <span title="Drag to reorder" className="mt-2 shrink-0 cursor-grab text-muted-foreground/50 transition-colors group-hover/card:text-muted-foreground"><Layers2 className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-medium leading-tight">{c.name}</p>
              </div>
              <Select
                value={strat}
                disabled={saving || orderSaving}
                onValueChange={async (value) => {
                  try {
                    await persistStrategy(c.name, { ...cfg, fallbackStrategy: (value ?? "fallback") as ComboStrategy });
                    flash("Strategy updated", "success");
                  } catch (err) {
                    flash(getErrorMessage(err, "Strategy update failed"), "error");
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`Strategy for ${c.name}`}
                  className="h-8 w-auto min-w-0 gap-1.5 border-transparent bg-transparent pl-7 pr-1.5 text-[11px] font-medium text-foreground shadow-none hover:bg-surface data-disabled:opacity-40"
                >
                  <Route className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <span className="truncate">{meta.label}</span>
                </SelectTrigger>
                <SelectPopup align="end" className="min-w-[10rem]">
                  <SelectItem value="fallback">Fallback</SelectItem>
                  <SelectItem value="round-robin">Round-robin</SelectItem>
                  <SelectItem value="fusion">Fusion</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <Accordion
              value={openCardModels.has(cardKey) ? ["models"] : []}
              onValueChange={(value) =>
                setOpenCardModels((previous) => {
                  const next = new Set(previous);
                  if (value.includes("models")) next.add(cardKey);
                  else next.delete(cardKey);
                  return next;
                })
              }
              className="w-full"
            >
              <AccordionItem value="models" className="border-0">
                <AccordionTrigger className="w-fit flex-none justify-start gap-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span>{c.models.length} model{c.models.length === 1 ? "" : "s"}</span>
                    <span aria-hidden="true" className="text-muted-foreground/40">·</span>
                    <span className="truncate">{meta.hint}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="min-w-0 pb-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.models.map((model, index) => {
                      const off = (c.disabledModels ?? []).includes(model);
                      const testStatus = cardResults?.[model];
                      const testChecking = cardRunning && !testStatus;
                      const caps = providerModels.find((item) => item.id === model)?.capabilities || {};
                      return (
                        <Fragment key={model}>
                          {index > 0 ? <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground/40" /> : null}
                          <Tooltip label={model}>
                            <span className={`inline-flex min-w-0 max-w-[15rem] items-center gap-1.5 rounded-md border bg-surface/60 py-1 pl-1 pr-2 text-[11px] ${off ? "border-dashed border-border/40 opacity-50" : "border-border/50"}`}>
                              <ProviderModelIcon provider={modelProviderId(model)} className="size-4" />
                              <span className="truncate font-mono">{modelShortName(model)}</span>
                              {off ? <span className="font-sans text-[9px] font-medium uppercase tracking-wide text-muted-foreground">off</span> : null}
                              {testChecking ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-400" title={`Checking ${model}`} /> : null}
                              {testStatus && !testChecking ? <span title={testStatus.message || testStatus.label} className={`size-1.5 shrink-0 rounded-full ${testStatus.ok ? "bg-emerald-500" : "bg-destructive"}`} /> : null}
                              <ModelCapabilityChips capabilities={caps} />
                            </span>
                          </Tooltip>
                        </Fragment>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
            <Tooltip label={cardRunning ? "Cancel test" : `Test ${c.models.length} model${c.models.length === 1 ? "" : "s"}`}>
              <button
                type="button"
                onClick={() => (cardRunning ? stopCardModelTest(c) : void runCardModelTest(c))}
                aria-label={`Test ${c.name} models`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {cardRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              </button>
            </Tooltip>
            <CopyButton value={c.name} label="" iconOnly className="h-8 w-8 border-transparent bg-transparent px-0 text-muted-foreground hover:bg-surface-hover hover:text-foreground dark:bg-transparent dark:hover:bg-surface-hover" onCopy={() => flash("Copied", "success")} onCopyError={() => flash("Copy unavailable", "error")} />
            <Tooltip label="Edit">
              <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground" onClick={() => openEdit(c)} aria-label="Edit combo"><Pencil className="h-3.5 w-3.5" /></button>
            </Tooltip>
            <Tooltip label="Delete">
              <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTargets([c])} aria-label="Delete combo"><Trash2 className="h-3.5 w-3.5" /></button>
            </Tooltip>
          </div>
        </div>
      </article>
    );
  };

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

      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/80 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <label className="flex h-8 shrink-0 cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <Checkbox
            checked={allVisibleSelected}
            indeterminate={visibleSelected.length > 0 && !allVisibleSelected}
            disabled={loading || filtered.length === 0}
            onCheckedChange={() => {
              if (allVisibleSelected) setSelected(new Set<string>());
              else setSelected(new Set(filtered.map((combo) => combo.id || combo.name)));
            }}
            aria-label="Select all combos"
          />
          <span>{visibleSelected.length > 0 ? `${visibleSelected.length} selected` : `Select all (${filtered.length})`}</span>
        </label>
        <span className="hidden h-5 w-px shrink-0 bg-border/80 sm:block" aria-hidden />
        <div className="flex flex-wrap items-center gap-1">
          <Select
            value=""
            disabled={saving || orderSaving || visibleSelected.length === 0}
            onValueChange={(value) => {
              if (value) void applyBulkStrategy(value as ComboStrategy);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Set strategy for selected combos"
              className="h-8 w-auto min-w-0 gap-1.5 rounded-lg border-border/60 bg-background/70 px-2.5 text-[11px] font-medium text-muted-foreground shadow-none hover:bg-muted/60 data-disabled:opacity-40 data-popup-open:bg-muted/60"
            >
              <span className="truncate">Set strategy…</span>
            </SelectTrigger>
            <SelectPopup align="end" className="min-w-[10rem]">
              <SelectItem value="fallback">Fallback</SelectItem>
              <SelectItem value="round-robin">Round-robin</SelectItem>
              <SelectItem value="fusion">Fusion</SelectItem>
            </SelectPopup>
          </Select>
          <RippleButton
            variant="destructive"
            size="sm"
            disabled={saving || orderSaving || visibleSelected.length === 0}
            onClick={() => setDeleteTargets(visibleSelected)}
            aria-label={visibleSelected.length > 0 ? `Delete ${visibleSelected.length} selected` : "Delete selected"}
            title={visibleSelected.length > 0 ? `Delete ${visibleSelected.length} selected` : "Delete selected"}
            className="size-8 shrink-0 p-0 sm:h-8"
          >
            <Trash2 className="size-3.5" />
          </RippleButton>
          <button
            type="button"
            disabled={visibleSelected.length === 0}
            onClick={() => setSelected(new Set<string>())}
            aria-label="Clear selection"
            title="Clear selection"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/70 p-0.5" role="group" aria-label="View mode">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
            title="List view"
            className={`flex h-7 items-center justify-center rounded-md px-1.5 transition-colors ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
          >
            <LayoutList className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            aria-label="Kanban view"
            aria-pressed={viewMode === "kanban"}
            title="Kanban view"
            className={`flex h-7 items-center justify-center rounded-md px-1.5 transition-colors ${viewMode === "kanban" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
          >
            <Columns3 className="size-3.5" />
          </button>
        </div>
        <div className="relative min-w-[14rem] max-w-sm grow">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search combos…"
            className="h-8 rounded-lg border-border/60 bg-background/70 pl-9 shadow-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
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
              <Layers2 className="size-5" />
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
        ) : viewMode === "kanban" ? (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-y-contain p-4">
            {sections.map((section) => {
              return (
                <div
                  key={section.value}
                  {...sectionDragProps(section)}
                  className={`flex shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors ${
                    dragOverSection === section.value
                      ? "border-primary/60 bg-primary/5 ring-2 ring-inset ring-primary/40"
                      : dragOverGroup === section.value
                        ? "border-primary/60 ring-2 ring-inset ring-primary/40"
                        : "border-border/70"
                  }`}
                >
                  <div
                    {...groupDragProps(section)}
                    {...groupHeaderDropProps(section)}
                    className={`flex cursor-grab items-center gap-2 border-b border-border/60 px-3 py-2 transition-colors ${
                      draggedGroup === section.value ? "opacity-40" : ""
                    } ${
                      dragOverGroup === section.value
                        ? "rounded-t-xl bg-primary/10 ring-2 ring-inset ring-primary/50"
                        : ""
                    }`}
                  >
                    <GripVertical className="size-4 shrink-0 text-muted-foreground/50 transition-colors" />
                    <Boxes className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </span>
                    <span className="ml-auto shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] font-normal normal-case tracking-normal text-muted-foreground/80">
                      {section.combos.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-3 p-3">
                    {section.combos.map((c) => (
                      <Fragment key={c.id || c.name}>{renderComboCard(c)}</Fragment>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Accordion
            key={`${query.trim() ? `search:${query.trim().toLowerCase()}` : "browse"}:${sections.map((section) => section.value).join("|")}`}
            multiple
            defaultValue={query.trim() ? sections.map((section) => section.value) : []}
            className="w-full"
          >
            {sections.map((section) => (
              <AccordionItem
                key={section.value}
                value={section.value}
                {...sectionDragProps(section)}
                className={`border-border/70 px-1 transition-colors last:border-b-0 ${
                  dragOverSection === section.value ? "bg-primary/5 ring-2 ring-inset ring-primary/40" : ""
                } ${
                  dragOverGroup === section.value ? "bg-primary/5 ring-2 ring-inset ring-primary/40" : ""
                }`}
              >
                <AccordionTrigger
                  {...groupDragProps(section)}
                  {...groupHeaderDropProps(section)}
                  className={`w-full cursor-grab justify-start gap-1.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground sm:py-2.5 ${
                    draggedGroup === section.value ? "opacity-40" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors" />
                    <Boxes className="size-4" />
                    <span className="truncate">{section.label}</span>
                    <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] font-normal normal-case tracking-normal text-muted-foreground/80">
                      {section.combos.length}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="min-w-0">
                  <div className="grid gap-3">
                    {section.combos.map((c) => (
                      <Fragment key={c.id || c.name}>{renderComboCard(c)}</Fragment>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
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
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0 space-y-2">
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
                    placeholder="combo-name"
                    className="h-10 items-center rounded-xl border-0 bg-white/[0.03] font-mono text-sm ring-1 ring-inset ring-white/[0.06] [&_input]:pl-9 dark:bg-white/[0.03] has-focus-visible:border-transparent has-focus-visible:ring-1 has-focus-visible:ring-primary/40"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Only letters, numbers, <code className="font-mono">-</code>,{" "}
                  <code className="font-mono">_</code> and{" "}
                  <code className="font-mono">.</code> allowed
                </p>
              </div>
              <div className="min-w-0 space-y-2">
                <label
                  className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70"
                  htmlFor="combo-group"
                >
                  Group
                </label>
                <div className="relative">
                  <Boxes className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    id="combo-group"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    list="combo-groups"
                    placeholder="group-name"
                    className="h-10 items-center rounded-xl border-0 bg-white/[0.03] font-mono text-sm ring-1 ring-inset ring-white/[0.06] [&_input]:pl-9 dark:bg-white/[0.03] has-focus-visible:border-transparent has-focus-visible:ring-1 has-focus-visible:ring-primary/40"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Same group = one section. Empty = ungrouped.
                </p>
              </div>
            </div>
            <datalist id="combo-groups">
              {existingGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
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
                disabledModels={disabledModels}
                onToggleEnabled={(id, enabled) =>
                  setDisabledModels((previous) => {
                    const next = new Set(previous);
                    if (enabled) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
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
        open={!!deleteTargets?.length}
        onOpenChange={(o) => {
          if (!o) setDeleteTargets(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTargets && deleteTargets.length > 1
                ? `Delete ${deleteTargets.length} combos?`
                : "Delete combo?"}
            </DialogTitle>
            <DialogDescription>
              {deleteTargets && deleteTargets.length > 1 ? (
                <>
                  <span className="font-medium text-foreground">
                    {deleteTargets.map((combo) => combo.name).join(", ")}
                  </span>{" "}
                  and their strategy overrides will be removed.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {deleteTargets?.[0]?.name}
                  </span>{" "}
                  and its strategy override will be removed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => setDeleteTargets(null)}
              disabled={saving}
            >
              Cancel
            </RippleButton>
            <RippleButton
              variant="destructive"
              onClick={onDelete}
              disabled={saving || orderSaving}
            >
              {saving ? "Deleting…" : `Delete${deleteTargets && deleteTargets.length > 1 ? ` (${deleteTargets.length})` : ""}`}
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
