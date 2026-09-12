import * as log from "../utils/logger.js";
import { getRefreshLeadMs } from "../../services/tokenRefresh.js";
import { getCredentialExpiryMs } from "../../services/oauthCredentialManager.js";

export const BACKGROUND_REFRESH_LEAD_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

let started = false;
let intervalHandle = null;
let initialTimeoutHandle = null;
let tickRunning = false;

function isTruthyEnv(value) {
  if (value == null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isNonServerRuntime() {
  if (typeof window !== "undefined") return true;
  const phase = process.env.NEXT_PHASE || "";
  if (
    phase === "phase-production-build" ||
    phase === "phase-export" ||
    phase === "phase-static"
  ) {
    return true;
  }

  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

export function selectConnectionsNeedingRefresh(connections, nowMs = Date.now()) {
  if (!Array.isArray(connections) || connections.length === 0) return [];

  const out = [];
  for (const conn of connections) {
    if (!conn) continue;

    const authType = String(conn.authType || "").toLowerCase().replace(/_/g, "");
    if (authType !== "oauth") continue;
    if (!conn.refreshToken) continue;

    const expiresAtMs = getCredentialExpiryMs(conn);
    if (expiresAtMs === null) continue;

    const providerLead = getRefreshLeadMs(conn.provider);
    const leadMs = Math.max(
      Number.isFinite(providerLead) ? providerLead : 0,
      BACKGROUND_REFRESH_LEAD_MS
    );

    if (expiresAtMs - nowMs < leadMs) {
      out.push(conn);
    }
  }
  return out;
}

async function loadActiveConnections() {

  const { getProviderConnections } = await import("../../lib/db/repos/connectionsRepo.js");
  return getProviderConnections({ isActive: true, authType: "oauth" });
}

async function refreshOne(connection) {
  const { checkAndRefreshToken } = await import("./tokenRefresh.js");
  return checkAndRefreshToken(connection.provider, connection, { force: true });
}

export async function runBackgroundTokenRefreshTick(deps = {}) {
  if (tickRunning) {
    log.debug("BG_TOKEN_REFRESH", "Tick already running, skip");
    return;
  }
  tickRunning = true;
  try {
    const load = deps.loadConnections || loadActiveConnections;
    const refresh = deps.refreshConnection || refreshOne;

    const connections = await load();
    const due = selectConnectionsNeedingRefresh(connections, Date.now());

    if (due.length === 0) {
      log.debug("BG_TOKEN_REFRESH", "No connections due for refresh", {
        active: Array.isArray(connections) ? connections.length : 0,
      });
      return;
    }

    log.info("BG_TOKEN_REFRESH", "Refreshing due OAuth connections", {
      due: due.length,
      ids: due.map((c) => c.id).filter(Boolean),
    });

    await Promise.allSettled(
      due.map(async (conn) => {
        try {
          await refresh(conn);
          log.info("BG_TOKEN_REFRESH", "Connection refresh finished", {
            id: conn.id,
            provider: conn.provider,
          });
        } catch (err) {
          log.warn("BG_TOKEN_REFRESH", "Connection refresh failed (swallowed)", {
            id: conn?.id,
            provider: conn?.provider,
            error: err?.message ?? String(err),
          });
        }
      })
    );
  } catch (err) {
    log.warn("BG_TOKEN_REFRESH", "Tick failed (swallowed)", {
      error: err?.message ?? String(err),
    });
  } finally {
    tickRunning = false;
  }
}

export function startBackgroundTokenRefresh({ intervalMs } = {}) {
  if (started) return false;
  if (isTruthyEnv(process.env.DISABLE_BACKGROUND_TOKEN_REFRESH)) {
    log.info("BG_TOKEN_REFRESH", "Disabled via DISABLE_BACKGROUND_TOKEN_REFRESH");
    return false;
  }
  if (isNonServerRuntime()) {
    log.debug("BG_TOKEN_REFRESH", "Skip start outside long-running server runtime");
    return false;
  }

  started = true;
  const period = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;

  const safeTick = () => {
    runBackgroundTokenRefreshTick().catch((err) => {
      log.warn("BG_TOKEN_REFRESH", "Unhandled tick rejection (swallowed)", {
        error: err?.message ?? String(err),
      });
    });
  };

  initialTimeoutHandle = setTimeout(safeTick, INITIAL_DELAY_MS);
  if (initialTimeoutHandle.unref) initialTimeoutHandle.unref();

  intervalHandle = setInterval(safeTick, period);
  if (intervalHandle.unref) intervalHandle.unref();

  log.info("BG_TOKEN_REFRESH", "Scheduler started", {
    intervalMs: period,
    initialDelayMs: INITIAL_DELAY_MS,
    leadMs: BACKGROUND_REFRESH_LEAD_MS,
  });
  return true;
}

export function stopBackgroundTokenRefresh() {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (started) {
    started = false;
    log.info("BG_TOKEN_REFRESH", "Scheduler stopped");
  }
}
