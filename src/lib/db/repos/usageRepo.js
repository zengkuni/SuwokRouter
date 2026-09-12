import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";
import { getWriteBehindBuffer } from "../writeBehind.js";
import { env } from "@/lib/env";

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000, "90d": 7776000000, "365d": 31536000000 };
const HISTORY_PRUNE_INTERVAL_MS = 60 * 1000;
const HISTORY_PRUNE_BATCH_SIZE = 10_000;
let lastHistoryPruneAt = 0;

if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null };

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
const statsEmitTimers = global._statsEmitTimers;

export const statsEmitter = global._statsEmitter;

function scheduleStatsEvent(event, delayMs = 150) {
  const key = event === "update" ? "update" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isUsageErrorStatus(status) {
  const value = String(status || "").toLowerCase();
  return value === "error" || value.includes("error") || value.startsWith("4") || value.startsWith("5");
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

function createEmptyUsageDay() {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cost: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    byApiKey: {},
    byEndpoint: {},
  };
}

function pruneUsageHistory(db) {
  const now = Date.now();
  if (now - lastHistoryPruneAt < HISTORY_PRUNE_INTERVAL_MS) return 0;

  const retentionDays = Math.max(1, Number(env.usageHistoryRetentionDays) || 7);
  const maxRows = Math.max(1, Number(env.usageHistoryMaxRows) || 500_000);
  const cutoff = new Date(now - retentionDays * 86400000).toISOString();
  let deleted = 0;

  const oldRows = db.all(
    "SELECT id FROM usageHistory WHERE timestamp < ? ORDER BY id ASC LIMIT ?",
    [cutoff, HISTORY_PRUNE_BATCH_SIZE],
  );
  if (oldRows.length > 0) {
    db.run(
      "DELETE FROM usageHistory WHERE id IN (SELECT id FROM usageHistory WHERE timestamp < ? ORDER BY id ASC LIMIT ?)",
      [cutoff, HISTORY_PRUNE_BATCH_SIZE],
    );
    deleted += oldRows.length;
  }

  const count = Number(db.get("SELECT COUNT(*) AS count FROM usageHistory")?.count || 0);
  if (count > maxRows) {
    const overflow = Math.min(count - maxRows, HISTORY_PRUNE_BATCH_SIZE);
    const oldestRows = db.all(
      "SELECT id FROM usageHistory ORDER BY id ASC LIMIT ?",
      [overflow],
    );
    if (oldestRows.length > 0) {
      db.run(
        "DELETE FROM usageHistory WHERE id IN (SELECT id FROM usageHistory ORDER BY id ASC LIMIT ?)",
        [overflow],
      );
      deleted += oldestRows.length;
    }
  }

  if (deleted > 0) {
    const previous = Number.parseInt(
      db.get("SELECT value FROM _meta WHERE key = 'usageHistoryPrunedTotal'")?.value,
      10,
    ) || 0;
    db.run(
      "INSERT INTO _meta(key, value) VALUES('usageHistoryPrunedTotal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [String(previous + deleted)],
    );
  }
  lastHistoryPruneAt = now;
  return deleted;
}

function reconcileUsageAggregates(db) {
  const historyCount = Number(db.get("SELECT COUNT(*) AS count FROM usageHistory")?.count || 0);
  const dailyRows = db.all("SELECT dateKey, data FROM usageDaily");
  const dailyCount = dailyRows.reduce((sum, row) => {
    const day = parseJson(row.data, {}) || {};
    return sum + Number(day.requests || 0);
  }, 0);
  const lifetimeRaw = db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'")?.value;
  const lifetimeCount = Number.parseInt(lifetimeRaw, 10);
  const prunedRaw = db.get("SELECT value FROM _meta WHERE key = 'usageHistoryPrunedTotal'")?.value;
  const prunedCount = Math.max(0, Number.parseInt(prunedRaw, 10) || 0);
  const expectedRetainedCount = Math.max(0, lifetimeCount - prunedCount);

  const aggregatesMatch = historyCount === dailyCount
    && historyCount === lifetimeCount
    && (historyCount > 0 || dailyRows.length === 0);
  const retainedHistoryMatches = prunedCount > 0
    && dailyCount === lifetimeCount
    && historyCount === expectedRetainedCount;
  if (aggregatesMatch || retainedHistoryMatches) {
    return false;
  }

  const dayMap = {};
  const rows = db.all(
    "SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta FROM usageHistory ORDER BY id ASC",
  );
  for (const row of rows) {
    const parsedTokens = parseJson(row.tokens, {}) || {};
    const tokens = Object.keys(parsedTokens).length > 0
      ? parsedTokens
      : {
          prompt_tokens: Number(row.promptTokens || 0),
          completion_tokens: Number(row.completionTokens || 0),
        };
    const entry = {
      timestamp: row.timestamp,
      provider: row.provider || null,
      model: row.model || null,
      connectionId: row.connectionId || null,
      apiKey: row.apiKey || null,
      endpoint: row.endpoint || null,
      cost: Number(row.cost || 0),
      status: row.status || "ok",
      tokens,
      meta: parseJson(row.meta, {}) || {},
    };
    const dateKey = getLocalDateKey(row.timestamp);
    dayMap[dateKey] ||= createEmptyUsageDay();
    aggregateEntryToDay(dayMap[dateKey], entry);
  }

  db.transaction(() => {
    db.run("DELETE FROM usageDaily");
    for (const [dateKey, day] of Object.entries(dayMap)) {
      db.run(
        "INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)",
        [dateKey, stringifyJson(day)],
      );
    }
    db.run(
      "INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [String(historyCount)],
    );
    db.run(
      "INSERT INTO _meta(key, value) VALUES('usageHistoryPrunedTotal', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
  });
  return true;
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

function finiteLatency(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function periodStart(period) {
  if (period === "all") return null;
  if (period === "year") {
    const start = new Date(new Date().getFullYear(), 0, 1);
    return start.toISOString();
  }
  if (period === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const duration = PERIOD_MS[period];
  return duration ? new Date(Date.now() - duration).toISOString() : null;
}

function enrichRecentLatencies(db, rows) {
  const missing = rows.some((row) => row.latencyMs === undefined);
  if (!missing) return rows;

  let detailRows = [];
  try {
    detailRows = db.all(
      `SELECT timestamp, provider, model, connectionId, data FROM requestDetails ORDER BY timestamp DESC LIMIT 500`
    );
  } catch {
    return rows;
  }

  const candidates = detailRows
    .map((row) => {
      const detail = parseJson(row.data, {}) || {};
      return {
        timestamp: row.timestamp,
        provider: row.provider || "",
        model: row.model || "",
        connectionId: row.connectionId || null,
        time: Date.parse(row.timestamp),
        latencyMs: finiteLatency(detail.latency?.total),
      };
    })
    .filter((row) => Number.isFinite(row.time) && row.latencyMs !== undefined);
  const used = new Set();

  return rows.map((row) => {
    if (row.latencyMs !== undefined) return row;
    const requestTime = Date.parse(row.timestamp);
    if (!Number.isFinite(requestTime)) return row;

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const candidate = candidates[i];
      if (candidate.provider !== (row.provider || "") || candidate.model !== (row.model || "")) continue;
      if (candidate.connectionId !== (row.connectionId || null)) continue;
      const distance = Math.abs(candidate.time - requestTime);
      if (distance <= 10_000 && distance < bestDistance) {
        best = { index: i, latencyMs: candidate.latencyMs };
        bestDistance = distance;
      }
    }
    if (!best) return row;
    used.add(best.index);
    return { ...row, latencyMs: best.latencyMs };
  });
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnectionsForRouting } = await import("./connectionsRepo.js");
    const all = await getProviderConnectionsForRouting();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: r.apiKey, endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    const { calculateCostFromTokens } = await import("../../../providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  scheduleStatsEvent("pending");
}

export async function getActiveRequests() {
  const activeRequests = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  await flushUsageBuffer();
  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        cacheCreationTokens: t.cache_creation_input_tokens || 0,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

const usageBuffer = getWriteBehindBuffer({
  name: "usage",
  flushFn: flushUsageBatch,
  flushMs: 20,
  batchSize: 200,
});

export async function flushUsageBuffer() {
  await usageBuffer.flushImmediate();
}

async function flushUsageBatch(rows) {
  if (!rows.length) return;
  const db = await getAdapter();

  const seen = new Set();
  const deduped = [];
  for (const e of rows) {
    const tokens = e.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    const key = `${e.timestamp}|${e.provider || ""}|${e.model || ""}|${e.connectionId || ""}|${e.apiKey || ""}|${promptTokens}|${completionTokens}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  const existingKeys = new Set();
  const timestamps = [...new Set(deduped.map((e) => e.timestamp))];
  const existingRows = [];
  for (const ts of timestamps.slice(0, 64)) {
    existingRows.push(...db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, promptTokens, completionTokens, id, endpoint FROM usageHistory WHERE timestamp = ?`,
      [ts]
    ));
  }
  for (const r of existingRows) {
    existingKeys.add(`${r.timestamp}|${r.provider || ""}|${r.model || ""}|${r.connectionId || ""}|${r.apiKey || ""}|${r.promptTokens}|${r.completionTokens}`);
  }

  const dayMap = {};
  const touchedDays = new Set();
  for (const e of deduped) touchedDays.add(getLocalDateKey(e.timestamp));
  for (const dateKey of touchedDays) {
    const dayRow = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
    dayMap[dateKey] = dayRow ? parseJson(dayRow.data, {}) : {
      requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
      byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    };
  }

  let insertedAny = false;
  let insertedCount = 0;
  db.transaction(() => {
    for (const entry of deduped) {
      const tokens = entry.tokens || {};
      const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
      const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;
      const key = `${entry.timestamp}|${entry.provider || ""}|${entry.model || ""}|${entry.connectionId || ""}|${entry.apiKey || ""}|${promptTokens}|${completionTokens}`;

      if (existingKeys.has(key)) {

        continue;
      }

      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson(entry.meta || {}),
        ]
      );

      const dateKey = getLocalDateKey(entry.timestamp);
      aggregateEntryToDay(dayMap[dateKey], entry);
      existingKeys.add(key);
      insertedAny = true;
      insertedCount++;
      pushToRing(entry);
    }

    for (const dateKey of touchedDays) {
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(dayMap[dateKey])]);
    }

    if (insertedCount > 0) {
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + insertedCount;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
    }

    pruneUsageHistory(db);
  });

  if (insertedAny) scheduleStatsEvent("update", 250);
}

