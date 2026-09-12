import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
import { Header } from "@/components/Header";
import { RippleButton } from "@/components/animate/ripple-button";
import { AddConnectionDialog, type KiroAuthMode } from "@/components/provider/AddConnectionDialog";
import { CustomProviderDialog } from "@/components/provider/CustomProviderDialog";
import { EditDialog } from "@/components/provider/EditDialog";
import { ProviderSidebar } from "@/components/provider/ProviderSidebar";
import { ProviderModelsPanel } from "@/components/provider/ProviderModelsPanel";
import { ProviderConnectionsPanel } from "@/components/provider/ProviderConnectionsPanel";
import { ProviderDetailHeader } from "@/components/provider/ProviderDetailHeader";
import { ProviderDeleteDialogs } from "@/components/provider/ProviderDeleteDialogs";
import { Frame, FramePanel } from "@/components/ui/frame";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  createConnection,
  deleteConnection,
  exchangeOAuth,
  getConnectionModels,
  createKiroApiKey,
  importKiroToken,
  importKiroCliProxy,
  importModels,
  importToken,
  listAvailableProviders,
  listConnectionsPage,
  pollDeviceCode,
  usesConnectionModelCatalog,
  testConnection,
  testConnectionModels,
  toggleConnection,
  updateConnection,
  type AvailableProvider,
  type Connection,
} from "@/lib/connections-api";
import {
  createNode,
  deleteNode,
  listNodes,
  updateNode,
} from "@/lib/admin-extras-api";
import {
  addCustomModelAPI,
  addCustomModelsAPI,
  listCustomModelsAPI,
  removeCustomModelAPI,
} from "@/lib/custom-models-api";
import { api, getErrorMessage } from "@/lib/api";
import {
  fetchSettings,
  getProviderStickyRoundRobin,
  getProviderStrategy,
  updateSettings,
  type AppSettings,
  type RotationStrategy,
} from "@/lib/settings-api";
import { resolveAuthFlow, type AuthFlow } from "@/lib/providers";
import {
  defaultThinkingLevel,
  getThinkingLevelsForModels,
  type ThinkingLevel,
} from "@/lib/thinking";
import { cn } from "@/lib/utils";
import { providerSelectionChanged } from "@/lib/provider-selection";
import {
  mergeModelRows,
  normalizeModelCapabilities,
  normalizeProviderModelId,
  normalizeProviderModelRows,
  type ModelRow,
} from "@/lib/model-capabilities";
import axios, { type AxiosError } from "axios";

type Result = {
  ok: boolean;

  label: string;

  message: string;
  status?: number | string | null;
  detail?: string | null;
};

const CONNECTION_PAGE_SIZE = 50;
const MAX_LOADED_CONNECTIONS = 1_000;

