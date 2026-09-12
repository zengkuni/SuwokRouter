import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  Cloud,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { Header } from "@/components/Header";
import { FlipButton } from "@/components/animate/flip-button";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import { Checkbox } from "@/components/ui/checkbox";
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
  createProxyPool,
  deployProxyRelay,
  deleteProxyPool,
  listProxyPools,
  testProxyPool,
  updateProxyPool,
  type CreatePoolInput,
  type DeployRelayInput,
  listNodes,
  type ProxyPool,
} from "@/lib/admin-extras-api";
import {
  listConnectionsPage,
  updateConnection,
  type Connection,
} from "@/lib/connections-api";
import { providerName } from "@/lib/providers";
import { probeEnabled } from "@/lib/live-mode";
import { toast } from "@/components/ui/toast";

type PoolActionsProps = {
  pool: ProxyPool;
  testing: boolean;
  onToggle: () => void;
  onTest: () => void;
  onManage: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

const PROXY_CONNECTION_PAGE_SIZE = 100;
const MAX_PROXY_ASSIGNMENTS_PER_ACTION = 500;

function PoolActions({
  pool,
  testing,
  onToggle,
  onTest,
  onManage,
  onEdit,
  onDelete,
}: PoolActionsProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      <FlipButton
        active={pool.isActive !== false}
        onToggle={onToggle}
        activeLabel=""
        inactiveLabel=""
      />
      <Tooltip label={testing ? "Testing…" : "Test"}>
        <RippleButton
          size="sm"
          variant="outline"
          disabled={testing}
          onClick={onTest}
          aria-label={testing ? "Testing proxy pool" : "Test proxy pool"}
          className="h-7 w-7 px-0 sm:w-auto sm:px-3 sm:text-sm"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-4 fill-current sm:hidden" aria-hidden="true" />
          )}
          <span className="hidden font-medium sm:inline">
            {testing ? "Testing…" : "Test"}
          </span>
        </RippleButton>
      </Tooltip>
      <Tooltip label="Manage">
        <RippleButton
          size="sm"
          variant="outline"
          onClick={onManage}
          aria-label="Manage connections"
          className="h-7 w-7 px-0 sm:w-auto sm:px-3 sm:text-sm"
        >
          <Users className="size-4 sm:hidden" aria-hidden="true" />
          <span className="hidden font-medium sm:inline">Manage</span>
        </RippleButton>
      </Tooltip>
      <Tooltip label="Edit">
        <RippleButton
          size="sm"
          variant="outline"
          onClick={onEdit}
          aria-label="Edit proxy pool"
          className="h-7 w-7 px-0 sm:w-auto sm:px-3 sm:text-sm"
        >
          <Pencil className="size-4 sm:hidden" aria-hidden="true" />
          <span className="hidden font-medium sm:inline">Edit</span>
        </RippleButton>
      </Tooltip>
      <Tooltip label="Delete">
        <RippleButton
          size="sm"
          variant="destructive"
          onClick={onDelete}
          aria-label="Delete proxy pool"
          className="h-7 w-7 px-0 sm:w-auto sm:px-3 sm:text-sm"
        >
          <Trash2 className="size-4 sm:hidden" aria-hidden="true" />
          <span className="hidden font-medium sm:inline">Delete</span>
        </RippleButton>
      </Tooltip>
    </div>
  );
}

type DeployProgress = {
  steps: string[];
  current: number;
  completed: boolean;
  error: string | null;
};

