import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Download, Eye, EyeOff, FileJson, Plus, RefreshCw, RotateCcw, Search, Star, Terminal, X } from "lucide-react";
import { Header } from "@/components/Header";
import { RippleButton } from "@/components/animate/ripple-button";
import {
  ProviderModelAccordion,
  ProviderModelIcon,
} from "@/components/ProviderModelAccordion";
import { StatusBadge } from "@/components/StatusBadge";
import { Frame, FrameHeader, FramePanel } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { CopyButton } from "@/components/animate/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/api";
import { probeEnabled } from "@/lib/live-mode";
import {
  connectCliTool,
  disconnectCliTool,
  fetchCliTools,
  fetchModels,
  resetCliTool,
  type CliTool,
  type ConnectBody,
  type ModelInfo,
} from "@/lib/cli-tools-api";
import { getApiKeyRaw, listApiKeys, displayPrefix } from "@/lib/api-keys-api";
import { formatCliConfig } from "@/lib/cli-config";

const TOOL_DESC: Record<string, string> = {
  claude: "Anthropic Claude Code CLI",
  codex: "OpenAI Codex CLI",
  hermes: "Nous Research agent",
  opencode: "OpenCode terminal assistant",
  cowork: "Claude Desktop third-party inference",
  kilo: "Kilo Code assistant",
  "grok-build": "Grok Build coding agent",
  omp: "oh-my-pi — Rust coding agent (local gateway)",
};

const TOOL_ICON_SRC: Record<string, string> = {
  claude: "/providers/claude.svg",
  cowork: "/providers/claude.svg",
  codex: "/providers/codex.svg",
  "grok-build": "/providers/grok.svg",
  hermes: "/providers/hermesagent.svg",
  kilo: "/providers/kilocode.svg",
  omp: "/providers/omp.svg",
  opencode: "/providers/opencode.svg",
};

const SINGLE_MODEL_TOOLS = new Set(["kilo", "hermes", "grok-build"]);
const SUBAGENT_TOOLS = new Set(["codex", "opencode"]);
const ARRAY_MODEL_TOOLS = new Set(["opencode", "omp"]);
const BASE_URL = "/v1";

function isClaudeCode(toolId: string) {
  return toolId === "claude";
}

function endpointFor(toolId: string, origin: string) {
  if (!origin) return "—";
  return toolId === "claude" ? origin : `${origin}${BASE_URL}`;
}

function toolCanConfigure(t: CliTool) {
  return t.tier === "config";
}

function toolSupportsDisconnect(t: CliTool) {
  return toolCanConfigure(t);
}

const CLAUDE_TIERS = [
  { key: "fable", label: "Fable", hint: "Claude Fable" },
  { key: "opus", label: "Opus", hint: "Claude Opus" },
  { key: "sonnet", label: "Sonnet", hint: "Claude Sonnet" },
  { key: "haiku", label: "Haiku", hint: "Claude Haiku" },
] as const;

type ClaudeTierKey = (typeof CLAUDE_TIERS)[number]["key"];

function maskKey(key: string) {
  if (!key) return "key unavailable";
  const head = key.slice(0, Math.min(10, key.length));
  return `${head}${"•".repeat(8)}`;
}

