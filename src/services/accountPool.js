import { deriveResourceProfile } from "@/lib/resourceProfile";

export const ACCOUNT_POOL_DEFAULTS = Object.freeze({
  maxConcurrentPerAccount: 30,
  maxConcurrentPerProvider: 64,
  maxQueuePerProvider: 1024,
  queueWaitTimeoutMs: 30_000,
  cacheTtlMs: 5_000,
});

const GLOBAL_STATE_KEY = "__swayAccountPoolState";

function createState() {
  return {
    accountLoads: new Map(),
    providerLoads: new Map(),
    providerQueues: new Map(),
    providerCache: new Map(),
  };
}

const state = globalThis[GLOBAL_STATE_KEY] ||= createState();
state.providerLoads ||= new Map();

function positiveInt(value, fallback, { min = 1, max = 1_000_000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) return fallback;
  return Math.min(Math.floor(number), max);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function deriveAutomaticProviderLimit() {
  try {
    const profile = deriveResourceProfile(undefined, process.env.SWAY_PERFORMANCE_PROFILE);
    const configuredRouterMax = positiveInt(
      process.env.SWAY_ROUTER_MAX_CONCURRENT,
      profile.maxConcurrent,
      { max: 100_000 },
    );
    return Math.max(1, Math.min(configuredRouterMax, profile.maxConcurrentPerProvider));
  } catch {
    return ACCOUNT_POOL_DEFAULTS.maxConcurrentPerProvider;
  }
}

const AUTOMATIC_MAX_CONCURRENT_PER_PROVIDER = deriveAutomaticProviderLimit();

export function resolveAccountPoolConfig(settings = {}, providerOverride = {}) {
  const globalPool = settings.accountPool || {};
  const providerPool = providerOverride.accountPool || {};
  const env = process.env;

  const enabled = firstDefined(
    providerPool.enabled,
    providerOverride.accountPoolEnabled,
    globalPool.enabled,
    settings.accountPoolEnabled,
    true,
  ) !== false;

  return {
    enabled,
    maxConcurrentPerAccount: positiveInt(
      firstDefined(
        providerPool.maxConcurrentPerAccount,
        providerOverride.maxConcurrentPerAccount,
        globalPool.maxConcurrentPerAccount,
        settings.maxConcurrentPerAccount,
        env.SWAY_MAX_CONCURRENT_PER_ACCOUNT,
        ACCOUNT_POOL_DEFAULTS.maxConcurrentPerAccount,
      ),
      ACCOUNT_POOL_DEFAULTS.maxConcurrentPerAccount,
      { max: 100_000 },
    ),
    maxConcurrentPerProvider: positiveInt(
      firstDefined(
        providerPool.maxConcurrentPerProvider,
        providerOverride.maxConcurrentPerProvider,
        globalPool.maxConcurrentPerProvider,
        settings.maxConcurrentPerProvider,
        env.SWAY_MAX_CONCURRENT_PER_PROVIDER,
        AUTOMATIC_MAX_CONCURRENT_PER_PROVIDER,
      ),
      AUTOMATIC_MAX_CONCURRENT_PER_PROVIDER,
      { max: 100_000 },
    ),
    maxQueuePerProvider: positiveInt(
      firstDefined(
        providerPool.maxQueuePerProvider,
        providerOverride.maxQueuePerProvider,
        globalPool.maxQueuePerProvider,
        settings.maxQueuePerProvider,
        env.SWAY_MAX_ACCOUNT_QUEUE,
        ACCOUNT_POOL_DEFAULTS.maxQueuePerProvider,
      ),
      ACCOUNT_POOL_DEFAULTS.maxQueuePerProvider,
      { max: 1_000_000 },
    ),
    queueWaitTimeoutMs: positiveInt(
      firstDefined(
        providerPool.queueWaitTimeoutMs,
        providerOverride.queueWaitTimeoutMs,
        globalPool.queueWaitTimeoutMs,
        settings.queueWaitTimeoutMs,
        env.SWAY_ACCOUNT_QUEUE_TIMEOUT_MS,
        ACCOUNT_POOL_DEFAULTS.queueWaitTimeoutMs,
      ),
      ACCOUNT_POOL_DEFAULTS.queueWaitTimeoutMs,
      { max: 10 * 60 * 1000 },
    ),
    cacheTtlMs: positiveInt(
      firstDefined(
        providerPool.cacheTtlMs,
        providerOverride.cacheTtlMs,
        globalPool.cacheTtlMs,
        settings.accountPoolCacheTtlMs,
        env.SWAY_ACCOUNT_POOL_CACHE_TTL_MS,
        ACCOUNT_POOL_DEFAULTS.cacheTtlMs,
      ),
      ACCOUNT_POOL_DEFAULTS.cacheTtlMs,
      { max: 5 * 60 * 1000 },
    ),
  };
}

function getAccountLoadEntry(connectionId, provider = null) {
  if (!connectionId) return null;
  let entry = state.accountLoads.get(connectionId);
  if (!entry) {
    entry = { provider, active: 0, lastAssignedAt: 0 };
    state.accountLoads.set(connectionId, entry);
  } else if (provider && !entry.provider) {
    entry.provider = provider;
  }
  return entry;
}

export function getAccountLoad(connectionId) {
  return state.accountLoads.get(connectionId)?.active || 0;
}

export function getProviderLoad(provider) {
  return state.providerLoads.get(provider)?.active || 0;
}

export function getAccountQueueLoad(connectionId) {
  const provider = state.accountLoads.get(connectionId)?.provider;
  if (!provider) return 0;
  const queue = state.providerQueues.get(provider);
  if (!queue) return 0;
  return [...queue.waiters].filter((waiter) => !waiter.connectionIds || waiter.connectionIds.has(connectionId)).length;
}

export function pickLeastInflightConnection(connections = []) {
  let best = null;
  let bestActive = Infinity;
  let bestLastAssigned = Infinity;
  let bestPriority = Infinity;

  for (const connection of connections) {
    const active = getAccountLoad(connection?.id);
    const lastAssigned = state.accountLoads.get(connection?.id)?.lastAssignedAt || 0;
    const priority = Number.isFinite(Number(connection?.priority)) ? Number(connection.priority) : 999;
    if (
      active < bestActive
      || (active === bestActive && lastAssigned < bestLastAssigned)
      || (active === bestActive && lastAssigned === bestLastAssigned && priority < bestPriority)
    ) {
      best = connection;
      bestActive = active;
      bestLastAssigned = lastAssigned;
      bestPriority = priority;
    }
  }
  return best;
}

export function rankConnectionsByInflight(connections = []) {
  return [...connections]
    .map((connection, index) => ({ connection, index }))
    .sort((left, right) => {
      const a = left.connection;
      const b = right.connection;
      const activeDiff = getAccountLoad(a?.id) - getAccountLoad(b?.id);
      if (activeDiff !== 0) return activeDiff;

      const aLast = state.accountLoads.get(a?.id)?.lastAssignedAt || 0;
      const bLast = state.accountLoads.get(b?.id)?.lastAssignedAt || 0;
      if (aLast !== bLast) return aLast - bLast;

      const aPriority = Number.isFinite(Number(a?.priority)) ? Number(a.priority) : 999;
      const bPriority = Number.isFinite(Number(b?.priority)) ? Number(b.priority) : 999;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return left.index - right.index;
    })
    .map(({ connection }) => connection);
}

function notifyProviderQueue(provider, releasedConnectionId) {
  const queue = state.providerQueues.get(provider);
  if (!queue || queue.waiters.size === 0) return;

  for (const waiter of queue.waiters) {
    if (waiter.connectionIds && !waiter.connectionIds.has(releasedConnectionId)) continue;
    waiter.cleanup();
    waiter.resolve({ ok: true, releasedConnectionId });

    break;
  }
}

function getProviderLoadEntry(provider) {
  if (!provider) return null;
  let entry = state.providerLoads.get(provider);
  if (!entry) {
    entry = { active: 0 };
    state.providerLoads.set(provider, entry);
  }
  return entry;
}

export function tryAcquireAccountSlot(provider, connectionId, config = {}) {
  if (!config.enabled || !connectionId) return () => {};

  const entry = getAccountLoadEntry(connectionId, provider);
  const providerEntry = getProviderLoadEntry(provider);
  const max = positiveInt(config.maxConcurrentPerAccount, ACCOUNT_POOL_DEFAULTS.maxConcurrentPerAccount, { max: 100_000 });
  const providerMax = positiveInt(
    config.maxConcurrentPerProvider,
    AUTOMATIC_MAX_CONCURRENT_PER_PROVIDER,
    { max: 100_000 },
  );
  if (entry.active >= max || providerEntry.active >= providerMax) return null;

  entry.active += 1;
  providerEntry.active += 1;
  entry.lastAssignedAt = Date.now();
  let released = false;

  return () => {
    if (released) return;
    released = true;
    entry.active = Math.max(0, entry.active - 1);
    providerEntry.active = Math.max(0, providerEntry.active - 1);
    notifyProviderQueue(provider, connectionId);
  };
}

function providerQueue(provider) {
  let queue = state.providerQueues.get(provider);
  if (!queue) {
    queue = { waiters: new Set() };
    state.providerQueues.set(provider, queue);
  }
  return queue;
}

function hasCapacity(provider, connectionIds, config) {
  const max = positiveInt(
    config.maxConcurrentPerAccount,
    ACCOUNT_POOL_DEFAULTS.maxConcurrentPerAccount,
    { max: 100_000 },
  );
  const providerMax = positiveInt(
    config.maxConcurrentPerProvider,
    AUTOMATIC_MAX_CONCURRENT_PER_PROVIDER,
    { max: 100_000 },
  );
  if (getProviderLoad(provider) >= providerMax) return false;
  return connectionIds.some((connectionId) => {
    const entry = state.accountLoads.get(connectionId);
    return !entry || entry.active < max;
  });
}

export function waitForAccountCapacity(provider, connectionIds, config = {}, signal = null) {
  if (!config.enabled) return Promise.resolve({ ok: true, disabled: true });

  const wildcard = connectionIds == null;
  const ids = wildcard ? null : [...new Set((connectionIds || []).filter(Boolean))];
  if (!wildcard && (ids.length === 0 || hasCapacity(provider, ids, config))) {
    return Promise.resolve({ ok: true, immediate: true });
  }

  const queue = providerQueue(provider);
  const maxQueue = positiveInt(config.maxQueuePerProvider, ACCOUNT_POOL_DEFAULTS.maxQueuePerProvider, { max: 1_000_000 });
  if (queue.waiters.size >= maxQueue) {
    return Promise.resolve({ ok: false, reason: "queue_full" });
  }

  if (signal?.aborted) return Promise.resolve({ ok: false, reason: "aborted" });

  return new Promise((resolve) => {
    const waiter = {
      connectionIds: ids ? new Set(ids) : null,
      timer: null,
      abortHandler: null,
      cleanup: () => {
        queue.waiters.delete(waiter);
        if (waiter.timer) clearTimeout(waiter.timer);
        if (signal && waiter.abortHandler) signal.removeEventListener("abort", waiter.abortHandler);
      },
      resolve,
    };

    const finish = (result) => {
      waiter.cleanup();
      resolve(result);
    };

    waiter.resolve = finish;
    waiter.timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), config.queueWaitTimeoutMs);
    waiter.timer?.unref?.();
    waiter.abortHandler = () => finish({ ok: false, reason: "aborted" });
    signal?.addEventListener("abort", waiter.abortHandler, { once: true });
    queue.waiters.add(waiter);
  });
}