export function compactErrorReason(input: string, maxLength = 42): string {
  let reason = input.trim();
  if (!reason) return "Failed";
  reason = reason.replace(/^\s*(?:error|err|failed?)\s*[:\-]\s*/i, "");
  reason = reason.replace(/^\s*status\s+\d{3}\s*[:\-]?\s*/i, "");
  try {
    const parsed: unknown = JSON.parse(reason);
    if (parsed && typeof parsed === "object") {
      const value = parsed as { error?: unknown; message?: unknown; detail?: unknown };
      const nested = value.error ?? value.message ?? value.detail;
      if (typeof nested === "string") reason = nested.trim();
      else if (nested && typeof nested === "object") {
        const obj = nested as { message?: unknown; type?: unknown; code?: unknown };
        reason = String(obj.message ?? obj.type ?? obj.code ?? reason).trim();
      }
    }
  } catch {

  }
  reason = reason.replace(/\s+/g, " ").replace(/[.。]+$/, "");
  if (reason.length <= maxLength) return reason;
  return `${reason.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}
function formatTestResult(input: {
  ok: boolean;
  status?: number | string | null;
  message?: string | null;
  error?: string | null;
  latencyMs?: number | null;
  detail?: string | null;
}): Result {
  const status = input.status ?? null;
  const rawMsg = (input.message || input.error || "").trim();
  const ms =
    input.latencyMs != null && Number.isFinite(Number(input.latencyMs))
      ? Math.round(Number(input.latencyMs))
      : null;

  if (input.ok) {

    const label = ms != null ? `OK · ${ms}ms` : "OK";
    return {
      ok: true,
      label,
      message: label,
      status,
      detail: null,
    };
  }

  let code = "";

  if (status != null && String(status).trim() !== "") {
    const s = String(status).trim();
    if (!isNaN(Number(s))) {
      code = s;
    }
  }

  if (!code && rawMsg) {
    const m = rawMsg.match(/^(\d{3})[:\s]/);
    if (m) code = m[1];
    else {
      const http = rawMsg.match(/\bHTTP\s+(\d{3})\b/i);
      if (http) code = http[1];
      else if (rawMsg.startsWith("status ")) {
        const after = rawMsg.replace(/^status\s+/, "").match(/^(\d{3})/);
        if (after) code = after[1];
      }
    }
  }
  const label = code ? `Error ${code}` : "Error";

  return {
    ok: false,
    label,
    message: rawMsg || label,
    status,
    detail:
      input.detail && input.detail !== rawMsg ? input.detail : null,
  };
}

function resultFromAxiosError(err: unknown): Result {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{
      error?: { message?: string; type?: string; code?: string } | string;
      message?: string;
      status?: number;
      detail?: string;
    }>;
    const status = ax.response?.status ?? null;
    const data = ax.response?.data;
    let reason = "";
    if (typeof data?.error === "string") reason = data.error;
    else if (data?.error && typeof data.error === "object") {
      reason =
        data.error.message ||
        data.error.type ||
        data.error.code ||
        "";
    }
    const errorText = typeof data?.error === "string" ? data.error : "";
    const genericError = /^(?:test failed|internal server error)$/i.test(errorText);
    reason = (genericError ? data?.message : errorText) || data?.message || ax.message || "Test failed";
    let detail: string | null = null;
    try {
      if (data) detail = JSON.stringify(data, null, 2);
    } catch {
      detail = null;
    }
    return formatTestResult({
      ok: false,
      status,
      message: reason,
      detail,
    });
  }
  return formatTestResult({
    ok: false,
    message: getErrorMessage(err, "Test failed"),
  });
}
export default function Provider() {
  const qc = useQueryClient();
  const SELECTED_KEY = "nr-selected-provider";
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });

  function selectProvider(id: string | null) {
    if (!providerSelectionChanged(selectedId, id)) return;
    setLoadedConnectionsOwner(null);
    setLoadedConnections([]);
    setConnResults({});
    setModelResults({});

    setSelectedKeys(new Set());
    setSelectedId(id);
    try {
      if (id) localStorage.setItem(SELECTED_KEY, id);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {

    }
  }
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "idle">("all");
  const [hiddenProviders, setHiddenProviders] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("nr-hidden-providers") || "[]");
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editConn, setEditConn] = useState<Connection | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteProvider, setDeleteProvider] = useState<AvailableProvider | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [editCustom, setEditCustom] = useState<AvailableProvider | null>(null);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [customTick, setCustomTick] = useState(0);

  const [importedModelRows, setImportedModelRows] = useState<Record<string, ModelRow[]>>({});
  const [newModel, setNewModel] = useState("");
  const [addingModel, setAddingModel] = useState(false);
  const [importingModels, setImportingModels] = useState(false);

  const [pinned, setPinned] = useState<Record<string, string[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem("nr-pinned-models") || "{}");
    } catch {
      return {};
    }
  });
  const [hiddenModels, setHiddenModels] = useState<Record<string, string[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem("nr-hidden-models") || "{}");
    } catch {
      return {};
    }
  });
  const [modelQuery, setModelQuery] = useState("");

  function hideModel(providerId: string, modelId: string) {
    setHiddenModels((previous) => {
      const next = {
        ...previous,
        [providerId]: Array.from(new Set([...(previous[providerId] || []), modelId])),
      };
      try {
        localStorage.setItem("nr-hidden-models", JSON.stringify(next));
      } catch {

      }
      return next;
    });
  }

  function restoreImportedModels(providerId: string, modelIds: string[]) {
    if (!modelIds.length) return;
    setHiddenModels((previous) => {

      const restore = new Set(modelIds.map((id) => id.trim()).filter(Boolean));
      const restoreTails = new Set(
        [...restore].map((id) => id.slice(id.lastIndexOf("/") + 1)),
      );
      const current = previous[providerId] || [];
      const remaining = current.filter((id) => {
        const value = String(id);
        const tail = value.slice(value.lastIndexOf("/") + 1);
        return !restore.has(value) && !restoreTails.has(tail);
      });
      const next = { ...previous };
      if (remaining.length) next[providerId] = remaining;
      else delete next[providerId];
      try {
        localStorage.setItem("nr-hidden-models", JSON.stringify(next));
      } catch {

      }
      return next;
    });
  }

  const [forceTick, setForceTick] = useState(0);
  const [stickyDraft, setStickyDraft] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const [testingConnId, setTestingConnId] = useState<string | null>(null);
  const [testingModels, setTestingModels] = useState<Set<string>>(() => new Set());
  const [modelTestLock, setModelTestLock] = useState(false);
  const modelTestLockRef = useRef(false);
  const modelTestControllersRef = useRef<Map<string, AbortController>>(new Map());
  const MODEL_TEST_CONCURRENCY = 4;
  const [togglingConnId, setTogglingConnId] = useState<string | null>(null);
  const [batchKind, setBatchKind] = useState<"conn" | "model" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [connResults, setConnResults] = useState<Record<string, Result>>({});
  const [modelResults, setModelResults] = useState<Record<string, Result>>({});
  const [detailTab, setDetailTab] = useState("connections");
  const connListRef = useRef<HTMLDivElement>(null);
  const providerListRef = useRef<HTMLDivElement>(null);
  const providerListScrollTopRef = useRef(0);

  const [connQuery, setConnQuery] = useState("");
  const [connSearch, setConnSearch] = useState("");
  const [connPage, setConnPage] = useState(1);
  const [loadedConnections, setLoadedConnections] = useState<Connection[]>([]);
  const [loadedConnectionsOwner, setLoadedConnectionsOwner] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConnSearch(connQuery.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [connQuery]);

  const connectionsQ = useQuery({
    queryKey: ["connections", selectedId, connPage, connSearch],
    queryFn: () => listConnectionsPage({
      provider: selectedId!,
      page: connPage,
      pageSize: CONNECTION_PAGE_SIZE,
      search: connSearch || undefined,
    }),
    enabled: Boolean(selectedId),
    retry: false,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    setConnPage(1);
    setLoadedConnectionsOwner(null);
    setLoadedConnections([]);
  }, [selectedId, connSearch]);

  useEffect(() => {
    const page = connectionsQ.data?.connections ?? [];
    if (!selectedId) return;
    if (!page.length && connPage === 1) {
      setLoadedConnections([]);
      setLoadedConnectionsOwner(selectedId);
      return;
    }
    setLoadedConnections((prev) => {
      const base = connPage === 1 ? [] : prev;
      const seen = new Set(base.map((c) => c.id));
      return [...base, ...page.filter((c) => !seen.has(c.id))]
        .slice(0, MAX_LOADED_CONNECTIONS);
    });
    setLoadedConnectionsOwner(selectedId);
  }, [connectionsQ.data, connPage, selectedId]);

  const connections: Connection[] =
    loadedConnectionsOwner === selectedId ? loadedConnections : [];
  const connectionPagination = connectionsQ.data?.pagination;
  const connectionsCapped = Boolean(
    connectionPagination?.hasNext && connections.length >= MAX_LOADED_CONNECTIONS,
  );

  useEffect(() => {
    const el = providerListRef.current;
    if (!el) return;
    const rememberScroll = () => {
      providerListScrollTopRef.current = el.scrollTop;
    };
    el.addEventListener("scroll", rememberScroll, { passive: true });
    return () => el.removeEventListener("scroll", rememberScroll);
  }, []);

  useLayoutEffect(() => {
    const el = providerListRef.current;
    if (el) el.scrollTop = providerListScrollTopRef.current;
  }, [selectedId]);

  useEffect(() => {
    const el = connListRef.current;
    if (!el || detailTab !== "connections") return;
    const onScroll = () => {
      const meta = connectionsQ.data?.pagination;
      if (!meta?.hasNext || connectionsQ.isFetching || connectionsCapped) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
        setConnPage((page) => page + 1);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [connectionsCapped, connectionsQ.data?.pagination, connectionsQ.isFetching, detailTab]);

  const availableQ = useQuery({
    queryKey: ["providers-available"],
    queryFn: listAvailableProviders,
    retry: false,
  });
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    retry: false,
  });
  const nodesQ = useQuery({
    queryKey: ["nodes"],
    queryFn: listNodes,
    retry: false,
  });

  const customModelsQ = useQuery({

    queryKey: ["custom-models"],
    queryFn: () => listCustomModelsAPI(),
    enabled: Boolean(selectedId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    placeholderData: (previous) => previous,
  });
  const liveModelsQ = useQuery({

    queryKey: ["available-models", forceTick],
    queryFn: async () => {

      const res = await api.get<{
        models?: Array<{
          provider: string;
          model: string;
          fullModel: string;
          routedModel: string;
          name?: string;
          caps?: Record<string, unknown>;
          thinkingLevels?: string[] | null;
        }>;
      }>("/models");
      return (res.data.models ?? []).map((m) => ({
        id: normalizeProviderModelId(m.routedModel || m.fullModel, m.provider),
        name: m.name || m.model,
        provider_alias: m.provider,
        provider_id: m.provider,
        owned_by: m.provider,
        caps: normalizeModelCapabilities(m.caps),
        thinkingLevels: Array.isArray(m.thinkingLevels) ? m.thinkingLevels : undefined,
      } satisfies ModelRow));
    },
    retry: false,
  });

  function flash(
    msg: string,
    tone: "default" | "success" | "error" | "warning" = "default"
  ) {
    if (tone === "success") toast.success(msg);
    else if (tone === "error") toast.error(msg);
    else if (tone === "warning") toast.warning(msg);
    else toast(msg);
  }

  const providers = useMemo<AvailableProvider[]>(() => {
    const fromApi = availableQ.data ?? [];
    const seen = new Set(fromApi.map((p) => p.id));
    const nodes = nodesQ.data ?? [];
    const extra: AvailableProvider[] = [];
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      extra.push({
        id: n.id,
        alias: n.prefix || n.id,
        name: n.name || n.prefix || n.id,
        authType: "apikey",
        isCustom: true,
        baseUrl: n.baseUrl,
        nodeType: n.type,
        apiType: n.apiType,
        icon: "sway",
        connected: 0,
      });
    }
    return [...fromApi, ...extra];
  }, [availableQ.data, nodesQ.data]);

  const settings: AppSettings | undefined = settingsQ.data;

  const byProvider = useMemo(() => {
    const map = new Map<string, Connection[]>();
    if (selectedId) map.set(selectedId, connections);
    return map;
  }, [connections, selectedId]);

  const sorted = useMemo(() => {
    let list = [...providers];
    if (filter === "active") {
      list = list.filter((p) => (p.connected || 0) > 0);
    } else if (filter === "idle") {
      list = list.filter((p) => (p.connected || 0) === 0);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.alias || "").toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const ah = hiddenProviders.includes(a.id) ? 1 : 0;
      const bh = hiddenProviders.includes(b.id) ? 1 : 0;
      if (ah !== bh) return ah - bh;
      const ac = a.connected || 0;
      const bc = b.connected || 0;
      if ((ac > 0 ? 1 : 0) !== (bc > 0 ? 1 : 0)) return bc - ac;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
    return list;
  }, [providers, byProvider, filter, hiddenProviders, query]);

  function toggleProviderHidden(providerId: string) {
    setHiddenProviders((previous) => {
      const next = previous.includes(providerId)
        ? previous.filter((id) => id !== providerId)
        : [...previous, providerId];
      try {
        localStorage.setItem("nr-hidden-providers", JSON.stringify(next));
      } catch {

      }
      return next;
    });
  }

  useEffect(() => {
    if (providers.length === 0) return;

    if (selectedId && providers.some((p) => p.id === selectedId)) return;

    let preferred: string | null = null;
    try {
      preferred = localStorage.getItem(SELECTED_KEY);
    } catch {
      preferred = null;
    }
    if (preferred && providers.some((p) => p.id === preferred)) {
      setSelectedId(preferred);
      return;
    }

  }, [providers, byProvider, selectedId]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setConnQuery("");
    setNewModel("");
    setDetailTab("connections");
  }, [selectedId]);

  useEffect(() => {
    const sticky = getProviderStickyRoundRobin(settings, selectedId || "");
    setStickyDraft(String(sticky));
  }, [selectedId, settings]);

  const selected = sorted.find((p) => p.id === selectedId) || null;
  const connsAll = useMemo(() => {
    const list = selected ? [...(byProvider.get(selected.id) || [])] : [];
    list.sort(
      (a, b) =>
        (a.priority ?? 999) - (b.priority ?? 999) || a.id.localeCompare(b.id)
    );
    return list;
  }, [selected, byProvider]);

  const conns = connsAll;

  const connVirtualizer = useVirtualizer({
    count: conns.length,
    getScrollElement: () => connListRef.current,
    estimateSize: () =>
      typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches
        ? 48
        : 72,
    overscan: 10,
    getItemKey: (index) => conns[index]?.id ?? index,
    enabled: detailTab === "connections",
  });

  useEffect(() => {
    if (detailTab !== "connections") return;
    const id = requestAnimationFrame(() => {
      connVirtualizer.measure();
    });
    return () => cancelAnimationFrame(id);
  }, [detailTab, conns.length, selectedId, connVirtualizer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => {
      connVirtualizer.measure();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [connVirtualizer]);

  useEffect(() => {
    const el = connListRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      connVirtualizer.measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [connVirtualizer, detailTab, selectedId]);

  const activeConns = useMemo(
    () => connsAll.filter((c) => c.isActive !== false),
    [connsAll],
  );
  const testConnId =
    [...selectedKeys][0] || activeConns[0]?.id || conns[0]?.id;
  const usesConnectionCatalog = usesConnectionModelCatalog(selected);
  const connectionModelsQ = useQuery({
    queryKey: ["connection-models", selected?.id, testConnId, forceTick],
    queryFn: async () => {
      const payload = await getConnectionModels(testConnId!);
      return normalizeProviderModelRows(payload.models, selected?.id);
    },
    enabled: Boolean(usesConnectionCatalog && testConnId),
    retry: false,
  });
  const strategy = selected
    ? getProviderStrategy(settings, selected.id)
    : "fill-first";

  const QODER_MODEL_NAMES: Record<string, string> = {
    "qd/ultimate": "Ultimate",
    "qd/auto": "Auto",
    "qd/performance": "Performance",
    "qd/efficient": "Efficient",
    "qd/lite": "Lite",
    "qd/qmodel_preview": "Qwen3.8-Max-Preview",
    "qd/qmodel_latest": "Qwen3.7-Max",
    "qd/qmodel": "Qwen3.7-Plus",
    "qd/kmodel_latest": "Kimi-K3",
    "qd/kmodel": "Kimi-K2.7-Code",
    "qd/gm51model": "GLM-5.2",
    "qd/dmodel": "DeepSeek-V4-Pro",
    "qd/dfmodel": "DeepSeek-V4-Flash",
    "qd/mmodel": "MiniMax-M3",
  };
  const models = useMemo<ModelRow[]>(() => {
    void customTick;
    if (!selected) return [];
    const rows: ModelRow[] = [];
    const providerId = selected.id;
    const providerAliases = new Set(
      [providerId, selected.alias || ""].filter(Boolean).map((value) => value.toLowerCase()),
    );
    const savedModels = [
      ...(customModelsQ.data ?? []),
      ...(importedModelRows[providerId] ?? []).map((model) => ({
        providerAlias: providerId,
        id: model.id,
        name: model.name,
        capabilities: model.caps,
        thinkingLevels: model.thinkingLevels,
      })),
    ];
    for (const model of savedModels) {
      if (providerAliases.has(model.providerAlias.toLowerCase())) {
        rows.push({
          id: normalizeProviderModelId(model.id, model.providerAlias),
          name: model.name || model.id,
          caps: normalizeModelCapabilities(model.capabilities),
          thinkingLevels: Array.isArray(model.thinkingLevels) ? model.thinkingLevels : undefined,
        });
      }
    }

    if (usesConnectionCatalog) {
      rows.push(...(connectionModelsQ.data ?? []));
      if (
        !testConnId &&
        (providerId === "codebuddy-cn" || providerId === "codebuddy-intl")
      ) {
        rows.push(...normalizeProviderModelRows(selected.models, providerId));
      }
    } else {

      const acceptedProviderIds = new Set(
        [providerId, selected.alias || ""]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      );
      for (const row of liveModelsQ.data ?? []) {
        const rowProviderIds = [row.provider_alias, row.provider_id, row.owned_by]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.trim().toLowerCase());
        if (rowProviderIds.some((value) => acceptedProviderIds.has(value))) {
          rows.push(row);
        }
      }
    }
    return mergeModelRows(rows, providerId);
  }, [connectionModelsQ.data, customTick, customModelsQ.data, importedModelRows, liveModelsQ.data, selected, testConnId, usesConnectionCatalog]);

  const modelsLoading = usesConnectionCatalog
    ? customModelsQ.isLoading || customModelsQ.isFetching || connectionModelsQ.isLoading || connectionModelsQ.isFetching
    : customModelsQ.isLoading || customModelsQ.isFetching || liveModelsQ.isLoading || liveModelsQ.isFetching;
  const modelsUnavailable = usesConnectionCatalog && Boolean(connectionModelsQ.error);

  const thinkingLevels = selected
    ? getThinkingLevelsForModels(
      selected.id,
      models.map((model) => model.thinkingLevels),
      selected.thinkingConfig,
    )
    : null;
  const savedThinking = selected
    ? settings?.providerThinking?.[selected.id] as ThinkingLevel | undefined
    : undefined;
  const fallbackThinking = selected
    ? defaultThinkingLevel(selected.id, selected.thinkingConfig)
    : "auto";
  const thinkingValue: ThinkingLevel = selected
    ? (savedThinking && thinkingLevels?.includes(savedThinking)
      ? savedThinking
      : thinkingLevels?.includes(fallbackThinking)
        ? fallbackThinking
        : thinkingLevels?.[0] || "auto")
    : "auto";

  const modelNames = useMemo(() => {
    const names = new Map<string, string>(Object.entries(QODER_MODEL_NAMES));
    for (const row of models) if (row.name) names.set(row.id, row.name);
    return names;
  }, [models]);

  const pinnedFor = selected ? pinned[selected.id] || [] : [];

  const visibleModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const hidden = new Set(selected ? hiddenModels[selected.id] || [] : []);

    let list = models.filter((row) => !hidden.has(row.id));
    if (q) list = list.filter((row) => row.id.toLowerCase().includes(q) || (row.name || "").toLowerCase().includes(q));
    if (!pinnedFor.length) return [...list].sort((a, b) => a.id.localeCompare(b.id));
    const pinnedSet = new Set(pinnedFor);
    const pinnedList = list.filter((row) => pinnedSet.has(row.id));
    const rest = list.filter((row) => !pinnedSet.has(row.id)).sort((a, b) => a.id.localeCompare(b.id));
    return [...pinnedList, ...rest];
  }, [hiddenModels, models, modelQuery, pinnedFor, selected]);

  function togglePin(id: string) {
    if (!selected) return;
    setPinned((prev) => {
      const cur = prev[selected.id] || [];
      const next = cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id];
      const updated = { ...prev, [selected.id]: next };
      try {
        localStorage.setItem("nr-pinned-models", JSON.stringify(updated));
      } catch {

      }
      return updated;
    });
  }

  function stopTests() {
    abortRef.current?.abort();
    for (const controller of modelTestControllersRef.current.values()) {
      controller.abort();
    }
    modelTestControllersRef.current.clear();
    abortRef.current = null;
    modelTestLockRef.current = false;
    setModelTestLock(false);
    setTestingConnId(null);
    setTestingModels(new Set());
    setBatchKind(null);
    flash("Tests stopped");
  }

  function stopModelTest(modelId: string) {
    const controller = modelTestControllersRef.current.get(modelId);
    if (!controller) return;
    controller.abort();
    flash("Model test stopped");
  }

  async function runTestConn(id: string, signal?: AbortSignal) {
    setTestingConnId(id);
    try {
      const data = await testConnection(id, undefined, { signal });
      const ok = data.valid === true;
      const testedAt = data.testedAt || new Date().toISOString();
      const healthPatch: Partial<Connection> = {
        testStatus: ok ? "active" : "error",
        lastTested: testedAt,
        lastError: ok ? (data.error || null) : (data.error || "Connection test failed"),
        healthStatus: ok ? "healthy" : "error",
        healthError: ok ? (data.error || null) : (data.error || "Connection test failed"),
        healthLatencyMs: data.latencyMs ?? 0,
      };
      setConnResults((p) => ({
        ...p,
        [id]: formatTestResult({
          ok,
          message: data.error || (ok ? "Valid" : "Failed"),
          latencyMs: data.latencyMs,
        }),
      }));

      setLoadedConnections((previous) =>
        previous.map((connection) =>
          connection.id === id ? { ...connection, ...healthPatch } : connection,
        ),
      );
      qc.setQueriesData<{ connections?: Connection[] }>(
        { queryKey: ["connections"] },
        (old) => old
          ? {
              ...old,
              connections: (old.connections || []).map((connection) =>
                connection.id === id ? { ...connection, ...healthPatch } : connection,
              ),
            }
          : old,
      );
      return ok;
    } catch (err) {
      if (axios.isCancel(err) || (err as { code?: string })?.code === "ERR_CANCELED")
        return false;
      const failed = resultFromAxiosError(err);
      const testedAt = new Date().toISOString();
      setConnResults((p) => ({ ...p, [id]: failed }));
      setLoadedConnections((previous) =>
        previous.map((connection) =>
          connection.id === id
            ? {
                ...connection,
                testStatus: "error",
                lastTested: testedAt,
                lastError: failed.message,
                healthStatus: "error",
                healthError: failed.message,
                healthLatencyMs: 0,
              }
            : connection,
        ),
      );
      return false;
    } finally {
      setTestingConnId((c) => (c === id ? null : c));
    }
  }

  async function runTestConns(ids: string[]) {
    if (!ids.length) return flash("Nothing to test");
    const ac = new AbortController();
    abortRef.current = ac;
    setBatchKind("conn");
    let passed = 0;

    const concurrency = 4;
    for (let i = 0; i < ids.length && !ac.signal.aborted; i += concurrency) {
      const batch = ids.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((id) => runTestConn(id, ac.signal)),
      );
      passed += results.filter(Boolean).length;
    }
    if (!ac.signal.aborted) flash(`Connections: ${passed}/${ids.length} passed`);
    setBatchKind(null);
  }

  async function runTestModel(
    modelId: string,
    connectionId?: string,
    signal?: AbortSignal,
  ) {
    if (!connectionId) {
      flash("Add a connection first");
      return false;
    }
    if (!signal) {
      if (modelTestLockRef.current || batchKind === "conn") return false;
      if (modelTestControllersRef.current.has(modelId)) return false;
      if (modelTestControllersRef.current.size >= MODEL_TEST_CONCURRENCY) {
        flash(`Up to ${MODEL_TEST_CONCURRENCY} model tests can run at once`);
        return false;
      }
    }

    const controller = signal ? null : new AbortController();
    const requestSignal = signal || controller!.signal;
    if (controller) {
      modelTestControllersRef.current.set(modelId, controller);
    }
    setTestingModels((previous) => {
      const next = new Set(previous);
      next.add(modelId);
      return next;
    });
    try {

      const data = await testConnectionModels(connectionId, {
        model: modelId,
        signal: requestSignal,
      });
      if (!Array.isArray(data.results)) {
        const reason = data.message || data.error || "No model test results returned";
        setModelResults((p) => ({
          ...p,
          [modelId]: formatTestResult({ ok: false, message: reason }),
        }));
        return false;
      }

      const tail = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
      const hit = (data.results ?? []).find((r) => {
        const resultId = String(r.modelId || "");
        return (
          resultId === tail ||
          resultId === modelId ||
          modelId.endsWith(`/${resultId}`) ||
          resultId.endsWith(`/${tail}`)
        );
      });
      const ok = Boolean(hit?.ok);
      setModelResults((p) => ({
        ...p,
        [modelId]: formatTestResult({
          ok,
          status: hit?.status,
          message: (hit?.error || "").trim() || (ok ? "OK" : "Failed"),
          latencyMs: hit?.latencyMs,
        }),
      }));
      return ok;
    } catch (err) {
      if (axios.isCancel(err) || (err as { code?: string })?.code === "ERR_CANCELED")
        return false;
      setModelResults((p) => ({
        ...p,
        [modelId]: resultFromAxiosError(err),
      }));
      return false;
    } finally {
      setTestingModels((previous) => {
        const next = new Set(previous);
        next.delete(modelId);
        return next;
      });
      if (controller) {
        modelTestControllersRef.current.delete(modelId);
      }
    }
  }

  async function runImportModels() {
    if (!selected) return;
    if (selected.id === "codebuddy-cn" || selected.id === "codebuddy-intl") {
      flash("CodeBuddy uses the static registry — add new models manually", "default");
      return;
    }
    setImportingModels(true);
    try {

      const body: {
        provider?: string;
        baseUrl?: string;
      } = { provider: selected.id };
      const selectedProviderKeys = new Set(
        [selected.id, selected.alias]
          .filter(Boolean)
          .map((value) => value!.trim().toLowerCase()),
      );
      const selectedNode = (nodesQ.data ?? []).find((node) => node.id === selected.id);
      const connectionBaseUrl = connsAll.find((c) =>
        selectedProviderKeys.has(String(c.provider || "").trim().toLowerCase()) &&
        typeof c.providerSpecificData?.baseUrl === "string"
      )?.providerSpecificData?.baseUrl;
      const baseUrl = selected.baseUrl || selectedNode?.baseUrl ||
        (typeof connectionBaseUrl === "string" ? connectionBaseUrl : undefined);
      if (baseUrl) body.baseUrl = baseUrl;

      const normalizeCatalogModels = (models: unknown[]) => models.flatMap((model) => {
        if (!model || typeof model !== "object") return [];
        const item = model as { id?: unknown; name?: unknown; capabilities?: unknown; caps?: unknown };
        const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
        if (!id.trim()) return [];
        const capabilities = item.capabilities ?? item.caps;
        return [{
          id: id.trim(),
          ...(typeof item.name === "string" && item.name.trim() ? { name: item.name.trim() } : {}),
          ...(capabilities && typeof capabilities === "object" ? { capabilities: capabilities as Record<string, unknown> } : {}),
        }];
      });

      const fromConnectionCatalog = async () => {
        const res = await getConnectionModels(testConnId!, true);
        const responseProvider = String(res.provider || "").trim().toLowerCase();
        if (responseProvider && !selectedProviderKeys.has(responseProvider)) {
          throw new Error(`Model catalog returned ${res.provider}, expected ${selected.name}`);
        }
        return {
          ok: true,
          success: true,
          models: normalizeCatalogModels(res.models ?? []),
        };
      };

      let data: {
        ok?: boolean;
        success?: boolean;
        message?: string;
        error?: string;
        models?: Array<string | { id: string; name?: string; capabilities?: Record<string, unknown> }>;
      };

      if (testConnId) {
        try {
          data = await fromConnectionCatalog();
        } catch (catalogError) {
          if (
            !body.baseUrl ||
            usesConnectionCatalog ||
            selected.id === "clinepass" ||
            selected.id === "cline-pass"
          ) {
            throw catalogError;
          }
          data = await importModels(body);
        }
      } else {
        data = await importModels(body);
      }
      if (!data.ok && !data.success) {
        flash(
          data.message || data.error || "Import failed",
          "error"
        );
        return;
      }
      const list = data.models ?? [];
      if (!list.length) {
        flash(data.message || "No models returned", "warning");
        return;
      }

      const importedIds = list.map((model) =>
        typeof model === "string" ? model : model.id
      );
      restoreImportedModels(selected.id, importedIds);
      const { added, models: importedRows } = await addCustomModelsAPI(selected.id, list);

      const importedProviderRows = importedRows.filter((row) =>
        selectedProviderKeys.has(String(row.providerAlias || "").trim().toLowerCase()),
      );

      const providerTotal = importedProviderRows.length;

      qc.setQueryData(["custom-models"], importedRows);
      setImportedModelRows((previous) => ({
        ...previous,
        [selected.id]: normalizeProviderModelRows(importedProviderRows, selected.id),
      }));
      setCustomTick((t) => t + 1);
      setForceTick((t) => t + 1);
      await qc.invalidateQueries({ queryKey: ["custom-models"] });
      await qc.invalidateQueries({ queryKey: ["connection-models"] });
      await qc.invalidateQueries({ queryKey: ["available-models"] });
      await qc.invalidateQueries({ queryKey: ["sway-chat", "models"] });
      await qc.refetchQueries({ queryKey: ["custom-models"], type: "active" });
      await qc.refetchQueries({ queryKey: ["connection-models"], type: "active" });
      flash(
        added > 0
          ? `Imported ${added} new ${added === 1 ? "model" : "models"} · Total ${providerTotal} ${providerTotal === 1 ? "Model" : "Models"}`
          : `No new models · Total ${providerTotal} Models`,
        added > 0 ? "success" : "default"
      );
    } catch (err) {
      flash(getErrorMessage(err, "Import failed"), "error");
    } finally {
      setImportingModels(false);
    }
  }

  async function runAddCustomModel() {
    const modelId = newModel.trim();
    if (!selected || !modelId || addingModel) return;

    setAddingModel(true);
    try {
      const result = await addCustomModelAPI(selected.id, modelId);
      restoreImportedModels(selected.id, [modelId]);
      qc.setQueryData(["custom-models"], result.models);
      setCustomTick((tick) => tick + 1);
      setForceTick((tick) => tick + 1);
      await qc.invalidateQueries({ queryKey: ["custom-models"] });
      await qc.invalidateQueries({ queryKey: ["available-models"] });
      await qc.invalidateQueries({ queryKey: ["sway-chat", "models"] });
      setNewModel("");
      toast.success(`Added ${modelId}`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to add model"));
    } finally {
      setAddingModel(false);
    }
  }

  async function runTestAllModels() {
    if (!testConnId) return flash("Add a connection first");
    if (modelTestLockRef.current) return;
    if (modelTestControllersRef.current.size > 0) {
      return flash("Stop individual model tests before running Test all");
    }
    const modelsToTest = visibleModels.map((row) => row.id);
    if (!modelsToTest.length) return flash("No models");
    modelTestLockRef.current = true;
    setModelTestLock(true);
    setBatchKind("model");
    const ac = new AbortController();
    abortRef.current = ac;
    const outcomes: Array<boolean | undefined> = new Array(modelsToTest.length);
    let nextIndex = 0;
    try {

      const concurrency = Math.min(MODEL_TEST_CONCURRENCY, modelsToTest.length);
      const worker = async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= modelsToTest.length || ac.signal.aborted) return;
          outcomes[index] = await runTestModel(modelsToTest[index], testConnId, ac.signal);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (!ac.signal.aborted) {
        const completed = outcomes.filter((value) => value !== undefined).length;
        const passed = outcomes.filter(Boolean).length;
        flash(`Models: ${passed}/${completed} passed`);
      }
    } catch (err) {
      if (!axios.isCancel(err) && (err as { code?: string })?.code !== "ERR_CANCELED") {
        flash(getErrorMessage(err, "Model test failed"), "error");
      }
    } finally {
      setTestingModels(new Set());
      setBatchKind(null);
      if (abortRef.current === ac) abortRef.current = null;
      modelTestLockRef.current = false;
      setModelTestLock(false);
    }
  }

  const strategyM = useMutation({
    mutationFn: async (patch: {
      strategy?: RotationStrategy;
      sticky?: number;
    }) => {
      if (!selected) return;
      const current = settings?.providerStrategies || {};
      const entry = { ...(current[selected.id] || {}) };
      if (patch.strategy) entry.fallbackStrategy = patch.strategy;
      if (patch.sticky) entry.stickyRoundRobinLimit = patch.sticky;
      return updateSettings({
        providerStrategies: { ...current, [selected.id]: entry },
      });
    },
    onSuccess: () => {

      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const thinkingM = useMutation({
    mutationFn: async (level: ThinkingLevel) => {
      if (!selected) return;
      return updateSettings({
        providerThinking: {
          ...(settings?.providerThinking || {}),
          [selected.id]: level,
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  async function onToggle(id: string) {
    const cur = connections.find((c) => c.id === id);
    if (!cur || togglingConnId) return;
    setTogglingConnId(id);
    try {
      const updated = await toggleConnection(id, cur.isActive !== false);
      setLoadedConnections((prev) =>
        prev.map((connection) =>
          connection.id === updated.id ? { ...connection, ...updated } : connection
        )
      );
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["providers-available"] });
      flash(
        `${updated.name || cur.name || "Connection"} ${updated.isActive === false ? "disabled" : "enabled"}`,
        "success"
      );
    } catch (error) {
      flash(getErrorMessage(error, "Failed to update connection"), "error");
    } finally {
      setTogglingConnId(null);
    }
  }

  async function movePriority(id: string, dir: -1 | 1) {
    const idx = conns.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= conns.length) return;
    const a = conns[idx];
    const b = conns[j];
    const pa = a.priority ?? (idx + 1) * 10;
    const pb = b.priority ?? (j + 1) * 10;

    await Promise.all([
      updateConnection(a.id, { priority: pb }),
      updateConnection(b.id, { priority: pa }),
    ]);
    void qc.invalidateQueries({ queryKey: ["connections"] });
  }

  async function onDeleteConn(id: string) {
    try {
      await deleteConnection(id);
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["providers-available"] });
      setDeleteId(null);
      flash("Connection deleted", "success");
    } catch (error) {
      flash(getErrorMessage(error, "Failed to delete connection"), "error");
    }
  }

  async function onDeleteSelectedConnections() {
    if (!bulkDeleteIds?.length || bulkDeleting) return;
    const ids = bulkDeleteIds;
    setBulkDeleting(true);
    const failedIds: string[] = [];
    try {
      for (const id of ids) {
        try {
          await deleteConnection(id);
        } catch {

          failedIds.push(id);
        }
      }
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["providers-available"] });

      const deletedCount = ids.length - failedIds.length;
      if (deletedCount === ids.length) {
        setSelectedKeys(new Set());
        setBulkDeleteIds(null);
        flash(
          `${deletedCount} connection${deletedCount === 1 ? "" : "s"} deleted`,
          "success"
        );
      } else if (deletedCount > 0) {
        setSelectedKeys(new Set(failedIds));
        setBulkDeleteIds(null);
        flash(
          `Deleted ${deletedCount} of ${ids.length} connections`,
          "warning"
        );
      } else {
        flash("Could not delete the selected connections", "error");
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  async function onAddConnection(body: {
    name: string;
    apiKey?: string;
    importToken?: string;
    codeBuddyToken?: string;
    codeBuddyTokens?: Array<{
      credentialToken?: string;
      accessToken?: string;
      refreshToken?: string;
      name?: string;
      autoName?: boolean;
    }>;
    machineId?: string;
    oauthCode?: string;
    oauthState?: string;
    oauthCodeVerifier?: string;
    oauthRedirectUri?: string;
    deviceCode?: string;
    deviceCodeVerifier?: string;
    proxyPoolId?: string | null;
    kiroAuthMode?: KiroAuthMode;
    kiroRegion?: string;
    kiroRefreshToken?: string;
    kiroClientId?: string;
    kiroClientSecret?: string;
    kiroProfileArn?: string;
    kiroCliProxyJson?: string;

    authFlow?: AuthFlow;
    bulkKeys?: Array<{ name: string; apiKey: string; autoName?: boolean }>;

    autoName?: boolean;

    alreadySaved?: boolean;
  }) {
    if (!selected) return;
    if (body.alreadySaved) {
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["providers-available"] });
      setAddOpen(false);
      flash("Connection added");
      return;
    }
    const proxyPoolId =
      body.proxyPoolId && body.proxyPoolId !== "pool_none"
        ? body.proxyPoolId
        : null;
    if (body.codeBuddyTokens?.length) {
      if (selected.id !== "codebuddy-cn" && selected.id !== "codebuddy-intl") {
        throw new Error("Token batches are only supported for CodeBuddy");
      }
      let added = 0;
      let skippedDuplicates = 0;
      for (const tokenSet of body.codeBuddyTokens) {
        try {
          await createConnection({
            provider: selected.id,
            credentialToken: tokenSet.credentialToken,
            accessToken: tokenSet.accessToken,
            refreshToken: tokenSet.refreshToken,
            name: tokenSet.name,
            autoName: tokenSet.autoName,
            proxyPoolId: null,
          });
          added += 1;
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 409) {
            skippedDuplicates += 1;
            continue;
          }
          throw error;
        }
      }
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["providers-available"] });
      setAddOpen(false);
      flash(
        skippedDuplicates > 0
          ? `Added ${added} connections, skipped ${skippedDuplicates} duplicates`
          : `Added ${added} connections`,
        skippedDuplicates > 0 ? "warning" : "success"
      );
      return;
    }
    if (body.bulkKeys?.length) {

      let added = 0;
      let skippedDuplicates = 0;
      for (const key of body.bulkKeys) {
        try {
          await createConnection({
            provider: selected.id,
            apiKey: key.apiKey,
            name: key.name,
            autoName: key.autoName,
            proxyPoolId,
          });
          added += 1;
        } catch (error) {

          if (axios.isAxiosError(error) && error.response?.status === 409) {
            skippedDuplicates += 1;
            continue;
          }
          throw error;
        }
      }
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["providers-available"] });
      setAddOpen(false);
      flash(
        skippedDuplicates > 0
          ? `Added ${added} connections, skipped ${skippedDuplicates} duplicates`
          : `Added ${added} connections`,
        skippedDuplicates > 0 ? "warning" : "success"
      );
      return;
    }

    const flowKind = body.authFlow ?? resolveAuthFlow(
      selected.id,
      selected.authType,
      selected.noAuth
    );

    if (selected.id === "kiro" && body.kiroAuthMode === "api-key") {
      if (!body.apiKey?.trim()) throw new Error("API key required");
      const result = await createKiroApiKey({
        apiKey: body.apiKey.trim(),
        region: body.kiroRegion,
        name: body.name,
        autoName: body.autoName,
      });
      if (!result.success) throw new Error(result.error || "Kiro API key validation failed");
    } else if (selected.id === "kiro" && body.kiroAuthMode === "import-token") {
      if (!body.kiroRefreshToken?.trim()) throw new Error("Refresh token required");
      const result = await importKiroToken({
        refreshToken: body.kiroRefreshToken.trim(),
        clientId: body.kiroClientId?.trim() || undefined,
        clientSecret: body.kiroClientSecret?.trim() || undefined,
        region: body.kiroRegion,
        profileArn: body.kiroProfileArn?.trim() || undefined,
        name: body.name,
        autoName: body.autoName,
      });
      if (!result.success) throw new Error(result.error || "Kiro token import failed");
    } else if (selected.id === "kiro" && body.kiroAuthMode === "cli-proxy") {
      if (!body.kiroCliProxyJson?.trim()) throw new Error("CLIProxyAPI JSON required");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.kiroCliProxyJson);
      } catch {
        throw new Error("CLIProxyAPI JSON is invalid");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("CLIProxyAPI JSON must be an object");
      }
      const result = await importKiroCliProxy({
        cliProxyAuth: parsed as Record<string, unknown>,
        name: body.name,
        autoName: body.autoName,
      });
      if (!result.success) throw new Error(result.error || "CLIProxyAPI import failed");
    } else if (
      flowKind === "import" &&
      (selected.id === "codebuddy-cn" || selected.id === "codebuddy-intl")
    ) {
      if (!body.codeBuddyToken?.trim()) {
        throw new Error("An access token or refresh token is required.");
      }
      await createConnection({
        provider: selected.id,
        credentialToken: body.codeBuddyToken.trim(),
        name: body.name,
        autoName: body.autoName,
        proxyPoolId: null,
      });
    } else if (flowKind === "import") {
      if (!body.importToken?.trim()) {
        throw new Error("Access token required");
      }
      const imp = await importToken(selected.id, {
        accessToken: body.importToken.trim(),
        displayName: body.name,
        machineId: body.machineId,
      });
      if (!imp.success) {
        throw new Error(imp.error || "Token import failed");
      }
    } else if (flowKind === "oauth") {
      if (!body.oauthCode?.trim()) {
        throw new Error("Paste the OAuth code from the browser callback");
      }
      await exchangeOAuth(selected.id, {
        code: body.oauthCode.trim(),
        state: body.oauthState,
        codeVerifier: body.oauthCodeVerifier,
        redirectUri: body.oauthRedirectUri,
        displayName: body.name,
      });
    } else if (flowKind === "device") {
      if (!body.deviceCode) {
        throw new Error("Device code not started — wait for user code");
      }

      const poll = await pollDeviceCode(selected.id, {
        deviceCode: body.deviceCode,
        codeVerifier: body.deviceCodeVerifier,
        displayName: body.name,
      });
      if (poll.pending) {
        throw new Error("Still waiting for device authorization — keep polling");
      }
      if (!poll.success) {
        throw new Error(poll.error || "Device authorization failed");
      }
    } else if (flowKind === "local") {
      await createConnection({
        provider: selected.id,
        name: body.name,
        autoName: body.autoName,
        proxyPoolId,
      });
    } else {

      if (!body.apiKey?.trim()) {
        throw new Error("API key required");
      }
      await createConnection({
        provider: selected.id,
        apiKey: body.apiKey,
        name: body.name,
        autoName: body.autoName,
        proxyPoolId,
      });
    }
    void qc.invalidateQueries({ queryKey: ["connections"] });
    void qc.invalidateQueries({ queryKey: ["providers-available"] });
    setAddOpen(false);
    flash("Connection added");
  }

  function removeCustomProvider(provider: AvailableProvider) {
    const nodeConns = connsAll.filter((connection) => connection.provider === provider.id);
    void (async () => {
      for (const connection of nodeConns) {
        try {
          await deleteConnection(connection.id);
        } catch {
        }
      }
      void deleteNode(provider.id).then(() => {
        void qc.invalidateQueries({ queryKey: ["nodes"] });
        void qc.invalidateQueries({ queryKey: ["providers-available"] });
        void qc.invalidateQueries({ queryKey: ["connections"] });
        flash("Provider removed");
      });
    })();
    setDeleteProvider(null);
  }

  const loading = availableQ.isLoading;
  const flow: AuthFlow | null = selected
    ? selected.isCustom
      ? "apikey"
      : resolveAuthFlow(selected.id, selected.authType, selected.noAuth)
    : null;

  return (

    <div
      className={cn(
        "flex h-full w-full flex-col gap-1.5 overflow-hidden sm:gap-3 lg:gap-4"
      )}
    >
      <Header
        className="mb-0 sm:mb-0 shrink-0"
        title="Providers"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RippleButton size="sm" onClick={() => setCustomOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Custom provider</span>
              <span className="sm:hidden">Custom</span>
            </RippleButton>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3 lg:flex-row lg:gap-4">
        <ProviderSidebar
          byProvider={byProvider}
          filter={filter}
          hiddenProviders={hiddenProviders}
          loading={loading}
          query={query}
          providerListRef={providerListRef}
          selectedId={selectedId}
          sorted={sorted}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
          onSelectProvider={selectProvider}
          onToggleProviderHidden={toggleProviderHidden}
        />
        <Frame className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              Select a provider
            </div>
          ) : (
            <>
              <ProviderDetailHeader
                selected={selected}
                conns={conns}
                activeConns={activeConns}
                onEditCustom={() => setEditCustom(selected)}
                onDeleteCustom={() => setDeleteProvider(selected)}
                onAddConnection={() => setAddOpen(true)}
              />

              <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                <Tabs
                  value={detailTab}
                  onValueChange={setDetailTab}
                  defaultValue="connections"
                  className="flex min-h-0 h-full flex-1 flex-col overflow-hidden"
                >
                  <div className="shrink-0 border-b border-border px-2 py-2 sm:px-5 sm:py-3">
                    <TabsList>
                      <TabsTrigger value="connections">Connection</TabsTrigger>
                      <TabsTrigger value="models">Models</TabsTrigger>
                    </TabsList>
                  </div>

                  <ProviderConnectionsPanel
                    selected={selected}
                    connsAll={connsAll}
                    conns={conns}
                    strategy={strategy}
                    strategyPending={strategyM.isPending}
                    stickyDraft={stickyDraft}
                    thinkingLevels={thinkingLevels}
                    thinkingValue={thinkingValue}
                    thinkingPending={thinkingM.isPending}
                    selectedKeys={selectedKeys}
                    connectionsCapped={connectionsCapped}
                    totalConnections={connectionPagination?.totalItems ?? connsAll.length}
                    batchKind={batchKind}
                    testingConnId={testingConnId}
                    togglingConnId={togglingConnId}
                    connQuery={connQuery}
                    connListRef={connListRef}
                    connVirtualizer={connVirtualizer}
                    connResults={connResults}
                    onStrategyChange={(value) => strategyM.mutate({ strategy: value })}
                    onStickyDraftChange={setStickyDraft}
                    onSaveSticky={() => {
                      const next = Math.max(1, parseInt(stickyDraft, 10) || 1);
                      strategyM.mutate({ sticky: next });
                      setStickyDraft(String(next));
                    }}
                    onThinkingChange={(value) => thinkingM.mutate(value)}
                    onRequestBulkDelete={() => setBulkDeleteIds([...selectedKeys])}
                    onClearSelection={() => setSelectedKeys(new Set())}
                    onToggleSelection={(id) => {
                      setSelectedKeys((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                    onSelectAll={() =>
                      setSelectedKeys(new Set(conns.map((connection) => connection.id)))
                    }
                    onTestConnections={(ids) => runTestConns(ids)}
                    onTestConnection={(id) => {
                      void runTestConn(id);
                    }}
                    onStopTests={stopTests}
                    onConnQueryChange={setConnQuery}
                    onOpenAddConnection={() => setAddOpen(true)}
                    onMovePriority={(id, direction) => movePriority(id, direction)}
                    onToggleConnection={(id) => onToggle(id)}
                    onEditConnection={setEditConn}
                    onDeleteConnection={setDeleteId}
                  />

                  <ProviderModelsPanel
                    selected={selected}
                    visibleModels={visibleModels}
                    models={models}
                    modelNames={modelNames}
                    modelsLoading={modelsLoading}
                    modelsUnavailable={modelsUnavailable}
                    importingModels={importingModels}
                    testConnId={testConnId}
                    batchKind={batchKind}
                    modelTestLock={modelTestLock}
                    testingModels={testingModels}
                    modelQuery={modelQuery}
                    newModel={newModel}
                    addingModel={addingModel}
                    modelResults={modelResults}
                    pinnedFor={pinnedFor}
                    copied={copied}
                    onImportModels={() => void runImportModels()}
                    onTestAllModels={() => void runTestAllModels()}
                    onStopTests={stopTests}
                    onStopModel={stopModelTest}
                    onModelQueryChange={setModelQuery}
                    onNewModelChange={setNewModel}
                    onAddModel={() => void runAddCustomModel()}
                    onTogglePin={togglePin}
                    onCopyModelId={async (modelId) => {
                      await navigator.clipboard.writeText(modelId);
                      setCopied(modelId);
                      window.setTimeout(() => setCopied(null), 1000);
                    }}
                    onTestModel={(modelId, connectionId) =>
                      void runTestModel(modelId, connectionId)
                    }
                    onRemoveModel={async (modelId) => {
                      let removed = false;
                      try {
                        const res = await removeCustomModelAPI(selected.id, modelId);
                        removed = res?.removed === true;
                      } catch {
                      } finally {
                        hideModel(selected.id, modelId);
                        setCustomTick((tick) => tick + 1);
                        setForceTick((tick) => tick + 1);
                        void qc.invalidateQueries({ queryKey: ["sway-chat", "models"] });
                      }
                      toast(`${removed ? "Removed" : "Hidden"} ${modelId.split("/").pop()}`);
                    }}
                  />
                </Tabs>
              </FramePanel>
            </>
          )}
        </Frame>
      </div>

      <AddConnectionDialog
        open={addOpen}
        provider={selected}
        flow={flow}
        onOpenChange={setAddOpen}
        onSubmit={async (body) => {
          try {
            await onAddConnection(body);
          } catch (err) {
            flash(getErrorMessage(err, "Add failed"), "error");
            throw err;
          }
        }}
      />

      <EditDialog
        conn={editConn}
        onOpenChange={(open) => !open && setEditConn(null)}
        onSave={async (name, newKey) => {
          if (!editConn) return;
          await updateConnection(editConn.id, {
            name,
            ...(newKey.trim() ? { apiKey: newKey.trim() } : {}),
          });
          void qc.invalidateQueries({ queryKey: ["connections"] });
          setEditConn(null);
          flash("Updated");
        }}
      />

      <ProviderDeleteDialogs
        deleteId={deleteId}
        bulkDeleteIds={bulkDeleteIds}
        bulkDeleting={bulkDeleting}
        deleteProvider={deleteProvider}
        connections={connsAll}
        onCloseDelete={() => setDeleteId(null)}
        onDeleteConnection={() => (deleteId ? onDeleteConn(deleteId) : undefined)}
        onCloseBulkDelete={() => setBulkDeleteIds(null)}
        onDeleteSelectedConnections={onDeleteSelectedConnections}
        onCloseProvider={() => setDeleteProvider(null)}
        onRemoveProvider={removeCustomProvider}
      />



      <CustomProviderDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        onCreate={async (body) => {
          const node = await createNode(body);
          void qc.invalidateQueries({ queryKey: ["nodes"] });
          void qc.invalidateQueries({ queryKey: ["providers-available"] });
          setCustomOpen(false);
          selectProvider(node.id);
          flash("Custom provider created");
        }}
      />

      <CustomProviderDialog
        open={Boolean(editCustom)}
        onOpenChange={(open) => {
          if (!open) setEditCustom(null);
        }}
        initial={editCustom}
        submitLabel="Save"
        onCreate={async (body) => {
          if (!editCustom) return;
          const node = await updateNode(editCustom.id, body);
          void qc.invalidateQueries({ queryKey: ["nodes"] });
          void qc.invalidateQueries({ queryKey: ["providers-available"] });
          void qc.invalidateQueries({ queryKey: ["connections"] });
          setEditCustom(null);
          selectProvider(node.id);
          flash("Custom provider updated");
        }}
      />
    </div>
  );
}
