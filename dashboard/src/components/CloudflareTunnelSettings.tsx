import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Copy, Loader2, Power } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { FlipButton } from "@/components/animate/flip-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { Frame, FrameHeader, FramePanel } from "@/components/ui/frame";
import { getErrorMessage } from "@/lib/api";
import { probeEnabled } from "@/lib/live-mode";
import { fetchSettings, updateSettings } from "@/lib/settings-api";
import {
  clientPingAny,
  disableTunnel,
  enableTunnel,
  fetchTunnelStatus,
  type TunnelStatusResponse,
} from "@/lib/tunnel-api";
import { toast } from "@/components/ui/toast";

const TUNNEL_PING_INTERVAL_MS = 2000;
const TUNNEL_PING_MAX_MS = 300_000;
const STATUS_POLL_FAST_MS = 5000;
const REACHABLE_MISS_THRESHOLD = 5;
const CLIENT_PING_FAST_MS = 10_000;

type StatusNote = { type: "error" | "success" | "warning"; message: string };
type SetupStep = "provisioning" | "connecting" | "verifying";
type SetupState = "loading" | "ready" | "error";

const SETUP_STEPS: Array<{ key: SetupStep; label: string; description: string }> = [
  { key: "provisioning", label: "Prepare cloudflared", description: "Download or reuse the tunnel client." },
  { key: "connecting", label: "Start tunnel", description: "Create the tunnel and register its route." },
  { key: "verifying", label: "Verify reachability", description: "Check that the public endpoint responds." },
];

type Props = {
  requireApiKey: boolean;
  requireLogin: boolean;
  hasPassword: boolean;
};

