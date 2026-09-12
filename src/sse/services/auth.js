import { getProviderConnectionById, getProviderConnectionsForRouting, validateApiKey, updateProviderConnection, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import {
  formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate,
  getEarliestModelLockUntil,

  isDeprioritized, sortWithDeprioritization, pickCacheAffine,
  DEPRIORITIZE_FIELD,
} from "../../services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS, classifyError, ERROR_TIERS } from "../../config/errorConfig.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { recordLock, clearLock, clearAllLocksForConnection } from "@/lib/db/repos/accountModelLocksRepo.js";
import { accountFallbackDecisionsTotal, cacheAffineSelectionsTotal } from "@/observability/metrics.js";
import { resolveProviderId, NO_AUTH_PROVIDERS } from "@/providers/display.js";
import {
  getCachedProviderConnections,
  invalidateProviderAccountPool,
  pickLeastInflightConnection,
  rankConnectionsByInflight,
  resolveAccountPoolConfig,
  tryAcquireAccountSlot,
  waitForAccountCapacity,
} from "../../services/accountPool.js";
import * as log from "../utils/logger.js";

function deriveCacheKey(options) {
  const body = options?.cacheKey ?? options?.promptPrefix;
  if (typeof body === "string" && body.length > 0) return body.slice(0, 256);
  return null;
}

let selectionMutex = Promise.resolve();

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {

  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;

  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });
  let mutexReleased = false;
  const releaseSelectionMutex = () => {
    if (mutexReleased) return;
    mutexReleased = true;
    resolveMutex?.();
  };

  try {
    await currentMutex;

    const providerId = resolveProviderId(provider);

    if (NO_AUTH_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
      }
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          proxyPoolUnavailable: resolvedProxy.proxyPoolUnavailable === true,
          proxyPoolError: resolvedProxy.proxyPoolError || "",
          relayUrl: resolvedProxy.relayUrl || "",
          relayToken: resolvedProxy.relayToken || "",
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    }

    const settings = await getSettings();

    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";
    const poolConfig = resolveAccountPoolConfig(settings, providerOverride);

    const connections = strategy === "round-robin" || strategy === "cache-affine"
      ? await getProviderConnectionsForRouting({ provider: providerId, isActive: true })
      : await getCachedProviderConnections(
        providerId,
        () => getProviderConnectionsForRouting({ provider: providerId, isActive: true }),
        poolConfig.cacheTtlMs,
      );
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {

      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const rankedConnections = sortWithDeprioritization(availableConnections);

    let connection;

    if (preferredConnectionId) {
      connection = rankedConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection && preferredConnectionId) {

    } else if (strategy === "cache-affine") {

      const cacheKey = deriveCacheKey(options);
      const { connection: picked, affinity } = pickCacheAffine(rankedConnections, {
        cacheKey,
        excludeIds: excludeSet,
      });
      connection = picked || null;
      try { cacheAffineSelectionsTotal.inc({ result: affinity || "miss" }); } catch {}
      if (connection && cacheKey) {
        log.debug("AUTH", `${provider} | cache-affine(${affinity}) → ${connection.id?.slice(0, 8)}`);
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      }
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 1;

      const byRecency = [...rankedConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {

        connection = current;

        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {

        const sortedByOldest = [...rankedConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        });
      }
    } else if (strategy === "least-inflight") {

      connection = pickLeastInflightConnection(rankedConnections);
    } else {

      connection = rankedConnections[0];
    }

    let candidateConnections = preferredConnectionId && connection
      ? [connection]
      : [connection, ...(strategy === "least-inflight" ? [] : rankedConnections)]
        .filter(Boolean)
        .filter((candidate, index, list) => list.findIndex((item) => item.id === candidate.id) === index);
    const candidateIds = availableConnections.map((candidate) => candidate.id);
    const waitCandidateIds = preferredConnectionId && connection ? [connection.id] : candidateIds;

    let selectedConnection = null;
    let releaseAccountSlot = null;
    let sawStaleConnection = false;
    let expandedLeastInflightFallback = strategy !== "least-inflight" || Boolean(preferredConnectionId);
    let candidateIndex = 0;
    while (candidateIndex < candidateConnections.length) {
      const candidate = candidateConnections[candidateIndex];
      const release = tryAcquireAccountSlot(providerId, candidate.id, poolConfig);
      if (release) {

        let liveConnection;
        try {
          liveConnection = await getProviderConnectionById(candidate.id);
        } catch (error) {
          release();
          throw error;
        }
        if (!liveConnection || liveConnection.provider !== providerId || liveConnection.isActive !== true || isModelLockActive(liveConnection, model)) {
          sawStaleConnection = true;
          release();
        } else {
          selectedConnection = liveConnection;
          releaseAccountSlot = release;
          break;
        }
      }

      candidateIndex += 1;

      if (
        strategy === "least-inflight"
        && candidateIndex >= candidateConnections.length
        && !expandedLeastInflightFallback
      ) {
        expandedLeastInflightFallback = true;
        const selectedId = candidateConnections[0]?.id;
        candidateConnections = [
          ...candidateConnections,
          ...rankConnectionsByInflight(rankedConnections).filter((item) => item.id !== selectedId),
        ];
      }
    }

    if (!selectedConnection) {

      if (sawStaleConnection && !options._accountPoolRefreshed) {
        invalidateProviderAccountPool(providerId);
        releaseSelectionMutex();
        return getProviderCredentials(provider, excludeSet, model, {
          ...options,
          _accountPoolRefreshed: true,
        });
      }

      releaseSelectionMutex();
      const queueDeadlineAt = Number(options._accountQueueDeadlineAt) || (Date.now() + poolConfig.queueWaitTimeoutMs);
      const remainingWaitMs = Math.max(0, queueDeadlineAt - Date.now());
      if (poolConfig.enabled && candidateIds.length > 0 && remainingWaitMs > 0) {
        const waitResult = await waitForAccountCapacity(
          providerId,
          preferredConnectionId ? waitCandidateIds : null,
          { ...poolConfig, queueWaitTimeoutMs: remainingWaitMs },
          options.signal || null,
        );
        if (waitResult.ok) {
          return getProviderCredentials(provider, excludeSet, model, {
            ...options,
            _accountQueueDeadlineAt: queueDeadlineAt,
          });
        }
        if (waitResult.reason === "aborted") {
          return { allBusy: true, reason: "aborted" };
        }
      }

      const retryAfter = new Date(Date.now() + 1000).toISOString();
      log.warn("AUTH", `${provider} | account pool busy (${candidateIds.length} candidates, queue=${poolConfig.maxQueuePerProvider})`);
      return {
        allBusy: true,
        retryAfter,
        retryAfterHuman: "account pool busy; retry shortly",
        lastErrorCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      };
    }

    releaseSelectionMutex();
    connection = selectedConnection;
    let resolvedProxy;
    try {
      resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    } catch (error) {
      releaseAccountSlot?.();
      throw error;
    }

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        strictProxy: resolvedProxy.strictProxy === true,
        proxyPoolUnavailable: resolvedProxy.proxyPoolUnavailable === true,
        proxyPoolError: resolvedProxy.proxyPoolError || "",
        relayUrl: resolvedProxy.relayUrl || "",
        relayToken: resolvedProxy.relayToken || "",
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,

      releaseAccountSlot,

      testStatus: connection.testStatus,
      lastError: connection.lastError,

      _connection: connection
    };
  } finally {
    releaseSelectionMutex();
  }
}