function toRoutingConnection(connection) {
  const routing = { ...connection };
  for (const key of [
    "apiKey", "accessToken", "refreshToken", "idToken", "copilotToken",
    "providerSpecificData", "tokenType", "scope", "expiresAt", "expiresIn",
  ]) delete routing[key];
  return routing;
}

function pruneInactiveAccountLoads(provider, activeIds) {
  for (const [connectionId, entry] of state.accountLoads.entries()) {
    if (entry.provider === provider && entry.active === 0 && !activeIds.has(connectionId)) {
      state.accountLoads.delete(connectionId);
    }
  }
}

export async function getCachedProviderConnections(provider, loader, ttlMs = Number(ACCOUNT_POOL_DEFAULTS.cacheTtlMs)) {
  const key = String(provider || "");
  const now = Date.now();
  const hit = state.providerCache.get(key);
  if (hit?.value && hit.expiresAt > now) return hit.value;
  if (hit?.promise) return hit.promise;

  const promise = Promise.resolve()
    .then(loader)
    .then((connections) => {
      const value = Array.isArray(connections) ? connections.map(toRoutingConnection) : [];
      pruneInactiveAccountLoads(key, new Set(value.map((connection) => connection.id)));
      state.providerCache.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
      return value;
    })
    .catch((error) => {
      state.providerCache.delete(key);
      throw error;
    });

  state.providerCache.set(key, { promise });
  return promise;
}

export function invalidateProviderAccountPool(provider) {
  if (provider) state.providerCache.delete(String(provider));
  else state.providerCache.clear();
}

export function getAccountPoolSnapshot(provider = null) {
  const accounts = [];
  for (const [connectionId, entry] of state.accountLoads.entries()) {
    if (provider && entry.provider !== provider) continue;
    accounts.push({ connectionId, provider: entry.provider, active: entry.active });
  }
  return {
    provider,
    activeProvider: provider ? getProviderLoad(provider) : null,
    activeProviders: [...state.providerLoads.entries()].map(([id, entry]) => ({ provider: id, active: entry.active })),
    activeAccounts: accounts,
    queued: provider ? (state.providerQueues.get(provider)?.waiters.size || 0) : [...state.providerQueues.values()].reduce((sum, queue) => sum + queue.waiters.size, 0),
  };
}

export function resetAccountPoolForTests() {
  state.accountLoads.clear();
  state.providerLoads.clear();
  state.providerQueues.clear();
  state.providerCache.clear();
}