export async function clearUsageHistory({ startDate, endDate } = {}) {
  await flushUsageBuffer();
  const { clearRequestDetails } = await import("./requestDetailsRepo.js");
  const db = await getAdapter();
  const partial = Boolean(startDate || endDate);
  const conds = [];
  const params = [];
  if (startDate) {
    conds.push("timestamp >= ?");
    params.push(new Date(startDate).toISOString());
  }
  if (endDate) {
    conds.push("timestamp <= ?");
    params.push(new Date(endDate).toISOString());
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  let deletedUsage = 0;
  let deletedDaily = 0;

  db.transaction(() => {
    deletedUsage = Number(db.get(`SELECT COUNT(*) AS count FROM usageHistory ${where}`, params)?.count || 0);
    if (!partial) {
      deletedDaily = Number(db.get(`SELECT COUNT(*) AS count FROM usageDaily`)?.count || 0);
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageDaily`);
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
      db.run(`INSERT INTO _meta(key, value) VALUES('usageHistoryPrunedTotal', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
      return;
    }
    db.run(`DELETE FROM usageHistory ${where}`, params);
  });

  if (partial && deletedUsage > 0) {
    const beforeDaily = Number(db.get(`SELECT COUNT(*) AS count FROM usageDaily`)?.count || 0);
    reconcileUsageAggregates(db);
    const afterDaily = Number(db.get(`SELECT COUNT(*) AS count FROM usageDaily`)?.count || 0);
    deletedDaily = Math.max(0, beforeDaily - afterDaily);
  }

  const deletedDetails = await clearRequestDetails({ startDate, endDate });
  if (!partial) {
    recentRing.items = [];
    recentRing.initialized = true;
  } else {
    const startMs = startDate ? Date.parse(startDate) : Number.NEGATIVE_INFINITY;
    const endMs = endDate ? Date.parse(endDate) : Number.POSITIVE_INFINITY;
    recentRing.items = recentRing.items.filter((entry) => {
      const timestamp = Date.parse(entry.timestamp);
      return !Number.isFinite(timestamp) || timestamp < startMs || timestamp > endMs;
    });
  }

  if (!partial || (lastErrorProvider.ts >= (startDate ? Date.parse(startDate) : Number.NEGATIVE_INFINITY) && lastErrorProvider.ts <= (endDate ? Date.parse(endDate) : Number.POSITIVE_INFINITY))) {
    lastErrorProvider.provider = "";
    lastErrorProvider.ts = 0;
  }
  scheduleStatsEvent("update", 0);
  return { usageHistory: deletedUsage, usageDaily: deletedDaily, requestDetails: deletedDetails };
}

export async function saveRequestUsage(entry) {
  try {
    if (!entry.timestamp) entry.timestamp = new Date().toISOString();

    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);
    usageBuffer.push(entry);
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}

export async function getUsageHistory(filter = {}) {
  await flushUsageBuffer();
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("uh.provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("uh.model = ?"); params.push(filter.model); }
  if (filter.apiKeyId) { conds.push("ak.id = ?"); params.push(filter.apiKeyId); }
  if (filter.startDate) { conds.push("uh.timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("uh.timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const limit = Math.min(500, Math.max(1, Number(filter.limit) || 50));
  const rows = db.all(
    `SELECT uh.id, uh.timestamp, uh.provider, uh.model, uh.connectionId,
            uh.apiKey, uh.endpoint, uh.cost, uh.status, uh.promptTokens,
            uh.completionTokens, uh.tokens, uh.meta, ak.id AS apiKeyId
     FROM usageHistory uh
     LEFT JOIN apiKeys ak ON ak.key = uh.apiKey
     ${where}
     ORDER BY uh.timestamp DESC, uh.id DESC
     LIMIT ?`,
    [...params, limit],
  );

  return rows.map((r) => {
    const tokens = parseJson(r.tokens, {}) || {};
    const meta = parseJson(r.meta, {}) || {};
    return {
      id: String(r.id),
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      connectionId: r.connectionId,
      apiKeyId: r.apiKeyId || undefined,
      apiKeyMasked: maskApiKey(r.apiKey),
      endpoint: r.endpoint,
      cost: r.cost,
      promptTokens: Number(r.promptTokens ?? tokens.prompt_tokens ?? tokens.input_tokens ?? 0),
      completionTokens: Number(r.completionTokens ?? tokens.completion_tokens ?? tokens.output_tokens ?? 0),
      cachedTokens: Number(tokens.cached_tokens ?? tokens.cache_read_input_tokens ?? 0),
      cacheCreationTokens: Number(tokens.cache_creation_input_tokens ?? 0),
      status: r.status || "ok",
      tokens,
      latencyMs: finiteLatency(meta.latencyMs),
      error: meta.error || null,
    };
  });
}

export async function getUsageHistoryPage(filter = {}) {
  await flushUsageBuffer();
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.query) {
    const like = `%${String(filter.query).replace(/[\\%_]/g, "\\$&").slice(0, 200)}%`;
    conds.push("(provider LIKE ? ESCAPE '\\\\' OR model LIKE ? ESCAPE '\\\\' OR status LIKE ? ESCAPE '\\\\' OR connectionId LIKE ? ESCAPE '\\\\')");
    params.push(like, like, like, like);
  }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const totalItems = Number(db.get(`SELECT COUNT(*) AS c FROM usageHistory ${where}`, params)?.c || 0);
  const page = Math.max(1, Number(filter.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filter.pageSize) || 20));
  const totalPages = Math.ceil(totalItems / pageSize);
  const order = filter.sortDir === "asc" ? "ASC" : "DESC";
  const rows = db.all(
    `SELECT id, timestamp, provider, model, connectionId, endpoint, cost, status, promptTokens, completionTokens, tokens, meta FROM usageHistory ${where} ORDER BY timestamp ${order}, id ${order} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    details: rows.map((r) => ({
      id: String(r.id), timestamp: r.timestamp, provider: r.provider, model: r.model,
      connectionId: r.connectionId, endpoint: r.endpoint, cost: r.cost, status: r.status,
      promptTokens: Number(r.promptTokens ?? 0),
      completionTokens: Number(r.completionTokens ?? 0),
      tokens: parseJson(r.tokens, {}),
      latencyMs: finiteLatency(parseJson(r.meta, {})?.latencyMs),
      error: parseJson(r.meta, {})?.error || null,
    })),
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

function loadDaysInRange(adapter, maxDays) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`);
  }
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]);
}

