import os from "os";
import { cleanupProviderConnections, getApiKeys, getSettings } from "@/lib/localDb";
import {
  enableTunnel,
  isTunnelManuallyDisabled, isTunnelReconnecting,
  getTunnelService, setTunnelUnexpectedExitCallback,
  killCloudflared, isCloudflaredRunning, ensureCloudflared,
  checkInternet,
  RESTART_COOLDOWN_MS, NETWORK_SETTLE_MS,
  WATCHDOG_INTERVAL_MS, NETWORK_CHECK_INTERVAL_MS, VIRTUAL_IFACE_REGEX,
} from "@/lib/tunnel";
import { killAllBridges } from "@/lib/mcp/stdioSseBridge";

process.setMaxListeners(20);

const STARTUP_DEFER_MS = 3000;

let startupPromise = null;

const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
  watchdogInterval: null,
  networkMonitorInterval: null,
  lastNetworkFingerprint: null,
  lastWatchdogTick: Date.now(),
  lastOnline: null,
  tunnelAutoResumed: false,
};

export async function initializeApp() {
  if (startupPromise) return startupPromise;

  startupPromise = new Promise((resolve, reject) => {
    try {
      setTunnelUnexpectedExitCallback(() => {
        safeRestartTunnel("unexpected-exit").catch(() => {});
      });

      setTimeout(() => {
        runHeavyStartup().then(resolve, (error) => {
          console.error("[InitApp] deferred startup failed:", error);
          reject(error);
        });
      }, STARTUP_DEFER_MS);
    } catch (error) {
      console.error("[InitApp] Error:", error);
      reject(error);
    }
  });

  return startupPromise;
}

export function resetStartupForTests() {
  startupPromise = null;
}

export { STARTUP_DEFER_MS };

async function runHeavyStartup() {

  await getApiKeys();
  await cleanupProviderConnections();
  const settings = await getSettings();

  if (settings.tunnelEnabled && !g.tunnelAutoResumed) {
    g.tunnelAutoResumed = true;
    console.log("[InitApp] Tunnel was enabled, auto-resuming...");
    safeRestartTunnel("startup").catch((e) => console.log("[InitApp] Tunnel resume failed:", e.message));
  }

  if (settings.tunnelEnabled) ensureCloudflared().catch(() => {});

  configureTunnelMonitoring(settings);

  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((e) => console.log("[AutoPing] scheduler start failed:", e.message));
  }

  import("@/sse/services/backgroundTokenRefresh.js")
    .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
    .catch((e) => console.log("[BackgroundTokenRefresh] scheduler start failed:", e.message));
}

function hasQuotaAutoPingEnabled(settings) {
  return [settings?.claudeAutoPing, settings?.codexAutoPing]
    .some((config) => Object.values(config?.connections || {}).some(Boolean));
}

const FORCE_RESTART_REASONS = /^(startup|netchange|sleep|sleep\+netchange|online|unexpected-exit)$/;

async function safeRestartTunnel(reason) {
  const svc = getTunnelService();
  const settings = await getSettings();
  if (!settings.tunnelEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;

  const force = FORCE_RESTART_REASONS.test(reason);

  if (isCloudflaredRunning()) return;

  if (!force && Date.now() - svc.lastRestartAt < RESTART_COOLDOWN_MS) {
    console.log(`[Tunnel] degraded but cooldown active, skip (${reason})`);
    return;
  }
  if (!await checkInternet()) return;

  console.log(`[Tunnel] safeRestart (${reason}) — tunnel unreachable${force ? " [force]" : ""}`);
  try {
    await enableTunnel();
    svc.lastRestartAt = Date.now();
    console.log("[Tunnel] restart success");
  } catch (err) {
    if (!/cloudflared killed|tunnel cancelled/.test(err.message)) {
      console.log("[Tunnel] restart failed:", err.message);
    }
  }
}

function startWatchdog() {
  if (g.watchdogInterval) return;
  g.watchdogInterval = setInterval(() => {
    safeRestartTunnel("watchdog").catch(() => {});
  }, WATCHDOG_INTERVAL_MS);
  if (g.watchdogInterval.unref) g.watchdogInterval.unref();
}

function stopWatchdog() {
  if (!g.watchdogInterval) return;
  clearInterval(g.watchdogInterval);
  g.watchdogInterval = null;
}

function getNetworkFingerprint() {
  const interfaces = os.networkInterfaces();
  const active = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    if (VIRTUAL_IFACE_REGEX.test(name)) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        active.push(`${name}:${addr.address}`);
      }
    }
  }
  return active.sort().join("|");
}

function startNetworkMonitor() {
  if (g.networkMonitorInterval) return;

  g.lastNetworkFingerprint = getNetworkFingerprint();
  g.lastWatchdogTick = Date.now();
  g.lastOnline = null;

  g.networkMonitorInterval = setInterval(async () => {
    try {
      const now = Date.now();
      const elapsed = now - g.lastWatchdogTick;
      g.lastWatchdogTick = now;

      const currentFingerprint = getNetworkFingerprint();
      const networkChanged = currentFingerprint !== g.lastNetworkFingerprint;
      const wasSleep = elapsed > NETWORK_CHECK_INTERVAL_MS * 6;
      if (networkChanged) g.lastNetworkFingerprint = currentFingerprint;

      const online = await checkInternet();
      const wasOffline = g.lastOnline === false;
      g.lastOnline = online;

      if (!online) return;

      const onlineEdge = wasOffline;
      if (!networkChanged && !wasSleep && !onlineEdge) return;

      await new Promise((r) => setTimeout(r, NETWORK_SETTLE_MS));

      const reason = onlineEdge ? "online"
        : wasSleep && networkChanged ? "sleep+netchange"
        : wasSleep ? "sleep" : "netchange";
      safeRestartTunnel(reason).catch(() => {});
    } catch (err) {
      console.log("[NetworkMonitor] error:", err.message);
    }
  }, NETWORK_CHECK_INTERVAL_MS);

  if (g.networkMonitorInterval.unref) g.networkMonitorInterval.unref();
}

function stopNetworkMonitor() {
  if (!g.networkMonitorInterval) return;
  clearInterval(g.networkMonitorInterval);
  g.networkMonitorInterval = null;
  g.lastNetworkFingerprint = null;
  g.lastOnline = null;
}

export function configureTunnelMonitoring(settings) {
  if (settings?.tunnelEnabled) {
    startWatchdog();
    startNetworkMonitor();
    return;
  }
  stopWatchdog();
  stopNetworkMonitor();
}

export async function shutdownApp() {
  stopWatchdog();
  stopNetworkMonitor();
  try { killAllBridges(); } catch {                   }
  try { killCloudflared(); } catch {                   }
  try {
    const { stopQuotaAutoPing } = await import("./quotaAutoPing.js");
    stopQuotaAutoPing();
  } catch {                                                   }
  try {
    const { stopCacheCleanup } = await import("@/services/projectId.js");
    stopCacheCleanup();
  } catch {                                                            }
}

export default initializeApp;