type Slots = {

  primary: string;
  subagent: string;

  models: string[];
  active: string;

  fable: string;
  opus: string;
  sonnet: string;
  haiku: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function emptySlots(): Slots {
  return {
    primary: "",
    subagent: "",
    models: [],
    active: "",
    fable: "",
    opus: "",
    sonnet: "",
    haiku: "",
  };
}

function seedSlots(t: CliTool): Slots {
  const empty = emptySlots();

  if (t.id === "claude") {
    const settings = asRecord(t.raw?.settings);
    const env = asRecord(settings.env);
    const hasStoredEnv = Object.keys(env).some((key) => key.startsWith("ANTHROPIC_DEFAULT_"));
    if (hasStoredEnv) {
      return {
        ...empty,
        fable: asString(env.ANTHROPIC_DEFAULT_FABLE_MODEL),
        opus: asString(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
        sonnet: asString(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
        haiku: asString(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
      };
    }
  }

  const raw = asRecord(t.raw);
  const nested = asRecord(raw[t.id]);
  const storedModels = asStringArray(nested.models).length
    ? asStringArray(nested.models)
    : (t.models ?? []);
  const activeModel = asString(nested.activeModel);

  if (ARRAY_MODEL_TOOLS.has(t.id)) {
    return {
      ...empty,
      models: storedModels,
      active: storedModels.includes(activeModel) ? activeModel : (storedModels[0] || ""),
    };
  }

  return {
    ...empty,
    primary: storedModels[0] || "",
  };
}

function groupModels(
  models: ModelInfo[],
  query: string
): Array<{ provider: string; items: ModelInfo[] }> {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
      )
    : models;

  const map = new Map<string, ModelInfo[]>();
  for (const m of filtered) {
    const key = m.provider || "other";
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  }

  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));

  return keys.map((provider) => ({
    provider,
    items: map.get(provider)!,
  }));
}

export default function CliTools() {
  const qc = useQueryClient();
  const SELECTED_KEY = "nr-cli-selected-tool";
  const [slots, setSlots] = useState<Record<string, Slots>>({});
  const [pending, setPending] = useState<{
    id: string;
    kind: "apply" | "disconnect" | "reset";
  } | null>(null);
  const [rawKey, setRawKey] = useState("");
  const [manualConfigOpen, setManualConfigOpen] = useState(false);
  const [revealConfigKey, setRevealConfigKey] = useState(false);
  const [resetTarget, setResetTarget] = useState<CliTool | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const [toolQuery, setToolQuery] = useState("");

  function selectTool(id: string | null) {
    setSelectedId(id);
    try {
      if (id) localStorage.setItem(SELECTED_KEY, id);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {

    }
  }

  const toolsQ = useQuery({
    queryKey: ["cli-tools"],
    queryFn: fetchCliTools,
    enabled: probeEnabled(),
    retry: false,
  });

  const keysQ = useQuery({
    queryKey: ["api-keys-for-cli"],
    queryFn: () => listApiKeys(),
    enabled: probeEnabled(),
    retry: false,
  });

  const modelsQ = useQuery({
    queryKey: ["cli-tools", "models"],
    queryFn: fetchModels,
    enabled: probeEnabled(),
    retry: false,
  });

  const data = toolsQ.data ?? { tools: [], origin: "", apiKey: "" };
  const loading = toolsQ.isLoading;
  const loadError = toolsQ.isError;
  const modelCatalog = modelsQ.data ?? [];

  const origin = useMemo(() => {
    const backendOrigin = data.origin || "";
    if (backendOrigin.includes("127.0.0.1") || backendOrigin.includes("localhost")) {
      return typeof window !== "undefined" ? window.location.origin : backendOrigin;
    }
    return backendOrigin;
  }, [data.origin]);

  const sortedTools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    let list = [...data.tools];
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (TOOL_DESC[t.id] || "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if ((a.connected ? 1 : 0) !== (b.connected ? 1 : 0)) return (b.connected ? 1 : 0) - (a.connected ? 1 : 0);
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
    return list;
  }, [data.tools, toolQuery]);

  useEffect(() => {
    if (data.tools.length === 0) return;
    if (selectedId && data.tools.some((t) => t.id === selectedId)) return;
    let preferred: string | null = null;
    try {
      preferred = localStorage.getItem(SELECTED_KEY);
    } catch {
      preferred = null;
    }
    if (preferred && data.tools.some((t) => t.id === preferred)) {
      setSelectedId(preferred);
    }
  }, [data.tools, selectedId]);

  const selected = sortedTools.find((t) => t.id === selectedId) || null;
  const selectedFull =
    (selected && data.tools.find((t) => t.id === selected.id)) || selected;

  const apiKeys = keysQ.data ?? [];
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const selectedKey = apiKeys.find((key) => key.id === selectedKeyId);

  useEffect(() => {
    if (apiKeys.length > 0 && !selectedKeyId) {
      setSelectedKeyId(apiKeys[0].id);
    }
  }, [apiKeys, selectedKeyId]);

  useEffect(() => {
    const selected = apiKeys.find((key) => key.id === selectedKeyId);
    if (!selected) {
      setRawKey("");
      return;
    }
    void getApiKeyRaw(selected.id).then(setRawKey).catch(() => setRawKey(""));
  }, [apiKeys, data.apiKey, selectedKeyId]);

  useEffect(() => {
    setSlots((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of data.tools) {
        if (!next[t.id]) {
          next[t.id] = seedSlots(t);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data.tools]);

  function flash(
    msg: string,
    tone: "success" | "error" | "default" = "default"
  ) {
    if (tone === "success") toast.success(msg);
    else if (tone === "error") toast.error(msg);
    else toast(msg);
  }

  function setSlot(id: string, patch: Partial<Slots>) {
    setSlots((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? seedSlots({ id } as CliTool)), ...patch },
    }));
  }

  function configFor(t: CliTool, s: Slots, reveal = false) {
    const models = isClaudeCode(t.id)
      ? [s.fable, s.opus, s.sonnet, s.haiku].filter(Boolean)
      : ARRAY_MODEL_TOOLS.has(t.id)
        ? s.models
        : [s.primary].filter(Boolean);
    return formatCliConfig({
      toolId: t.id,
      baseUrl: endpointFor(t.id, origin),
      apiKey: rawKey || data.apiKey,
      models,
      primaryModel: ARRAY_MODEL_TOOLS.has(t.id) ? s.active : s.primary,
      subagentModel: s.subagent,
      fableModel: s.fable,
      opusModel: s.opus,
      sonnetModel: s.sonnet,
      haikuModel: s.haiku,
    }, reveal);
  }

  function downloadConfig(content: string, fileName: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = fileName.split(" + ")[0];
    anchor.click();
    URL.revokeObjectURL(href);
  }

  function bodyFor(t: CliTool, s: Slots): ConnectBody {
    const body: ConnectBody = {
      baseUrl: endpointFor(t.id, origin),
      apiKey: rawKey,
      models: [s.primary],
      primaryModel: s.primary,
      subagentModel: s.subagent,
    };
    if (isClaudeCode(t.id)) {
      return {
        ...body,
        models: [s.fable, s.opus, s.sonnet, s.haiku],
        fableModel: s.fable,
        opusModel: s.opus,
        sonnetModel: s.sonnet,
        haikuModel: s.haiku,
      };
    }

    if (ARRAY_MODEL_TOOLS.has(t.id)) {
      const list = s.models.filter(Boolean);
      const model = s.active || list[list.length - 1] || "";
      return { ...body, models: list, primaryModel: model, activeModel: model };
    }
    if (SUBAGENT_TOOLS.has(t.id)) return body;
    if (SINGLE_MODEL_TOOLS.has(t.id)) return { ...body, models: [s.primary] };
    return body;
  }

  async function onApply(t: CliTool) {
    if (!toolCanConfigure(t)) return flash(`${t.name} is detection-only`, "error");
    if (!rawKey && t.id !== "hermes" && t.id !== "grok-build" && t.id !== "omp") {
      return flash("Select an API key first", "error");
    }
    const s = slots[t.id] ?? seedSlots(t);
    setPending({ id: t.id, kind: "apply" });
    try {
      await connectCliTool(t.id, bodyFor(t, s));
      await qc.invalidateQueries({ queryKey: ["cli-tools"] });
      flash(`${t.name} connected`, "success");
    } catch (err) {
      flash(getErrorMessage(err, "Connect failed"), "error");
    } finally {
      setPending(null);
    }
  }

  async function onDisconnect(t: CliTool) {
    if (!toolSupportsDisconnect(t)) return;
    setPending({ id: t.id, kind: "disconnect" });
    try {
      await disconnectCliTool(t.id);
      await qc.invalidateQueries({ queryKey: ["cli-tools"] });
      flash(`${t.name} disconnected`, "success");
    } catch (err) {
      flash(getErrorMessage(err, "Disconnect failed"), "error");
    } finally {
      setPending(null);
    }
  }

  async function onReset(t: CliTool) {
    if (!toolCanConfigure(t)) return;
    setResetTarget(null);
    setPending({ id: t.id, kind: "reset" });
    try {
      await resetCliTool(t.id);
      setSlots((prev) => ({ ...prev, [t.id]: emptySlots() }));
      setManualConfigOpen(false);
      setRevealConfigKey(false);
      await qc.invalidateQueries({ queryKey: ["cli-tools"] });
      flash(`${t.name} reset`, "success");
    } catch (err) {
      flash(getErrorMessage(err, "Reset failed"), "error");
    } finally {
      setPending(null);
    }
  }

  async function onRefresh() {
    await qc.invalidateQueries({ queryKey: ["cli-tools"] });
    flash("Refreshed", "success");
  }

  function toolStatus(t: CliTool) {
    return !t.available
      ? "Unavailable"
      : t.tier === "detection"
        ? "Detection only"
        : t.connected
          ? "Connected"
          : t.installed
            ? "Not configured"
            : "Not installed";
  }

  function toolTone(t: CliTool) {
    return !t.available
      ? "err"
      : t.connected
        ? "ok"
        : t.installed
          ? "warn"
          : "muted";
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 overflow-hidden sm:gap-3 lg:gap-4",
        "h-[calc(100dvh-4.5rem)] max-h-[calc(100dvh-4.5rem)]",
        "lg:h-full lg:max-h-none"
      )}
    >
      <Header
        className="mb-0 sm:mb-0 shrink-0"
        title="CLI Tools"
        description="Detect and configure CLI tools on the machine running Sway Router."
        actions={
          <>
            <RippleButton
              size="sm"
              variant="outline"
              onClick={() => void onRefresh()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </RippleButton>
          </>
        }
      />

      {loadError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Unable to load CLI tools. Check your session and backend connection.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3 lg:flex-row lg:gap-4">
        <Frame
          className={cn(
            "flex shrink-0 flex-col overflow-hidden",
            "w-full h-[26dvh] max-h-[26dvh] min-h-0 sm:h-[30dvh] sm:max-h-[30dvh] lg:h-full lg:max-h-none lg:min-h-0 lg:w-[280px] xl:w-[320px]"
          )}
        >
          <FrameHeader className="space-y-2 border-b border-border p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search tools…"
                value={toolQuery}
                onChange={(e) => setToolQuery(e.target.value)}
              />
            </div>
          </FrameHeader>

          <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            <ScrollArea
              overscrollContain
              scrollFade
              scrollbarGutter
              className="min-h-0 flex-1"
            >
              <div className="p-2">
                {loading ? (
                  <div className="space-y-2 p-1">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                ) : sortedTools.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {toolQuery.trim() ? "No tools match" : "No CLI tools available"}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {sortedTools.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => selectTool(t.id)}
                          className={cn(
                            "relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-100",
                            "outline-none focus-visible:ring-1 focus-visible:ring-white/20",
                            selectedId === t.id
                              ? "text-foreground"
                              : "hover:bg-surface-hover/70"
                          )}
                        >
                          {selectedId === t.id ? (
                            <motion.span
                              layoutId="cli-tool-highlight"
                              className="absolute inset-0 rounded-lg bg-surface-hover"
                              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.55 }}
                            />
                          ) : null}
                          <CliToolBrandIcon toolId={t.id} className="size-9" />
                          <div className="relative z-10 min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                {t.name}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                              <StatusBadge tone={toolTone(t)} className="text-[10px]">
                                {toolStatus(t)}
                              </StatusBadge>
                              {t.configPath ? (
                                <code className="truncate font-mono text-muted-foreground/60">
                                  {t.configPath}
                                </code>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </ScrollArea>
          </FramePanel>
        </Frame>

        <Frame className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!selectedFull ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              Select a CLI tool
            </div>
          ) : (
            (() => {
              const t = selectedFull;
              const s = slots[t.id] ?? seedSlots(t);
              const busyApply = pending?.id === t.id && pending.kind === "apply";
              const busyDisc = pending?.id === t.id && pending.kind === "disconnect";
              const busyReset = pending?.id === t.id && pending.kind === "reset";
              const manualConfig = configFor(t, s, revealConfigKey);
              return (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.55 }}
                    className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  >
                  <FrameHeader className="flex shrink-0 flex-row flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <CliToolBrandIcon toolId={t.id} className="size-10 rounded-xl" />
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold">
                          {t.name}
                        </h2>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <StatusBadge tone={toolTone(t)}>
                            {toolStatus(t)}
                          </StatusBadge>
                          <span className="font-mono text-xs">{t.id}</span>
                          {t.configPath ? (
                            <code className="truncate text-xs">{t.configPath}</code>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {t.connected && toolSupportsDisconnect(t) ? (
                        <RippleButton
                          size="sm"
                          variant="outline"
                          onClick={() => void onDisconnect(t)}
                          disabled={busyDisc || busyApply || busyReset}
                        >
                          {busyDisc ? "…" : "Disconnect"}
                        </RippleButton>
                      ) : null}
                      {toolCanConfigure(t) ? (
                        <>
                          <RippleButton
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRevealConfigKey(false);
                              setManualConfigOpen(true);
                            }}
                            disabled={!t.available || !t.installed || busyApply || busyDisc || busyReset}
                          >
                            <FileJson className="h-3.5 w-3.5" />
                            Manual config
                          </RippleButton>
                          <RippleButton
                            size="sm"
                            onClick={() => void onApply(t)}
                            disabled={!t.available || !t.installed || busyApply || busyDisc || busyReset}
                            className="min-w-[5.5rem]"
                          >
                            {busyApply ? (
                              <>
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                Applying…
                              </>
                            ) : t.connected ? "Re-apply" : "Apply"}
                          </RippleButton>
                          <RippleButton
                            size="sm"
                            variant="outline"
                            onClick={() => setResetTarget(t)}
                            disabled={!t.available || !t.installed || busyApply || busyDisc || busyReset}
                            className="text-destructive hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reset
                          </RippleButton>
                        </>
                      ) : null}
                    </div>
                  </FrameHeader>

                  <FramePanel className="min-h-0 flex-1 space-y-4 overflow-hidden p-4 sm:p-5">
                    <ScrollArea overscrollContain scrollFade scrollbarGutter className="h-full">
                      <div className="space-y-4">
                        <label className="block space-y-1.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Endpoint
                          </span>
                          <Input
                            readOnly
                            value={endpointFor(t.id, origin)}
                            className="h-8 font-mono text-[11px]"
                          />
                        </label>

                        <label className="block space-y-1.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            API key
                          </span>
                          <div className="flex items-center gap-1.5">
                            {apiKeys.length > 0 ? (
                              <>
                                <Select
                                  value={selectedKeyId}
                                  onValueChange={(value) =>
                                    setSelectedKeyId(value ?? "")
                                  }
                                >
                                  <SelectTrigger
                                    size="sm"
                                    className="min-w-0 flex-1 font-mono text-xs"
                                  >
                                    <span className="truncate">
                                      {selectedKey
                                        ? `${selectedKey.name} (${displayPrefix(selectedKey)})`
                                        : "Select API key"}
                                    </span>
                                  </SelectTrigger>
                                  <SelectPopup>
                                  {apiKeys.map((k) => (
                                    <SelectItem key={k.id} value={k.id}>
                                      {k.name} ({displayPrefix(k)})
                                    </SelectItem>
                                  ))}
                                  </SelectPopup>
                                </Select>
                                <CopyButton
                                  value={rawKey || data.apiKey}
                                  className="h-8 shrink-0 px-2"
                                  label=""
                                />
                              </>
                            ) : (
                              <>
                                <Input
                                  readOnly
                                  value={maskKey(data.apiKey)}
                                  className="h-8 min-w-0 flex-1 font-mono text-[11px]"
                                />
                                <CopyButton
                                  value={rawKey || data.apiKey}
                                  className="h-8 shrink-0 px-2"
                                  label=""
                                />
                              </>
                            )}
                          </div>
                        </label>

                        <div className="space-y-3">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Model aliases
                          </span>
                          {isClaudeCode(t.id) ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              {CLAUDE_TIERS.map((tier) => (
                                <ModelPicker
                                  key={tier.key}
                                  label={tier.label}
                                  value={s[tier.key as ClaudeTierKey]}
                                  models={modelCatalog}
                                  onChange={(v) =>
                                    setSlot(t.id, {
                                      [tier.key]: v,
                                    } as Partial<Slots>)
                                  }
                                />
                              ))}
                            </div>
                          ) : ARRAY_MODEL_TOOLS.has(t.id) ? (
                            <ModelMultiPicker
                              value={s.models}
                              active={s.active}
                              models={modelCatalog}
                              label={t.id === "omp" ? "Models (optional; live discovery stays enabled)" : "Models"}
                              onAdd={(ids) =>
                                setSlot(t.id, {
                                  models: ids.filter(Boolean),
                                  active: ids.length ? s.active : "",
                                })
                              }
                              onRemove={(id) =>
                                setSlot(t.id, {
                                  models: s.models.filter((m) => m !== id),
                                  active: s.active === id ? "" : s.active,
                                })
                              }
                              onSetActive={(id) =>
                                setSlot(t.id, { active: id })
                              }
                            />
                          ) : (
                            <ModelPicker
                              label="Model"
                              value={s.primary}
                              models={modelCatalog}
                              onChange={(v) => setSlot(t.id, { primary: v })}
                            />
                          )}
                        </div>

                      </div>
                    </ScrollArea>
                  </FramePanel>
                  </motion.div>
                  <Dialog open={manualConfigOpen} onOpenChange={setManualConfigOpen}>
                    <DialogPopup className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Manual config · {t.name}</DialogTitle>
                        <DialogDescription>
                          Copy this snapshot into <code className="font-mono">{manualConfig.fileName}</code>, or apply it directly to the native config.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogPanel className="space-y-3 px-6 pb-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          <span>
                            {manualConfig.modelCount} model{manualConfig.modelCount === 1 ? "" : "s"} · {manualConfig.format.toUpperCase()}
                          </span>
                          <span>Generated from the current model selections.</span>
                        </div>
                        {!manualConfig.complete ? (
                          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                            {manualConfig.message}
                          </p>
                        ) : null}
                        <div className="relative">
                          <pre className="max-h-[50dvh] overflow-auto rounded-xl border border-border bg-background p-3 pr-12 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                            {manualConfig.content}
                          </pre>
                          <Tooltip label={revealConfigKey ? "Mask API key" : "Reveal API key"}>
                            <button
                              type="button"
                              onClick={() => setRevealConfigKey((value) => !value)}
                              className="absolute right-2 top-2 rounded-md border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                              aria-label={revealConfigKey ? "Mask API key" : "Reveal API key"}
                            >
                              {revealConfigKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </Tooltip>
                        </div>
                      </DialogPanel>
                      <DialogFooter variant="bare" className="flex-row justify-end">
                        <CopyButton value={manualConfig.content} label="Copy config" />
                        <RippleButton
                          size="sm"
                          variant="outline"
                          onClick={() => downloadConfig(manualConfig.content, manualConfig.fileName)}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </RippleButton>
                      </DialogFooter>
                    </DialogPopup>
                  </Dialog>
                </AnimatePresence>
              );
            })()
          )}
        </Frame>
      </div>
      <Dialog open={Boolean(resetTarget)} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset {resetTarget?.name}?</DialogTitle>
            <DialogDescription>
              This removes Sway Router settings from {resetTarget?.name}. All selected models will be cleared, while the CLI installation and unrelated settings stay untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => setResetTarget(null)}
              disabled={Boolean(resetTarget && pending?.id === resetTarget.id && pending.kind === "reset")}
            >
              Cancel
            </RippleButton>
            <RippleButton
              variant="destructive"
              onClick={() => resetTarget && void onReset(resetTarget)}
              disabled={Boolean(resetTarget && pending?.id === resetTarget.id && pending.kind === "reset")}
            >
              {resetTarget && pending?.id === resetTarget.id && pending.kind === "reset" ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Resetting…
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </>
              )}
            </RippleButton>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