function DeployProgressPanel({ progress }: { progress: DeployProgress }) {
  const status = progress.error
    ? "Failed"
    : progress.completed
      ? "Ready"
      : `Step ${progress.current + 1} of ${progress.steps.length}`;

  return (
    <div
      className="rounded-lg border border-border/70 bg-muted/10 p-3"
      role="status"
      aria-live="polite"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium">Deployment progress</span>
        <span className="text-[11px] text-muted-foreground">{status}</span>
      </div>
      <ol className="space-y-2.5">
        {progress.steps.map((step, index) => {
          const done = progress.completed || index < progress.current;
          const failed = Boolean(progress.error) && index === progress.current;
          const active = !progress.completed && !progress.error && index === progress.current;
          const connectorDone = progress.completed || index < progress.current;

          return (
            <li key={step} className="relative flex min-h-5 items-start gap-2.5">
              {index < progress.steps.length - 1 ? (
                <span
                  className={`absolute left-[7px] top-5 h-[calc(100%-4px)] w-px ${
                    connectorDone ? "bg-primary/70" : "bg-border"
                  }`}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={`relative z-10 flex size-4 shrink-0 items-center justify-center rounded-full border bg-background ${
                  failed
                    ? "border-destructive text-destructive"
                    : done
                      ? "border-primary bg-primary text-primary-foreground"
                      : active
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground"
                }`}
              >
                {failed ? (
                  <CircleAlert className="size-3" aria-hidden="true" />
                ) : done ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : active ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                )}
              </span>
              <span
                className={`pt-px text-xs ${
                  failed
                    ? "text-destructive"
                    : active
                      ? "font-medium text-foreground"
                      : done
                        ? "text-foreground"
                        : "text-muted-foreground"
                }`}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      {progress.error ? (
        <p className="mt-3 text-xs text-destructive">{progress.error}</p>
      ) : null}
    </div>
  );
}

export default function Proxy() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployType, setDeployType] = useState<"vercel" | "cloudflare">("vercel");
  const [deployProjectName, setDeployProjectName] = useState("");
  const [deployToken, setDeployToken] = useState("");
  const [deployAccountId, setDeployAccountId] = useState("");
  const [deploySaving, setDeploySaving] = useState(false);
  const [deployProgress, setDeployProgress] = useState<DeployProgress | null>(null);
  const [editPool, setEditPool] = useState<ProxyPool | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [managePool, setManagePool] = useState<ProxyPool | null>(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(
    new Set(),
  );
  const [connectionQuery, setConnectionQuery] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConnectionSearch(connectionQuery.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [connectionQuery]);

  useEffect(() => {
    if (!deploySaving) return;

    const timer = window.setInterval(() => {
      setDeployProgress((progress) => {
        if (!progress || progress.completed || progress.error) return progress;

        const lastInFlightStep = Math.max(0, progress.steps.length - 2);
        if (progress.current >= lastInFlightStep) return progress;
        return { ...progress, current: progress.current + 1 };
      });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [deploySaving]);

  const [name, setName] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [noProxy, setNoProxy] = useState("");
  const [type, setType] = useState("http");
  const [strictProxy, setStrictProxy] = useState(false);

  const poolsQ = useQuery({
    queryKey: ["proxy-pools"],
    queryFn: listProxyPools,
    enabled: probeEnabled(),
    retry: false,
  });
  const nodesQ = useQuery({
    queryKey: ["proxy-pool-provider-nodes"],
    queryFn: listNodes,
    enabled: Boolean(managePool),
    retry: false,
  });

  const pools = poolsQ.data ?? [];
  const loading = poolsQ.isLoading;

  const connectionsQ = useQuery({
    queryKey: ["proxy-pool-connections", connectionSearch],
    queryFn: () => listConnectionsPage({
      page: 1,
      pageSize: PROXY_CONNECTION_PAGE_SIZE,
      search: connectionSearch || undefined,
    }),
    enabled: Boolean(managePool),
    retry: false,
  });

  const managedConnections = useMemo(() => {
    const connections = [...(connectionsQ.data?.connections ?? [])];
    return connections
      .sort((a, b) => {
        const providerOrder = a.provider.localeCompare(b.provider);
        if (providerOrder) return providerOrder;
        return String(a.name || a.email || a.id).localeCompare(
          String(b.name || b.email || b.id),
        );
      });
  }, [connectionsQ.data]);

  const managedGroups = useMemo(() => {
    const groups = new Map<string, Connection[]>();
    for (const connection of managedConnections) {
      const rows = groups.get(connection.provider) ?? [];
      rows.push(connection);
      groups.set(connection.provider, rows);
    }
    return [...groups.entries()];
  }, [managedConnections]);

  function providerLabel(provider: string, group: Connection[]) {
    const node = (nodesQ.data ?? []).find((candidate) => candidate.id === provider);
    if (node?.name) return node.name;
    const nodeName = group.find((connection) =>
      typeof connection.providerSpecificData?.nodeName === "string",
    )?.providerSpecificData?.nodeName;
    if (typeof nodeName === "string" && nodeName.trim()) return nodeName.trim();
    return providerName(provider);
  }

  const managedVisibleIds = useMemo(
    () => managedConnections.map((connection) => connection.id),
    [managedConnections],
  );
  const selectedVisibleCount = managedVisibleIds.filter((id) =>
    selectedConnectionIds.has(id),
  ).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pools;
    return pools.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.proxyUrl || "").toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [pools, query]);

  function flash(
    msg: string,
    tone: "success" | "error" | "default" = "default"
  ) {
    if (tone === "success") toast.success(msg);
    else if (tone === "error") toast.error(msg);
    else toast(msg);
  }

  function resetForm() {
    setName("");
    setProxyUrl("");
    setNoProxy("");
    setType("http");
    setStrictProxy(false);
  }

  function resetDeployForm() {
    setDeployType("vercel");
    setDeployProjectName("");
    setDeployToken("");
    setDeployAccountId("");
    setDeployProgress(null);
  }

  async function onDeployRelay() {
    if (deployType === "cloudflare" && !deployAccountId.trim()) {
      return flash("Cloudflare Account ID required", "error");
    }
    if (!deployToken.trim()) {
      return flash("Deployment token required", "error");
    }

    const steps = deployType === "vercel"
      ? ["Create deployment", "Wait for deployment", "Check relay", "Save proxy pool"]
      : ["Upload worker", "Enable subdomain", "Check relay", "Save proxy pool"];
    setDeployProgress({ steps, current: 0, completed: false, error: null });

    let body: DeployRelayInput;
    if (deployType === "vercel") {
      body = {
        type: "vercel",
        vercelToken: deployToken.trim(),
        projectName: deployProjectName.trim() || undefined,
      };
    } else {
      body = {
        type: "cloudflare",
        accountId: deployAccountId.trim(),
        apiToken: deployToken.trim(),
        projectName: deployProjectName.trim() || undefined,
      };
    }

    setDeploySaving(true);
    try {
      await deployProxyRelay(body);
      await qc.invalidateQueries({ queryKey: ["proxy-pools"] });
      setDeployProgress((progress) =>
        progress ? { ...progress, current: progress.steps.length - 1, completed: true } : progress,
      );
      flash(`${deployType[0].toUpperCase()}${deployType.slice(1)} relay deployed`, "success");
      setDeployOpen(false);
      resetDeployForm();
    } catch (err) {
      const message = getErrorMessage(err, "Relay deployment failed");
      setDeployProgress((progress) => (progress ? { ...progress, error: message } : progress));
      flash(message, "error");
    } finally {
      setDeploySaving(false);
    }
  }

  function openEdit(p: ProxyPool) {
    setEditPool(p);
    setName(p.name || "");
    setProxyUrl(p.proxyUrl || "");
    setNoProxy(p.noProxy || "");
    setType(p.type || "http");
    setStrictProxy(p.strictProxy === true);
  }

  async function onCreate() {
    if (!name.trim() || !proxyUrl.trim()) {
      return flash("Name and proxy URL required", "error");
    }
    setSaving(true);
    try {
      const body: CreatePoolInput = {
        name: name.trim(),
        proxyUrl: proxyUrl.trim(),
        noProxy: noProxy.trim(),
        type,
        strictProxy,
      };
      await createProxyPool(body);
      await qc.invalidateQueries({ queryKey: ["proxy-pools"] });
      flash("Pool created", "success");
      setCreateOpen(false);
      resetForm();
    } catch (err) {
      flash(getErrorMessage(err, "Create failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveEdit() {
    if (!editPool) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        proxyUrl: proxyUrl.trim(),
        noProxy: noProxy.trim(),
        type,
        strictProxy,
      };
      await updateProxyPool(editPool.id, body);
      await qc.invalidateQueries({ queryKey: ["proxy-pools"] });
      flash("Pool updated", "success");
      setEditPool(null);
      resetForm();
    } catch (err) {
      flash(getErrorMessage(err, "Update failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(p: ProxyPool) {
    const next = p.isActive === false;
    try {
      await updateProxyPool(p.id, { isActive: next });
      await qc.invalidateQueries({ queryKey: ["proxy-pools"] });
    } catch (err) {
      flash(getErrorMessage(err, "Toggle failed"), "error");
    }
  }

  async function onTest(id: string) {
    setTestingId(id);
    try {
      const res = await testProxyPool(id);
      await qc.invalidateQueries({ queryKey: ["proxy-pools"] });
      if (res.ok) flash(`Proxy OK${res.ip ? ` · ${res.ip}` : ""}`, "success");
      else flash(res.error || "Proxy test failed", "error");
    } catch (err) {
      flash(getErrorMessage(err, "Test failed"), "error");
    } finally {
      setTestingId(null);
    }
  }

  function connectionPoolId(connection: Connection) {
    const nested = connection.providerSpecificData?.proxyPoolId;
    return typeof nested === "string" && nested.trim()
      ? nested
      : typeof connection.proxyPoolId === "string" && connection.proxyPoolId.trim()
        ? connection.proxyPoolId
        : null;
  }

  function openManage(p: ProxyPool) {
    setManagePool(p);
    setSelectedConnectionIds(new Set());
    setConnectionQuery("");
    setConnectionSearch("");
  }

  function toggleConnectionSelection(id: string) {
    setSelectedConnectionIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleConnections(ids: string[]) {
    if (!ids.length) return;
    setSelectedConnectionIds((previous) => {
      const next = new Set(previous);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function updateSelectedConnections(proxyPoolId: string | null) {
    if (!selectedConnectionIds.size) {
      flash("Select at least one connection", "error");
      return;
    }
    if (selectedConnectionIds.size > MAX_PROXY_ASSIGNMENTS_PER_ACTION) {
      flash(`Assign up to ${MAX_PROXY_ASSIGNMENTS_PER_ACTION} connections at a time`, "error");
      return;
    }
    setAssigning(true);
    const ids = [...selectedConnectionIds];
    const results: PromiseSettledResult<unknown>[] = [];
    for (let index = 0; index < ids.length; index += 12) {
      const batch = ids.slice(index, index + 12);
      results.push(
        ...(await Promise.allSettled(
          batch.map((id) => updateConnection(id, { proxyPoolId })),
        )),
      );
    }
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["proxy-pool-connections"] }),
      qc.invalidateQueries({ queryKey: ["proxy-pools"] }),
      qc.invalidateQueries({ queryKey: ["connections"] }),
    ]);
    setSelectedConnectionIds(new Set());
    setAssigning(false);
    if (failed) {
      flash(`${succeeded} updated, ${failed} failed`, "error");
    } else {
      flash(
        proxyPoolId ? `${succeeded} connection(s) assigned` : `${succeeded} connection(s) set to direct`,
        "success",
      );
    }
  }

  async function onDelete() {
    if (!deleteId) return;
    setSaving(true);
    try {
      await deleteProxyPool(deleteId);
      await qc.invalidateQueries({ queryKey: ["proxy-pools"] });
      flash("Pool deleted", "success");
      setDeleteId(null);
    } catch (err) {
      flash(getErrorMessage(err, "Delete failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Header
        title="Proxy Pools"
        actions={pools.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RippleButton
              size="sm"
              variant="outline"
              onClick={() => {
                resetDeployForm();
                setDeployOpen(true);
              }}
            >
              <Cloud className="h-4 w-4 fill-current" />
              Deploy
            </RippleButton>
            <RippleButton
              size="sm"
              onClick={() => {
                resetForm();
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add pool
            </RippleButton>
          </div>
        ) : null}
      />

      <div className="relative max-w-md">
        <span className="sr-only">Search proxy pools</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pools…"
          className="pl-9"
        />
      </div>

      <Frame className="overflow-hidden">
        <FramePanel className="p-0">
          <div className="min-w-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : pools.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">No proxy pools</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <RippleButton size="sm" onClick={() => {
                resetForm();
                setCreateOpen(true);
              }}>
                <Plus className="h-4 w-4" />
                Add first pool
              </RippleButton>
              <RippleButton
                size="sm"
                variant="outline"
                onClick={() => {
                  resetDeployForm();
                  setDeployOpen(true);
                }}
              >
                <Cloud className="h-4 w-4 fill-current" />
                Deploy relay
              </RippleButton>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            No proxy pools match your search.
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
              <div className="divide-y divide-border/70">
                {filtered.map((p) => (
                  <article key={p.id} className="min-w-0 space-y-2.5 p-3">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {p.name || p.id}
                          </span>
                          {p.isActive === false ? (
                            <StatusBadge tone="muted" className="shrink-0 text-[10px]">
                              Off
                            </StatusBadge>
                          ) : null}
                        </div>
                        <Tooltip label={p.proxyUrl || "—"}>
                          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                            {p.proxyUrl || "—"}
                          </p>
                        </Tooltip>
                      </div>
                      <StatusBadge
                        tone={
                          p.testStatus === "ok" || p.testStatus === "active"
                            ? "ok"
                            : p.testStatus === "error"
                              ? "err"
                              : "muted"
                        }
                        className="shrink-0 text-[10px]"
                      >
                        {p.testStatus === "active" ? "ok" : p.testStatus || "unknown"}
                      </StatusBadge>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="shrink-0 uppercase">{p.type || "http"}</span>
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 truncate">
                        {p.boundConnectionCount ?? 0} connections
                      </span>
                    </div>
                    <PoolActions
                      pool={p}
                      testing={testingId === p.id}
                      onToggle={() => void onToggle(p)}
                      onTest={() => void onTest(p.id)}
                      onManage={() => openManage(p)}
                      onEdit={() => openEdit(p)}
                      onDelete={() => setDeleteId(p.id)}
                    />
                  </article>
                ))}
              </div>
            </div>

            <div className="hidden min-w-0 sm:block">
              <Table
                variant="card"
                className="min-w-[44rem] text-[13px] [&_tbody]:before:hidden [&_tbody_tr_td]:!bg-transparent [&_tbody_tr:hover_td]:!bg-transparent [&_tbody_tr[data-state=selected]_td]:!bg-transparent"
              >
                <TableHeader className="bg-transparent text-[10px] uppercase text-muted-foreground">
                  <TableRow className="border-b border-border/80 bg-transparent hover:bg-transparent">
                    <TableHead className="px-4 py-2 font-medium">Name</TableHead>
                    <TableHead className="px-3 py-2 font-medium">URL</TableHead>
                    <TableHead className="px-3 py-2 font-medium">Type</TableHead>
                    <TableHead className="px-3 py-2 font-medium">Connections</TableHead>
                    <TableHead className="px-3 py-2 font-medium">Test</TableHead>
                    <TableHead className="px-4 py-2 font-medium text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow
                      key={p.id}
                      className="border-b border-border/60 last:border-0 bg-transparent hover:bg-transparent data-[state=selected]:bg-transparent"
                    >
                      <TableCell className="max-w-[14rem] bg-transparent px-4 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {p.name || p.id}
                          </span>
                          {p.isActive === false ? (
                            <StatusBadge tone="muted" className="shrink-0 text-[10px]">
                              Off
                            </StatusBadge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[24rem] truncate bg-transparent px-3 py-2 font-mono text-xs text-muted-foreground">
                        <Tooltip label={p.proxyUrl || "—"}>
                          <span className="block truncate">{p.proxyUrl || "—"}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="bg-transparent px-3 py-2 text-xs uppercase text-muted-foreground">
                        {p.type || "http"}
                      </TableCell>
                      <TableCell className="bg-transparent px-3 py-2 text-xs text-muted-foreground">
                        {p.boundConnectionCount ?? 0}
                      </TableCell>
                      <TableCell className="bg-transparent px-3 py-2">
                        <StatusBadge
                          tone={
                            p.testStatus === "ok" || p.testStatus === "active"
                              ? "ok"
                              : p.testStatus === "error"
                                ? "err"
                                : "muted"
                          }
                          className="w-fit text-[10px]"
                        >
                          {p.testStatus === "active" ? "ok" : p.testStatus || "unknown"}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="bg-transparent px-4 py-2">
                        <PoolActions
                          pool={p}
                          testing={testingId === p.id}
                          onToggle={() => void onToggle(p)}
                          onTest={() => void onTest(p.id)}
                          onManage={() => openManage(p)}
                          onEdit={() => openEdit(p)}
                          onDelete={() => setDeleteId(p.id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
          </div>
        </FramePanel>
      </Frame>
      <Dialog
        open={createOpen || !!editPool}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditPool(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {editPool ? "Edit proxy pool" : "Add proxy pool"}
            </DialogTitle>
            <DialogDescription>
              Used as connection outbound proxy.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="US residential"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">Proxy URL (HTTP/HTTPS/SOCKS5)</span>
              <Input
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="http://user:pass@host:port or host:port"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">No-proxy</span>
              <Input
                value={noProxy}
                onChange={(e) => setNoProxy(e.target.value)}
                placeholder="localhost,127.0.0.1"
              />
            </label>
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Type</span>
              <Segmented
                size="sm"
                value={type}
                onChange={setType}
                options={[
                  { value: "http", label: "HTTP" },
                  { value: "socks5", label: "SOCKS5" },
                ]}
              />
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border border-border/70 p-3">
              <Checkbox
                checked={strictProxy}
                onCheckedChange={(checked) => setStrictProxy(checked === true)}
                disabled={saving}
                aria-describedby="strict-proxy-help"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Require proxy</span>
                <span
                  id="strict-proxy-help"
                  className="mt-0.5 block text-xs text-muted-foreground"
                >
                  Fail requests when this proxy is unavailable instead of falling back to a direct connection.
                </span>
              </span>
            </label>
          </DialogPanel>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditPool(null);
              }}
              disabled={saving}
            >
              Cancel
            </RippleButton>
            <RippleButton
              onClick={() => void (editPool ? onSaveEdit() : onCreate())}
              disabled={saving}
            >
              {saving ? "Saving…" : editPool ? "Save" : "Create"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deployOpen}
        onOpenChange={(open) => {
          setDeployOpen(open);
          if (!open) resetDeployForm();
        }}
      >
        <DialogContent className="max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Deploy relay</DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Platform</span>
              <Segmented
                size="sm"
                value={deployType}
                onChange={(value) => setDeployType(value as typeof deployType)}
                options={[
                  { value: "vercel", label: "Vercel" },
                  { value: "cloudflare", label: "Cloudflare" },
                ]}
              />
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">Project name (optional)</span>
              <Input
                value={deployProjectName}
                onChange={(event) => setDeployProjectName(event.target.value)}
                placeholder="sway-router-relay"
                autoComplete="off"
              />
            </label>

            {deployType === "cloudflare" ? (
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">Account ID</span>
                <Input
                  value={deployAccountId}
                  onChange={(event) => setDeployAccountId(event.target.value)}
                  placeholder="Cloudflare account ID"
                  autoComplete="off"
                />
              </label>
            ) : null}

            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">
                {deployType === "vercel"
                  ? "Vercel API token"
                  : "Cloudflare API token"}
              </span>
              <Input
                type="password"
                value={deployToken}
                onChange={(event) => setDeployToken(event.target.value)}
                placeholder="Token"
                autoComplete="off"
              />
            </label>

            {deployProgress ? <DeployProgressPanel progress={deployProgress} /> : null}

          </DialogPanel>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => setDeployOpen(false)}
              disabled={deploySaving}
            >
              Cancel
            </RippleButton>
            <RippleButton onClick={() => void onDeployRelay()} disabled={deploySaving}>
              {deploySaving ? <Loader2 className="size-4 animate-spin" /> : null}
              {deploySaving ? "Deploying…" : "Deploy"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(managePool)}
        onOpenChange={(open) => {
          if (!open) {
            setManagePool(null);
            setSelectedConnectionIds(new Set());
            setConnectionQuery("");
            setConnectionSearch("");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl">
          <DialogHeader>
            <DialogTitle>Manage {managePool?.name || "proxy pool"}</DialogTitle>
            <DialogDescription>
              Assign existing provider connections to this pool without recreating their credentials.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={connectionQuery}
                onChange={(event) => setConnectionQuery(event.target.value)}
                placeholder="Search provider, name, email, or ID…"
                className="min-w-[14rem] flex-1"
              />
              <RippleButton
                size="sm"
                variant="outline"
                disabled={!managedVisibleIds.length || assigning}
                onClick={() => toggleConnections(managedVisibleIds)}
              >
                {selectedVisibleCount === managedVisibleIds.length
                  ? "Clear visible"
                  : "Select visible"}
              </RippleButton>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {connectionsQ.isLoading
                  ? "Loading connections…"
                  : `${connectionsQ.data?.pagination.totalItems ?? managedConnections.length} connection(s) · ${selectedConnectionIds.size} selected`}
              </span>
              <div className="flex gap-2">
                <RippleButton
                  size="sm"
                  disabled={!selectedConnectionIds.size || assigning}
                  onClick={() => void updateSelectedConnections(managePool?.id || null)}
                >
                  {assigning ? "Assigning…" : "Assign selected"}
                </RippleButton>
                <RippleButton
                  size="sm"
                  variant="outline"
                  disabled={!selectedConnectionIds.size || assigning}
                  onClick={() => void updateSelectedConnections(null)}
                >
                  Set direct
                </RippleButton>
              </div>
            </div>
            {connectionsQ.error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {getErrorMessage(connectionsQ.error, "Failed to load connections")}
              </p>
            ) : managedGroups.length === 0 && !connectionsQ.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No existing connections match this search.
              </p>
            ) : (
              <>
                {connectionsQ.data?.pagination.hasNext ? (
                  <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
                    Showing the first {PROXY_CONNECTION_PAGE_SIZE} matches. Use search to find other connections.
                  </p>
                ) : null}
                <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {managedGroups.map(([provider, group]) => {
                  const ids = group.map((connection) => connection.id);
                  const selectedCount = ids.filter((id) => selectedConnectionIds.has(id)).length;
                  const allSelected = selectedCount === ids.length;
                  return (
                    <div key={provider} className="rounded-lg border border-border">
                      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-2">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={selectedCount > 0 && !allSelected}
                          onCheckedChange={() => toggleConnections(ids)}
                          aria-label={`Select all ${provider} connections`}
                        />
                        <span className="font-medium">{providerLabel(provider, group)}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{provider}</span>
                        <span className="text-xs text-muted-foreground">
                          {selectedCount}/{ids.length}
                        </span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {group.map((connection) => {
                          const poolId = connectionPoolId(connection);
                          const isAssigned = poolId === managePool?.id;
                          const displayName = connection.name || connection.email || connection.id.slice(0, 8);
                          return (
                            <label
                              key={connection.id}
                              className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/20"
                            >
                              <Checkbox
                                checked={selectedConnectionIds.has(connection.id)}
                                onCheckedChange={() => toggleConnectionSelection(connection.id)}
                                aria-label={`Select ${displayName}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{displayName}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {connection.email && connection.name ? `${connection.email} · ` : ""}
                                  {connection.authType || "connection"} · {connection.id.slice(0, 8)}
                                </span>
                              </span>
                              <StatusBadge
                                tone={connection.isActive === false ? "muted" : isAssigned ? "ok" : "muted"}
                                className="shrink-0 text-[10px]"
                              >
                                {isAssigned ? "This pool" : poolId ? "Other pool" : "Direct"}
                              </StatusBadge>
                              {connection.isActive === false ? (
                                <StatusBadge tone="muted" className="shrink-0 text-[10px]">Off</StatusBadge>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                </div>
              </>
            )}
          </DialogPanel>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteId}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete pool?</DialogTitle>
            <DialogDescription>
              Detach all connections using this pool before deleting it. Bound pools cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => setDeleteId(null)}
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