export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null, opts = {}) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const conn = await getProviderConnectionById(connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);

  let shouldFallback = true;
  let cooldownMs = 0;
  let tier = ERROR_TIERS.T2;
  let action = "retry-same";
  let deprioitizeUntilMs = null;
  if (githubResetAtMs) {
    cooldownMs = githubResetAtMs - Date.now();
    tier = ERROR_TIERS.T1;
    action = "cooldown";
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    tier = ERROR_TIERS.T1;
    action = "cooldown";
  } else {

    const retryCount = Number.isFinite(opts.retryCount) ? opts.retryCount : backoffLevel;
    const decision = classifyError(status, errorText, retryCount);
    ({ tier, action, cooldownMs, deprioitizeUntil: deprioitizeUntilMs } = decision);
    shouldFallback = action !== "retry-same" || cooldownMs > 0;
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(githubResetAtMs ? null : model, cooldownMs);

  const deprioUpdate = deprioitizeUntilMs ? { [DEPRIORITIZE_FIELD]: deprioitizeUntilMs } : {};

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    ...deprioUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: backoffLevel + 1
  });
  invalidateProviderAccountPool(provider);

  await recordLock(connectionId, githubResetAtMs ? null : model, {
    tier, reason, expiresAt: new Date(Date.now() + cooldownMs).toISOString(),
  }).catch(() => {});

  try { accountFallbackDecisionsTotal.inc({ tier, action }); } catch {}

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}][${tier}]`);

  if (provider && status && reason) {
    console.error(`[${provider}] ERROR ${status}: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0 && !conn[DEPRIORITIZE_FIELD]) return;

  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true;
    if (model && k === "modelLock___all") return true;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;
  });

  await clearLock(connectionId, model).catch(() => {});

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError && !conn[DEPRIORITIZE_FIELD]) return;

  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0,

      [DEPRIORITIZE_FIELD]: null,
    });
  }

  await updateProviderConnection(connectionId, clearObj);
  invalidateProviderAccountPool(conn.provider);
}

export function extractApiKey(request) {

  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