function CliToolBrandIcon({
  toolId,
  className,
}: {
  toolId: string;
  className?: string;
}) {
  const src = TOOL_ICON_SRC[toolId];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-center rounded-lg bg-white p-1.5 outline outline-1 outline-white/30 outline-offset-2",
        className,
      )}
    >
      {src ? (
        <span
          className="block size-full bg-background"
          style={{
            WebkitMaskImage: `url(${src})`,
            maskImage: `url(${src})`,
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      ) : (
        <Terminal className="size-4 text-muted-foreground" />
      )}
    </span>
  );
}

function ModelPicker({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: ModelInfo[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const catalog = models;

  const groups = useMemo(
    () => groupModels(catalog, query),
    [catalog, query]
  );

  const selected = catalog.find((m) => m.id === value);

  const shownId = value || "";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className="space-y-1" ref={rootRef}>
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Tooltip label={shownId || "Select a model"}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={cn(
              "flex h-8 w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 text-left text-xs",
              "outline-none transition-colors hover:bg-surface-hover",
              "focus-visible:border-white/25 focus-visible:ring-1 focus-visible:ring-white/15",
              open && "border-white/25"
            )}
            aria-label="Select a model"
          >
          <ProviderModelIcon
            provider={shownId.split("/")[0] || "other"}
            className="h-4 w-4"
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
            {shownId || "Select a model"}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
          </button>
        </Tooltip>

        <AnimatePresence>
          {open ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 4 }}
              transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.5 }}
              className="absolute left-0 right-0 z-40 mt-1 w-full min-w-72"
            >
              <div className="flex h-72 flex-col overflow-hidden rounded-xl border border-border bg-card">
                <div className="shrink-0 border-b border-border bg-card p-1.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search models…"
                      className="h-8 pl-7 text-xs"
                    />
                  </div>
                </div>

                <ScrollArea overscrollContain scrollFade className="min-h-0 flex-1">
                  <ProviderModelAccordion
                    groups={groups}
                    query={query}
                    empty={(
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                        {models.length === 0 ? "No providers connected yet" : "No models match"}
                      </p>
                    )}
                    renderItem={(m, provider) => {
                      const active = m.id === (selected?.id ?? value);
                      return (
                        <button
                          type="button"
                          onClick={() => pick(m.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors",
                            active
                              ? "bg-primary/10 text-foreground"
                              : "text-foreground hover:bg-surface-hover",
                          )}
                        >
                          <ProviderModelIcon provider={provider} className="h-5 w-5 shrink-0" />
                          <Tooltip label={m.id}>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                              {m.name || m.id}
                            </span>
                          </Tooltip>
                          {active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                        </button>
                      );
                    }}
                  />
                </ScrollArea>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ModelMultiPicker({
  value,
  active,
  models,
  label = "Models",
  onAdd,
  onRemove,
  onSetActive,
}: {
  value: string[];
  active: string;
  models: ModelInfo[];
  label?: string;
  onAdd: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onSetActive: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const addedSet = useMemo(() => new Set(value), [value]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q)
        )
      : models;

    const combos: ModelInfo[] = [];
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of filtered) {
      const isCombo = m.provider === "combo";
      if (isCombo) combos.push(m);
      else {
        const key = m.provider || "other";
        const list = byProvider.get(key);
        if (list) list.push(m);
        else byProvider.set(key, [m]);
      }
    }

    const sortModels = (arr: ModelInfo[]) =>
      [...arr].sort(
        (a, b) =>
          Number(addedSet.has(b.id)) - Number(addedSet.has(a.id)) ||
          a.name.localeCompare(b.name)
      );

    const groups: Array<{ provider: string; items: ModelInfo[] }> = [];
    if (combos.length) groups.push({ provider: "Combo", items: sortModels(combos) });
    for (const [provider, items] of [...byProvider.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      groups.push({ provider, items: sortModels(items) });
    }
    return { groups, isEmpty: filtered.length === 0, hasNone: models.length === 0 };
  }, [models, query, addedSet]);

  useEffect(() => {
    if (active && !addedSet.has(active)) onSetActive("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, active]);

  function toggle(id: string) {
    const next = value.includes(id)
      ? value.filter((m) => m !== id)
      : [...value, id];
    onAdd(next);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>

      {value.length === 0 ? (
        <div className="flex h-8 items-center justify-between rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground">
          <span>No models selected</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Select models to add
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {value.map((id) => {
              const isActive = id === active;
              return (
                <Tooltip key={id} label={isActive ? "Active model" : id}>
                  <span
                    className={cn(
                      "group inline-flex h-7 items-center gap-1 rounded-full border pl-1.5 pr-1 text-[11px] font-mono",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground"
                    )}
                  >
                  <button
                    type="button"
                    onClick={() => onSetActive(id)}
                    className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-surface-hover"
                    aria-label={isActive ? "Active model" : "Set active"}
                  >
                    <Star
                      className={cn(
                        "h-3 w-3",
                        isActive ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                      )}
                    />
                  </button>
                  <span className="max-w-32 truncate">{id}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(id)}
                    className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-surface-hover"
                    aria-label="Remove model"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  </span>
                </Tooltip>
              );
            })}
          </div>
          {active && (
            <p className="text-[11px] text-muted-foreground">
              Active: <span className="font-mono">{active}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-[11px] font-medium text-foreground transition-colors hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Model
          </button>
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <DialogPopup className="flex max-h-[min(80dvh,560px)] flex-col p-0">
          <DialogHeader>
            <DialogTitle>Select models</DialogTitle>
            <DialogDescription>
              Click a model to add or remove it. Starred model is the active one.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>

          <DialogPanel scrollFade className="flex-1 overflow-hidden px-6 pb-6">
            {sorted.hasNone ? (
              <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                No providers connected yet
              </p>
            ) : sorted.isEmpty ? (
              <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                No models match
              </p>
            ) : (
              <ProviderModelAccordion
                groups={sorted.groups}
                query={query}
                renderItem={(m, provider) => {
                  const added = addedSet.has(m.id);
                  const isActive = m.id === active;
                  return (
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                        added
                          ? "bg-primary/10 text-foreground"
                          : "text-foreground hover:bg-surface-hover",
                      )}
                    >
                      <ProviderModelIcon provider={provider} className="h-5 w-5 shrink-0" />
                      <Tooltip label={m.id}>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                          {m.name || m.id}
                        </span>
                      </Tooltip>
                      {isActive ? <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" /> : null}
                      {added && !isActive ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                      {added && isActive ? <span className="h-3.5 shrink-0 text-[10px] text-primary">Active</span> : null}
                    </button>
                  );
                }}
              />
            )}
          </DialogPanel>

          <DialogFooter variant="bare">
            <RippleButton size="sm" onClick={() => { setOpen(false); setQuery(""); }}>
              Done
            </RippleButton>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