function TunnelSetupDialog({
  open,
  loading,
  state,
  step,
  message,
  error,
  onOpenChange,
}: {
  open: boolean;
  loading: boolean;
  state: SetupState;
  step: SetupStep;
  message: string;
  error: string;
  onOpenChange: (open: boolean) => void;
}) {
  const activeIndex = SETUP_STEPS.findIndex((item) => item.key === step);
  const title = state === "ready"
    ? "Cloudflare Tunnel ready"
    : state === "error"
      ? "Tunnel setup needs attention"
      : "Creating Cloudflare Tunnel";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!loading) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {loading
              ? "Keep this window open while the tunnel is being prepared."
              : state === "ready"
                ? "The public endpoint is online and ready to use."
                : "The tunnel could not finish setup. You can close this dialog and try again."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-3" aria-live="polite">
            {SETUP_STEPS.map((item, index) => {
              const complete = state === "ready" || index < activeIndex;
              const failed = state === "error" && index === activeIndex;
              const current = loading && index === activeIndex;

              return (
                <div key={item.key} className="flex gap-3">
                  <div
                    className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                      complete
                        ? "border-success/40 bg-success/12 text-success"
                        : failed
                          ? "border-destructive/40 bg-destructive/12 text-destructive"
                          : current
                            ? "border-primary/50 bg-primary/12 text-primary"
                            : "border-border bg-surface text-muted-foreground"
                    }`}
                  >
                    {complete ? (
                      <Check className="size-4" />
                    ) : failed ? (
                      <CircleAlert className="size-4" />
                    ) : current ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-current opacity-60" />
                    )}
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {failed ? error : current ? message : item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 text-xs transition-colors duration-150 ${
              state === "error"
                ? "border-destructive/25 bg-destructive/8 text-destructive-foreground"
                : state === "ready"
                  ? "border-success/25 bg-success/8 text-success"
                  : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {state === "error" ? error : message}
          </div>
        </DialogPanel>
        {!loading ? (
          <DialogFooter>
            <RippleButton type="button" onClick={() => onOpenChange(false)}>
              {state === "ready" ? "Done" : "Close"}
            </RippleButton>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CloudflareTunnelSettings({ requireApiKey, requireLogin, hasPassword }: Props) {
  const qc = useQueryClient();
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(true);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState<StatusNote | null>(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showTunnelSetupModal, setShowTunnelSetupModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);
  const [setupState, setSetupState] = useState<SetupState>("loading");
  const [setupStep, setSetupStep] = useState<SetupStep>("provisioning");
  const [setupMessage, setSetupMessage] = useState("");
  const [setupError, setSetupError] = useState("");
  const [copiedTunnelUrl, setCopiedTunnelUrl] = useState(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const tunnelMissRef = useRef(0);
  const tunnelEverReachableRef = useRef(false);
  const tunnelQ = useQuery({ queryKey: ["tunnel-status"], queryFn: fetchTunnelStatus, enabled: probeEnabled(), retry: false });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings, enabled: probeEnabled(), retry: false });

  const syncTunnelStatus = useCallback((data: TunnelStatusResponse) => {
    const enabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
    setTunnelUrl(data.tunnel?.tunnelUrl || "");
    setTunnelPublicUrl(data.tunnel?.publicUrl || "");
    setTunnelEnabled(enabled);
  }, []);

  useEffect(() => {
    if (!tunnelQ.data) {
      setTunnelChecking(!tunnelQ.isError);
      return;
    }
    syncTunnelStatus(tunnelQ.data);
    setTunnelChecking(false);
  }, [tunnelQ.data, tunnelQ.isError, syncTunnelStatus]);

  useEffect(() => {
    if (settingsQ.data?.tunnelDashboardAccess !== undefined) {
      setTunnelDashboardAccess(settingsQ.data.tunnelDashboardAccess !== false);
    }
  }, [settingsQ.data]);

  useEffect(() => {
    if (!tunnelEnabled) return;
    const onVisible = () => { if (!document.hidden) void qc.invalidateQueries({ queryKey: ["tunnel-status"] }); };
    document.addEventListener("visibilitychange", onVisible);
    if (tunnelReachable) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) void qc.invalidateQueries({ queryKey: ["tunnel-status"] }); }, STATUS_POLL_FAST_MS);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [tunnelEnabled, tunnelReachable, qc]);

  useEffect(() => {
    const probeTunnel = async () => {
      if (document.hidden || !tunnelEnabled || (!tunnelUrl && !tunnelPublicUrl)) return;
      const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
      if (ok) {
        tunnelMissRef.current = 0;
        setTunnelReachable(true);
        if (!tunnelEverReachableRef.current) {
          tunnelEverReachableRef.current = true;
          setTunnelEverReachable(true);
        }
      } else {
        tunnelMissRef.current += 1;
        if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false);
      }
    };
    if (!tunnelEnabled || (!tunnelUrl && !tunnelPublicUrl)) return;
    void probeTunnel();
    if (tunnelReachable) return;
    const id = setInterval(() => void probeTunnel(), CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tunnelReachable]);

  const setSetting = async (key: string, value: unknown) => {
    try {
      await updateSettings({ [key]: value });
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to update ${key}`));
      return false;
    }
  };

  const handleTunnelDashboardAccess = async (value: boolean) => {
    if (await setSetting("tunnelDashboardAccess", value)) setTunnelDashboardAccess(value);
  };

  const pingTunnelHealth = async (...urls: Array<string | undefined>) => {
    setSetupStep("verifying");
    setSetupMessage("Checking the public endpoint…");
    const targets = urls.filter(Boolean).map((url) => url!);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((resolve) => setTimeout(resolve, TUNNEL_PING_INTERVAL_MS));
      if (await clientPingAny(...targets)) {
        setTunnelEnabled(true);
        setTunnelReachable(true);
        setSetupMessage("Public endpoint is responding.");
        return true;
      }
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          if (!(await fetchTunnelStatus()).tunnel?.enabled) {
            const message = "The tunnel process stopped unexpectedly.";
            setTunnelStatus({ type: "error", message });
            setSetupMessage(message);
            return false;
          }
        } catch {
          // Keep polling while the tunnel is still starting.
        }
      }
    }
    const message = "Tunnel created but the public endpoint is not reachable yet.";
    setTunnelStatus({ type: "error", message });
    setSetupMessage(message);
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setShowTunnelSetupModal(true);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setSetupState("loading");
    setSetupStep("provisioning");
    setSetupMessage("Preparing cloudflared…");
    setSetupError("");
    setTunnelProgress("Creating tunnel…");

    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const status = await fetchTunnelStatus();
          if (!polling) return;
          if (status.download?.downloading) {
            const progress = Math.max(0, Math.min(100, status.download.progress || 0));
            const message = `Downloading cloudflared… ${progress}%`;
            setSetupMessage(message);
            setTunnelProgress(message);
          } else {
            setSetupMessage("Creating tunnel…");
            setTunnelProgress("Creating tunnel…");
          }
        } catch {
          // The primary enable request owns the failure state.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };
    void pollProgress();

    try {
      const result = await enableTunnel();
      polling = false;
      if (!result.success) {
        const message = result.error || "Failed to create tunnel.";
        setSetupState("error");
        setSetupError(message);
        setSetupMessage(message);
        setTunnelStatus({ type: "error", message });
        return;
      }

      setSetupStep("connecting");
      setSetupMessage("Starting the tunnel connection…");
      setTunnelProgress("Starting tunnel connection…");
      if (!result.tunnelUrl) {
        const message = "No tunnel URL was returned.";
        setSetupState("error");
        setSetupError(message);
        setSetupMessage(message);
        setTunnelStatus({ type: "error", message });
        return;
      }

      setTunnelUrl(result.tunnelUrl);
      setTunnelPublicUrl(result.publicUrl || "");
      const reachable = await pingTunnelHealth(result.publicUrl, result.tunnelUrl);
      if (!reachable) {
        setSetupState("error");
        setSetupError("Tunnel created, but its public endpoint could not be verified.");
        return;
      }

      setSetupState("ready");
      setSetupMessage("Tunnel is online and ready to use.");
    } catch (error) {
      const message = getErrorMessage(error, "Failed to enable tunnel");
      setSetupState("error");
      setSetupError(message);
      setSetupMessage(message);
      setTunnelStatus({ type: "error", message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const result = await disableTunnel();
      if (result.success) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setTunnelPublicUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: result.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: getErrorMessage(error, "Failed to disable tunnel") });
    } finally {
      setTunnelLoading(false);
    }
  };

  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? 'Enable "Require login" and set a custom password first.'
    : "Set a custom dashboard password first.";
  const statusText = tunnelChecking
    ? "Checking tunnel status…"
    : tunnelEnabled && tunnelLoading
      ? tunnelProgress || "Working…"
      : tunnelEnabled && tunnelReachable
        ? "Active"
        : tunnelEnabled
          ? (tunnelEverReachable ? "Tunnel reconnecting…" : "Tunnel checking…")
          : "Tunnel is disabled";

  const copyTunnelUrl = async () => {
    const url = `${tunnelPublicUrl || tunnelUrl}/v1`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTunnelUrl(true);
      window.setTimeout(() => setCopiedTunnelUrl(false), 1500);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to copy tunnel URL"));
    }
  };

  return (
    <>
      <Frame>
        <FrameHeader className="flex flex-row items-center gap-3 p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-transparent">
            <img src="/providers/cloudflare-ai.svg" alt="" aria-hidden="true" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
          </div>
          <div><p className="text-sm font-medium">Cloudflare Tunnel</p></div>
        </FrameHeader>
        <FramePanel className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Tunnel status</p>
              <p className="text-xs text-muted-foreground">{statusText}</p>
            </div>
            {tunnelEnabled && tunnelReachable
              ? <span className="size-2 shrink-0 rounded-full bg-success" />
              : <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />}
          </div>
          {tunnelEnabled && (tunnelPublicUrl || tunnelUrl) ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{`${tunnelPublicUrl || tunnelUrl}/v1`}</code>
              <Tooltip label={copiedTunnelUrl ? "Copied" : "Copy URL"}>
                <button type="button" onClick={() => void copyTunnelUrl()} className="rounded-md p-1.5 text-muted-foreground transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-hover hover:text-primary active:scale-[0.96]" aria-label={copiedTunnelUrl ? "URL copied" : "Copy URL"}>
                  <span className="relative block size-3.5" aria-hidden="true">
                    <Copy className={`absolute inset-0 size-3.5 transition-[opacity,scale,filter] duration-150 ease-out ${copiedTunnelUrl ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0"}`} />
                    <Check className={`absolute inset-0 size-3.5 text-success transition-[opacity,scale,filter] duration-150 ease-out ${copiedTunnelUrl ? "scale-100 opacity-100 blur-0" : "scale-25 opacity-0 blur-[4px]"}`} />
                  </span>
                </button>
              </Tooltip>
              <Tooltip label="Disable tunnel">
                <button type="button" onClick={() => setShowDisableTunnelModal(true)} className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive" aria-label="Disable tunnel">
                  <Power className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          ) : null}
          {isLoginUnsafe && !tunnelEnabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0" /><p>{unsafeReason}</p>
            </div>
          ) : null}
          {tunnelEnabled && (!requireApiKey || isLoginUnsafe) ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0" /><p>{!requireApiKey ? "Require API key is disabled — your endpoint is publicly accessible." : unsafeReason}</p>
            </div>
          ) : null}
          {tunnelStatus && tunnelStatus.type !== "success" ? (
            <p className={`text-xs ${tunnelStatus.type === "warning" ? "text-warning" : "text-destructive"}`}>
              {tunnelStatus.message}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm font-medium">Tunnel access</p>
            {tunnelEnabled ? (
              <FlipButton active={tunnelDashboardAccess} onToggle={() => void handleTunnelDashboardAccess(!tunnelDashboardAccess)} activeLabel="" inactiveLabel="" />
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  if (isLoginUnsafe || !requireApiKey) {
                    setTunnelStatus({ type: "error", message: isLoginUnsafe ? unsafeReason : 'Enable "Require API key" before activating the tunnel.' });
                    return;
                  }
                  setShowEnableTunnelModal(true);
                }}
                disabled={tunnelLoading}
              >
                {tunnelLoading ? <><Loader2 className="h-4 w-4 animate-spin" />{tunnelProgress || "Working…"}</> : "Enable"}
              </Button>
            )}
          </div>
        </FramePanel>
      </Frame>

      <Dialog open={showEnableTunnelModal} onOpenChange={setShowEnableTunnelModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable Tunnel</DialogTitle>
            <DialogDescription>Creates a temporary public URL for this router.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton onClick={() => void handleEnableTunnel()}>Start Tunnel</RippleButton>
            <RippleButton variant="outline" onClick={() => setShowEnableTunnelModal(false)}>Cancel</RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TunnelSetupDialog
        open={showTunnelSetupModal}
        loading={tunnelLoading}
        state={setupState}
        step={setupStep}
        message={setupMessage}
        error={setupError}
        onOpenChange={setShowTunnelSetupModal}
      />

      <Dialog open={showDisableTunnelModal} onOpenChange={(open) => !tunnelLoading && setShowDisableTunnelModal(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Tunnel</DialogTitle>
            <DialogDescription>This will disconnect the public tunnel.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton variant="destructive" onClick={() => void handleDisableTunnel()} disabled={tunnelLoading}>{tunnelLoading ? "Disabling…" : "Disable"}</RippleButton>
            <RippleButton variant="outline" onClick={() => setShowDisableTunnelModal(false)} disabled={tunnelLoading}>Cancel</RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
