import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { Header } from "@/components/Header";
import { CopyButton } from "@/components/animate/copy-button";
import { FlipButton } from "@/components/animate/flip-button";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/ui/frame";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/api";
import { probeEnabled } from "@/lib/live-mode";
import { createApiKey, deleteApiKeyPermanent, displayPrefix, getApiKeyRaw, listApiKeys, rotateApiKey, updateApiKey, type ApiKey } from "@/lib/api-keys-api";

type ConfirmState = { title: string; message: string; confirmLabel?: string; destructive?: boolean; onConfirm: () => void };

export default function ManageApiKey() {
  const qc = useQueryClient();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [copyingKeyId, setCopyingKeyId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("/v1");
  const keysQ = useQuery({ queryKey: ["api-keys-endpoint"], queryFn: () => listApiKeys({ includeRevoked: true }), enabled: probeEnabled(), retry: false });

  useEffect(() => { if (typeof window !== "undefined") setBaseUrl(`${window.location.origin}/v1`); }, []);

  useEffect(() => { if (keysQ.data) { setKeys(keysQ.data); setKeysLoading(false); } else if (keysQ.isLoading) setKeysLoading(true); }, [keysQ.data, keysQ.isLoading]);

  const handleCreateKey = async () => { if (!newKeyName.trim()) return; setCreating(true); try { const res = await createApiKey({ name: newKeyName.trim() }); setKeys((prev) => [res.key, ...prev]); setCreatedKey(res.key.key || ""); setNewKeyName(""); setShowAddModal(false); await qc.invalidateQueries({ queryKey: ["api-keys-endpoint"] }); } catch (error) { toast.error(getErrorMessage(error, "Failed to create key")); } finally { setCreating(false); } };
  const handleDeleteKey = (key: ApiKey) => {
    if (key.isDefault) { toast.info("The default key cannot be deleted. Revoke or rotate it instead."); return; }
    setConfirmState({ title: "Delete API key", message: `Permanently remove “${key.name}”? Any clients using it will stop working.`, confirmLabel: "Delete permanently", destructive: true, onConfirm: async () => { setConfirmState(null); try { await deleteApiKeyPermanent(key.id); setKeys((prev) => prev.filter((item) => item.id !== key.id)); } catch (error) { toast.error(getErrorMessage(error, "Failed to delete key")); } } });
  };
  const handlePauseKey = (key: ApiKey) => setConfirmState({ title: key.isActive ? "Revoke API key" : "Restore API key", message: key.isActive ? `Revoke “${key.name}”? Requests using this key will be rejected, but the key can be restored later.` : `Restore “${key.name}”? Requests using this key will be accepted again.`, confirmLabel: key.isActive ? "Revoke key" : "Restore key", destructive: key.isActive, onConfirm: async () => { setConfirmState(null); const isActive = !key.isActive; try { await updateApiKey(key.id, { isActive }); setKeys((prev) => prev.map((item) => item.id === key.id ? { ...item, isActive } : item)); } catch (error) { toast.error(getErrorMessage(error, "Failed to update key")); } } });
  const handleRotateKey = (key: ApiKey) => setConfirmState({ title: "Rotate API key", message: `Generate a new secret for “${key.name}”? The old secret will stop working immediately while the key identity stays the same.`, confirmLabel: "Rotate secret", destructive: true, onConfirm: async () => { setConfirmState(null); setRotatingKeyId(key.id); try { const rotated = await rotateApiKey(key.id); setKeys((prev) => prev.map((item) => item.id === key.id ? rotated : item)); setRevealedKeys((prev) => { const next = { ...prev }; delete next[key.id]; return next; }); setVisibleKeys((prev) => { const next = new Set(prev); next.delete(key.id); return next; }); setCreatedKey(rotated.key || ""); await qc.invalidateQueries({ queryKey: ["api-keys-endpoint"] }); toast.success("Key rotated — replace the old secret in your clients."); } catch (error) { toast.error(getErrorMessage(error, "Failed to rotate key")); } finally { setRotatingKeyId(null); } } });
  const loadRawKey = async (key: ApiKey) => { const raw = await getApiKeyRaw(key.id); if (!raw) throw new Error("This key has no stored secret."); setRevealedKeys((prev) => ({ ...prev, [key.id]: raw })); return raw; };
  const handleRevealKey = async (key: ApiKey) => { if (revealedKeys[key.id]) { setVisibleKeys((prev) => new Set(prev).add(key.id)); return; } try { await loadRawKey(key); setVisibleKeys((prev) => new Set(prev).add(key.id)); } catch (error) { toast.error(getErrorMessage(error, "Failed to reveal key")); } };
  const handleCopyKey = async (key: ApiKey) => { setCopyingKeyId(key.id); try { await navigator.clipboard.writeText(revealedKeys[key.id] || await loadRawKey(key)); setCopiedKeyId(key.id); window.setTimeout(() => setCopiedKeyId(null), 1500); } catch (error) { toast.error(getErrorMessage(error, "Failed to copy key")); } finally { setCopyingKeyId(null); } };

  return <div className="space-y-5">
    <Header title="API Keys" actions={keys.length > 0 ? <RippleButton onClick={() => setShowAddModal(true)}><Plus className="h-4 w-4" />Create key</RippleButton> : null} />

    <Frame className="w-full">
      <FrameHeader className="px-3 py-3 sm:px-5 sm:py-4">
        <FrameTitle>Manage API Keys</FrameTitle>
      </FrameHeader>
      <FramePanel className="p-0">
        <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
          <div className="min-w-0"><p className="text-sm font-semibold">Base URL</p></div>
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 sm:px-3 sm:py-2"><code className="min-w-0 flex-1 truncate font-mono text-[11px] sm:text-xs">{baseUrl}</code><Tooltip label="Copy gateway URL"><button type="button" onClick={() => void navigator.clipboard.writeText(baseUrl)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-primary" aria-label="Copy gateway URL"><Copy className="h-3.5 w-3.5" /></button></Tooltip></div>
        </div>
        <Separator />
        <div className="p-3 sm:p-5">
          <div className="min-w-0"><p className="text-sm font-semibold">List API Keys</p></div>
          <div className="mt-3 sm:mt-4">{keysLoading ? <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-xl sm:h-20" />)}</div> : keys.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center sm:px-5 sm:py-10"><p className="text-sm font-medium">No API keys yet</p><p className="mt-1 text-xs text-muted-foreground sm:text-sm">Create an API key to connect your AI tools to this gateway.</p><RippleButton className="mt-4" size="sm" onClick={() => setShowAddModal(true)}>Create first key</RippleButton></div> : <div className="space-y-1.5 sm:space-y-2">{keys.map((key) => { const paused = key.isActive === false; const visible = visibleKeys.has(key.id); return <div key={key.id} className={cn("rounded-lg border border-border bg-surface p-2.5 sm:p-3", paused && "opacity-65")}><div className="flex items-start justify-between gap-2.5 sm:gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5 sm:gap-2"><p className="truncate text-xs font-medium sm:text-sm">{key.name}</p>{key.isDefault ? <StatusBadge tone="muted" className="text-[10px] sm:text-xs">Default</StatusBadge> : null}<StatusBadge tone={paused ? "warn" : "ok"} className="text-[10px] sm:text-xs">{paused ? "Revoked" : "Active"}</StatusBadge></div><p className="mt-0.5 text-[10px] text-muted-foreground sm:mt-1 sm:text-xs">Created {new Date(key.createdAt || Date.now()).toLocaleDateString()}</p></div><div className="flex shrink-0 items-center gap-0.5 sm:gap-1"><FlipButton active={!paused} onToggle={() => handlePauseKey(key)} /><Tooltip label="Rotate secret"><button type="button" onClick={() => handleRotateKey(key)} disabled={rotatingKeyId === key.id} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-primary disabled:opacity-50 sm:p-2" aria-label="Rotate secret">{rotatingKeyId === key.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}</button></Tooltip>{!key.isDefault ? <Tooltip label="Delete key"><button type="button" onClick={() => handleDeleteKey(key)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:p-2" aria-label="Delete key"><Trash2 className="h-3.5 w-3.5" /></button></Tooltip> : null}</div></div><div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 sm:mt-3 sm:gap-2 sm:px-2.5 sm:py-1.5"><code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground sm:text-xs">{visible ? (revealedKeys[key.id] || key.key) : displayPrefix(key)}</code><Tooltip label={visible ? "Hide key" : "Show key"}><button type="button" onClick={() => visible ? setVisibleKeys((prev) => { const next = new Set(prev); next.delete(key.id); return next; }) : void handleRevealKey(key)} className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-primary sm:p-1.5" aria-label={visible ? "Hide key" : "Show key"}>{visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button></Tooltip><Tooltip label={copyingKeyId === key.id ? "Copying key" : copiedKeyId === key.id ? "Copied" : "Copy key"}><button type="button" onClick={() => void handleCopyKey(key)} disabled={copyingKeyId === key.id} className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-primary sm:p-1.5" aria-label="Copy key">{copyingKeyId === key.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : copiedKeyId === key.id ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}</button></Tooltip></div></div>; })}</div>}</div>
        </div>
      </FramePanel>
    </Frame>

    <Dialog open={showAddModal} onOpenChange={setShowAddModal}><DialogContent><DialogHeader className="pb-2"><DialogTitle>Create API key</DialogTitle></DialogHeader><div className="px-6 pb-2"><label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Key name</span><Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Production" autoFocus /></label></div><DialogFooter><RippleButton variant="outline" onClick={() => setShowAddModal(false)} disabled={creating}>Cancel</RippleButton><RippleButton onClick={() => void handleCreateKey()} disabled={!newKeyName.trim() || creating}>{creating ? "Creating…" : "Create"}</RippleButton></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!createdKey} onOpenChange={() => setCreatedKey(null)}><DialogContent><DialogHeader><DialogTitle>API key ready</DialogTitle><DialogDescription>Copy this secret now and update your clients. It is the current secret for this key.</DialogDescription></DialogHeader><div className="space-y-3 px-6 pb-2"><div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3"><code className="min-w-0 flex-1 break-all font-mono text-sm">{createdKey}</code><CopyButton value={createdKey || ""} label="" /></div></div><DialogFooter><RippleButton onClick={() => setCreatedKey(null)}>Done</RippleButton></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!confirmState} onOpenChange={(open) => !open && setConfirmState(null)}><DialogContent><DialogHeader><DialogTitle>{confirmState?.title || "Confirm"}</DialogTitle></DialogHeader><p className="px-6 pb-3 text-sm leading-relaxed text-muted-foreground">{confirmState?.message}</p><DialogFooter><RippleButton variant="outline" onClick={() => setConfirmState(null)}>Cancel</RippleButton><RippleButton variant={confirmState?.destructive ? "destructive" : "default"} onClick={() => confirmState?.onConfirm()}>{confirmState?.confirmLabel || "Confirm"}</RippleButton></DialogFooter></DialogContent></Dialog>
  </div>;
}