export async function getUsageStats(period = "all") {
  await flushUsageBuffer();
  const db = await getAdapter();
  reconcileUsageAggregates(db);

    const [{ getProviderConnectionsForRouting }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
  ]);

  let allConnections = [];
  try { allConnections = await getProviderConnectionsForRouting(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  const recentCutoff = periodStart(period);
  const recentRows = db.all(
    `SELECT timestamp, provider, model, connectionId, tokens, meta, status
     FROM usageHistory
     ${recentCutoff ? "WHERE timestamp >= ?" : ""}
     ORDER BY id DESC LIMIT 100`,
    recentCutoff ? [recentCutoff] : [],
  );
  const seen = new Set();
  const recentRequests = enrichRecentLatencies(db, recentRows
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider || "", connectionId: r.connectionId || null,
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        cacheCreationTokens: t.cache_creation_input_tokens || 0,
        latencyMs: finiteLatency(parseJson(r.meta, {})?.latencyMs),
        status: r.status || "ok",
      };
    })
    .filter((e) => {
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20));

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
    }
  }

  const useDailySummary = period !== "24h" && period !== "today";

  if (useDailySummary) {
    const now = new Date();
    const daysInCurrentYear = Math.floor(
      (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000,
    ) + 1;
    const periodDays = { "7d": 7, "30d": 30, "60d": 60, "90d": 90, "365d": 365, year: daysInCurrentYear };
    const maxDays = periodDays[period] || null;
    const dayRows = loadDaysInRange(db, maxDays);

    for (const dr of dayRows) {
      const dateKey = dr.dateKey;
      const day = parseJson(dr.data, {});
      stats.totalPromptTokens += day.promptTokens || 0;
      stats.totalCompletionTokens += day.completionTokens || 0;
      stats.totalCachedTokens += day.cachedTokens || 0;
      stats.totalCost += day.cost || 0;

      for (const [prov, p] of Object.entries(day.byProvider || {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests || 0;
        stats.byProvider[prov].promptTokens += p.promptTokens || 0;
        stats.byProvider[prov].completionTokens += p.completionTokens || 0;
        stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
        stats.byProvider[prov].cost += p.cost || 0;
      }

      for (const [mk, m] of Object.entries(day.byModel || {})) {
        const rawModel = m.rawModel || mk.split("|")[0];
        const provider = m.provider || mk.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byModel[statsKey].requests += m.requests || 0;
        stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
        stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
        stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
        stats.byModel[statsKey].cost += m.cost || 0;
        if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
      }

      for (const [connId, a] of Object.entries(day.byAccount || {})) {
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const rawModel = a.rawModel || "";
        const provider = a.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: dateKey };
        }
        stats.byAccount[accountKey].requests += a.requests || 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
        stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
        stats.byAccount[accountKey].cost += a.cost || 0;
        if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
      }

      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || "";
        const provider = ak.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const apiKeyVal = ak.apiKey;
        const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
        const keyName = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
        const apiKeyMasked = maskApiKey(apiKeyVal);
        const apiKeyKey = apiKeyMasked || "local-no-key";
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey, lastUsed: dateKey };
        }
        stats.byApiKey[akKey].requests += ak.requests || 0;
        stats.byApiKey[akKey].promptTokens += ak.promptTokens || 0;
        stats.byApiKey[akKey].completionTokens += ak.completionTokens || 0;
        stats.byApiKey[akKey].cachedTokens += ak.cachedTokens || 0;
        stats.byApiKey[akKey].cost += ak.cost || 0;
        if (dateKey > (stats.byApiKey[akKey].lastUsed || "")) stats.byApiKey[akKey].lastUsed = dateKey;
      }

      for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
        const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
        const rawModel = ep.rawModel || "";
        const provider = ep.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[epKey]) {
          stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byEndpoint[epKey].requests += ep.requests || 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
        stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
        stats.byEndpoint[epKey].cost += ep.cost || 0;
        if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
      }
    }

    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const histRows = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?`,
      [new Date(overlayCutoff).toISOString()]
    );
    for (const e of histRows) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;

      if (e.connectionId) {
        const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
        const accountKey = `${e.model} (${e.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = ts;
      }

      const apiKeyKey = (e.apiKey && typeof e.apiKey === "string")
        ? `${e.apiKey}|${e.model}|${e.provider || "unknown"}`
        : "local-no-key";
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = ts;

      const endpoint = e.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) stats.byEndpoint[endpointKey].lastUsed = ts;
    }
  } else {

    let cutoff;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    }
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [cutoff]
    );

    for (const r of filtered) {
      const tokens = parseJson(r.tokens, {}) || {};
      const promptTokens = tokens.prompt_tokens || 0;
      const completionTokens = tokens.completion_tokens || 0;
      const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      const entryCost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalCost += entryCost;

      if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      stats.byProvider[r.provider].requests++;
      stats.byProvider[r.provider].promptTokens += promptTokens;
      stats.byProvider[r.provider].completionTokens += completionTokens;
      stats.byProvider[r.provider].cachedTokens += cachedTokens;
      stats.byProvider[r.provider].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      if (r.apiKey && typeof r.apiKey === "string") {
        const keyInfo = apiKeyMap[r.apiKey];
        const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
        const apiKeyMasked = maskApiKey(r.apiKey);
        const akKey = `${apiKeyMasked}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey: apiKeyMasked, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey["local-no-key"];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

function getHourlyHeatmapData(db, days = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));

  const heatmap = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateKey = getLocalDateKey(date);
    return {
      date: dateKey,
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        requests: 0,
        errors: 0,
        tokens: 0,
        cost: 0,
      })),
    };
  });

  const byDate = new Map(heatmap.map((day) => [day.date, day]));
  const rows = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost, status, tokens, meta
     FROM usageHistory
     WHERE timestamp >= ?`,
    [start.toISOString()],
  );

  for (const row of rows) {
    const timestamp = new Date(row.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;

    const day = byDate.get(getLocalDateKey(row.timestamp));
    const hour = timestamp.getHours();
    if (!day || hour < 0 || hour > 23) continue;

    const cell = day.hours[hour];
    const tokenData = row.tokens ? parseJson(row.tokens, {}) : {};
    const metaData = row.meta ? parseJson(row.meta, {}) : {};
    const promptTokens = Number(row.promptTokens) || Number(tokenData.prompt_tokens ?? tokenData.input_tokens ?? 0) || 0;
    const completionTokens = Number(row.completionTokens) || Number(tokenData.completion_tokens ?? tokenData.output_tokens ?? 0) || 0;
    cell.requests += 1;
    cell.errors += isUsageErrorStatus(row.status) || Boolean(metaData?.error) ? 1 : 0;
    cell.tokens += promptTokens + completionTokens;
    cell.cost += Number(row.cost) || 0;
  }

  return heatmap;
}

export async function getChartData(period = "7d", options = {}) {
  await flushUsageBuffer();
  const db = await getAdapter();
  reconcileUsageAggregates(db);
  const now = Date.now();

  if (options.granularity === "hour" && (period === "7d" || period === "30d")) {
    const days = Number(options.days) || (period === "7d" ? 7 : 30);
    return getHourlyHeatmapData(db, Math.min(Math.max(days, 1), 30));
  }

  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0, requests: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
        buckets[idx].requests++;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0, requests: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
      buckets[idx].requests++;
    }
    return buckets;
  }

  const today = new Date();
  const calendarYear = today.getFullYear();
  const isCalendarYear = period === "year";
  const bucketCount = isCalendarYear
    ? Math.round((Date.UTC(calendarYear + 1, 0, 1) - Date.UTC(calendarYear, 0, 1)) / 86400000)
    : period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : period === "180d" ? 180 : period === "365d" ? 365 : 60;
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const calendarStartKey = `${calendarYear}-01-01`;
  const calendarEndKey = `${calendarYear}-12-31`;
  const dayRows = isCalendarYear
    ? db.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? AND dateKey <= ?`, [calendarStartKey, calendarEndKey])
    : loadDaysInRange(db, bucketCount);
  const dayMap = {};
  for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});

  const firstDay = isCalendarYear ? new Date(calendarYear, 0, 1) : new Date(today);
  firstDay.setHours(0, 0, 0, 0);
  if (!isCalendarYear) firstDay.setDate(firstDay.getDate() - (bucketCount - 1));
  const errorRows = isCalendarYear
    ? db.all(
        `SELECT timestamp, status FROM usageHistory WHERE timestamp >= ? AND timestamp < ?`,
        [firstDay.toISOString(), new Date(calendarYear + 1, 0, 1).toISOString()],
      )
    : db.all(
        `SELECT timestamp, status FROM usageHistory WHERE timestamp >= ?`,
        [firstDay.toISOString()],
      );
  const errorsByDate = {};
  for (const row of errorRows) {
    const status = String(row.status || "").toLowerCase();
    if (!isUsageErrorStatus(status)) continue;
    const date = new Date(row.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const key = getLocalDateKey(row.timestamp);
    errorsByDate[key] = (errorsByDate[key] || 0) + 1;
  }

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = isCalendarYear ? new Date(calendarYear, 0, 1) : new Date(today);
    if (isCalendarYear) d.setDate(d.getDate() + i);
    else d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    return {
      date: dateKey,
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0) : 0,
      promptTokens: dayData ? dayData.promptTokens || 0 : 0,
      completionTokens: dayData ? dayData.completionTokens || 0 : 0,
      cachedTokens: dayData ? dayData.cachedTokens || 0 : 0,
      cost: dayData ? (dayData.cost || 0) : 0,
      requests: dayData ? dayData.requests || 0 : 0,
      errors: errorsByDate[dateKey] || 0,
    };
  });
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function appendRequestLog() {}

export async function getRecentLogs(limit = 200) {
  try {
    await flushUsageBuffer();
    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    if (!rows.length) return [];

    const connMap = {};
    try {
      const { getProviderConnectionsForRouting } = await import("./connectionsRepo.js");
      const connections = await getProviderConnectionsForRouting();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() || "-";
      const m = r.model || "-";
      const account = connMap[r.connectionId] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}

export async function searchLogs(opts = {}) {
  try {
    await flushUsageBuffer();
    const db = await getAdapter();

    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(opts.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (opts.provider) {
      conditions.push("LOWER(uh.provider) = ?");
      params.push(opts.provider.toLowerCase());
    }
    if (opts.model) {
      conditions.push("LOWER(uh.model) LIKE ?");
      params.push(`%${opts.model.toLowerCase()}%`);
    }
    if (opts.status) {
      conditions.push("LOWER(uh.status) = ?");
      params.push(opts.status.toLowerCase());
    }
    if (opts.q) {

      const q = `%${opts.q.toLowerCase()}%`;
      conditions.push("(LOWER(uh.model) LIKE ? OR LOWER(uh.provider) LIKE ? OR LOWER(COALESCE(pc.name, pc.email, uh.connectionId, '')) LIKE ?)");
      params.push(q, q, q);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = db.get(
      `SELECT COUNT(*) AS cnt FROM usageHistory uh LEFT JOIN providerConnections pc ON uh.connectionId = pc.id ${where}`,
      params,
    );
    const total = countRow?.cnt ?? 0;

    const rows = db.all(
      `SELECT uh.id, uh.timestamp, uh.provider, uh.model, uh.connectionId,
              uh.promptTokens, uh.completionTokens, uh.cost, uh.status, uh.tokens,
              pc.name AS connectionName, pc.email AS connectionEmail
       FROM usageHistory uh
       LEFT JOIN providerConnections pc ON uh.connectionId = pc.id
       ${where}
       ORDER BY uh.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const mapped = rows.map((r) => {
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      return {
        id: r.id,
        timestamp: r.timestamp,
        provider: r.provider || "-",
        model: r.model || "-",
        connection: r.connectionName || r.connectionEmail || (r.connectionId ? r.connectionId.slice(0, 8) : "-"),
        promptTokens: r.promptTokens ?? tk.prompt_tokens ?? 0,
        completionTokens: r.completionTokens ?? tk.completion_tokens ?? 0,
        cost: r.cost ?? 0,
        status: r.status || "-",
      };
    });

    return { rows: mapped, total, page, limit };
  } catch (e) {
    console.error("[usageRepo] searchLogs failed:", e.message);
    return { rows: [], total: 0, page: 1, limit: 50 };
  }
}
