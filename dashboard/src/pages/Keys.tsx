import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, KeyRound, Plus, Search, Trash2 } from "lucide-react";
import { Header } from "@/components/Header";
import { CopyButton } from "@/components/animate/copy-button";
import { FlipButton } from "@/components/animate/flip-button";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api";
import {
  createApiKey,
  deleteApiKeyPermanent,
  getApiKeyRaw,
  listApiKeys,
  updateApiKey,
  type ApiKey,
} from "@/lib/api-keys-api";
import { probeEnabled } from "@/lib/live-mode";
import { maskKey } from "@/lib/tunnel-api";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { cn } from "@/lib/utils";

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function Keys() {
  const qc = useQueryClient();
  const setKeys = useApiKeyStore((s) => s.setKeys);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("active");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
  const [detailKey, setDetailKey] = useState<ApiKey | null>(null);
  const [fetchingKeyId, setFetchingKeyId] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const keysQ = useQuery({
    queryKey: ["api-keys", filter],
    queryFn: () =>
      listApiKeys({
        includeRevoked: filter === "paused" || filter === "all",
      }),
    enabled: probeEnabled(),
    retry: false,
  });

  const keys = keysQ.data ?? [];
  const loading = keysQ.isLoading;

  useEffect(() => {
    setKeys(keys);
  }, [keys, setKeys]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keys.filter((k) => {
      const paused = k.isActive === false;
      if (filter === "active" && paused) return false;
      if (filter === "paused" && !paused) return false;
      if (!q) return true;
      const masked = maskKey(k.key || "");
      return (
        k.name.toLowerCase().includes(q) ||
        masked.toLowerCase().includes(q) ||
        (k.id || "").toLowerCase().includes(q)
      );
    });
  }, [keys, query, filter]);

  async function handleCopyKey(k: ApiKey) {
    setFetchingKeyId(k.id);
    try {
      const raw = await getApiKeyRaw(k.id);
      if (!raw) {
        toast.error("No stored secret for this key — create a new key to copy it.");
        return;
      }
      await navigator.clipboard.writeText(raw);
      toast.success("Key copied to clipboard");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to copy key"));
    } finally {
      setFetchingKeyId(null);
    }
  }

  function toggleVisibility(id: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setName("");
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await createApiKey({ name: name.trim() });
      setCreatedKey(res.key.key || "");
      setCreateOpen(false);
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to create key"));
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(k: ApiKey) {
    const next = !k.isActive;
    try {
      await updateApiKey(k.id, { isActive: next });
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success(next ? "Key resumed" : "Key paused");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to update key"));
    }
  }

  async function confirmDelete() {
    if (!deleteKey) return;
    setCreating(true);
    try {
      await deleteApiKeyPermanent(deleteKey.id);
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("Key deleted");
      setDeleteKey(null);
      if (detailKey?.id === deleteKey.id) setDetailKey(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to delete key"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <Header
        title="API Keys"
        actions={keys.length > 0 ? (
          <RippleButton size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create key
          </RippleButton>
        ) : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, key, id…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["paused", "Paused"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                filter === id
                  ? "bg-white/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">No API keys found</p>
          <RippleButton size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create first key
          </RippleButton>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border px-4 py-16 text-center text-sm text-muted-foreground">
          No API keys match the current filter.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((k) => {
            const paused = k.isActive === false;
            const visible = visibleKeys.has(k.id);
            return (
              <div
                key={k.id}
                className={cn(
                  "group rounded-xl border border-border bg-card transition-colors hover:bg-card/80",
                  paused && "opacity-60"
                )}
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <KeyRound className="h-5 w-5 text-primary" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="truncate text-sm font-medium hover:underline"
                        onClick={() => setDetailKey(k)}
                      >
                        {k.name}
                      </button>
                      <StatusBadge
                        tone={paused ? "warn" : "ok"}
                        className="shrink-0"
                      >
                        {paused ? "Paused" : "Active"}
                      </StatusBadge>
                      {k.isDefault ? (
                        <StatusBadge tone="muted" className="shrink-0">
                          Default
                        </StatusBadge>
                      ) : null}
                    </div>

                    <div className="mt-1 flex items-center gap-1.5">
                      <code className="rounded bg-surface px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {visible ? k.key : maskKey(k.key || "")}
                      </code>
                      <Tooltip label={visible ? "Hide key" : "Show key"}>
                        <button
                          type="button"
                          onClick={() => toggleVisibility(k.id)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:text-primary"
                          aria-label={visible ? "Hide key" : "Show key"}
                        >
                          {visible ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </Tooltip>
                      <Tooltip label="Copy key">
                        <button
                          type="button"
                          onClick={() => void handleCopyKey(k)}
                          disabled={fetchingKeyId === k.id}
                          className="rounded p-1 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                          aria-label="Copy key"
                        >
                          {fetchingKeyId === k.id ? (
                            <span className="text-[10px]">…</span>
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </Tooltip>
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {fmtDate(k.createdAt)}
                      {k.machineId ? ` · machine ${k.machineId}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <FlipButton
                      active={!paused}
                      onToggle={() => void toggleActive(k)}
                      activeLabel=""
                      inactiveLabel=""
                    />
                    {!k.isDefault ? (
                      <Tooltip label="Delete">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteKey(k)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (!o) setCreateOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The full key is shown once after creation — store it securely.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Key name
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !creating) {
                  void submitCreate();
                }
              }}
            />
          </label>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </RippleButton>
            <RippleButton
              onClick={() => void submitCreate()}
              disabled={!name.trim() || creating}
            >
              {creating ? "Creating…" : "Create key"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdKey} onOpenChange={() => setCreatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
              <p className="mb-2 text-sm font-medium text-warning">
                Save this key now!
              </p>
              <p className="text-sm text-warning/80">
                This is the only time you will see the full key.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm">
                {createdKey}
              </code>
              <CopyButton value={createdKey || ""} label="" />
            </div>
            <DialogFooter>
              <RippleButton onClick={() => setCreatedKey(null)}>
                Done
              </RippleButton>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteKey}
        onOpenChange={(o) => {
          if (!o) setDeleteKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API key?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {deleteKey?.name}
              </span>{" "}
              ({maskKey(deleteKey?.key || "")}) will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton
              variant="outline"
              onClick={() => setDeleteKey(null)}
              disabled={creating}
            >
              Cancel
            </RippleButton>
            <RippleButton
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={creating}
            >
              {creating ? "Deleting…" : "Delete permanently"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!detailKey}
        onOpenChange={(o) => {
          if (!o) setDetailKey(null);
        }}
      >
        <DialogContent>
          {detailKey ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detailKey.name}
                  <StatusBadge
                    tone={
                      detailKey.isActive === false ? "warn" : "ok"
                    }
                  >
                    {detailKey.isActive === false ? "Paused" : "Active"}
                  </StatusBadge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Meta label="Created" value={fmtDate(detailKey.createdAt)} />
                  <Meta label="Machine" value={detailKey.machineId || "—"} />
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Key
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs">
                      {visibleKeys.has(detailKey.id)
                        ? detailKey.key
                        : maskKey(detailKey.key || "")}
                    </code>
                    <RippleButton
                      variant="outline"
                      size="sm"
                      onClick={() => toggleVisibility(detailKey.id)}
                    >
                      {visibleKeys.has(detailKey.id) ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </RippleButton>
                  </div>
                  <div className="flex items-center gap-2">
                    <CopyButton
                      value={detailKey.key || ""}
                      label="Copy key"
                    />
                    <RippleButton
                      variant="outline"
                      size="sm"
                      onClick={() => void toggleActive(detailKey)}
                    >
                      {detailKey.isActive === false ? "Resume" : "Pause"}
                    </RippleButton>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Use this key with the gateway endpoint to route LLM requests.
                  Requests without a valid key are rejected when "Require API key"
                  is on.
                </p>
              </div>

              <DialogFooter>
                {!detailKey.isDefault ? (
                  <RippleButton
                    variant="destructive"
                    onClick={() => {
                      setDeleteKey(detailKey);
                      setDetailKey(null);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </RippleButton>
                ) : (
                  <p className="text-xs text-muted-foreground">Default keys cannot be deleted. Revoke or rotate the secret instead.</p>
                )}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}
