import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

import { getCurrentTraceId } from "@/observability/tracing.js";

import { getCapturePolicy, decideWithPolicy, applyCaptureDecision } from "@/lib/security/payloadCapture.js";
import { getEnvConfig } from "@/lib/env.ts";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const runtimeEnv = getEnvConfig({ refresh: true });
    const envRequestLogs = runtimeEnv.requestLogsConfigured
      ? runtimeEnv.requestLogsEnabled
      : undefined;
    if (envRequestLogs !== undefined) {
      const enabled = envRequestLogs;
      cachedConfig = {
        enabled,
        maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
        batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
        flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
        maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
      };
      cachedConfigTs = Date.now();
      return cachedConfig;
    }
    const envFallback = process.env.OBSERVABILITY_ENABLED !== "false";
    const uiFlag = typeof settings.enableObservability === "boolean";
    const payloadCaptureEnabled = settings.payloadCaptureEnabled === true;

    const enabled = uiFlag
      ? settings.enableObservability || payloadCaptureEnabled
      : envFallback || payloadCaptureEnabled;

    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;
let flushPromise = null;

const SENSITIVE_KEY_PATTERN = /(authorization|proxy-authorization|api[-_]?key|cookie|set-cookie|token|secret|password|credential|private[-_]?key|signature)/i;

function redactSensitive(value, key = "", seen = new WeakSet()) {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED:circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, key, seen));
  const sanitized = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = redactSensitive(childValue, childKey, seen);
  }
  return sanitized;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const plain = typeof headers.entries === "function" ? Object.fromEntries(headers.entries()) : headers;
  return redactSensitive(plain);
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = crypto.randomUUID();
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const sanitized = redactSensitive(obj || {});
  const str = JSON.stringify(sanitized);
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return sanitized;
}

function rawField(obj) {
  if (obj == null) return obj;
  try {
    JSON.stringify(obj);
    return obj;
  } catch {
    return { _captureError: "payload_not_json_serializable" };
  }
}

function persistBody(obj, maxSize, decision) {
  return decision === "raw" ? rawField(obj) : truncateField(obj, maxSize);
}

async function flushToDatabase() {
  if (isFlushing) {
    await flushPromise;
    return;
  }
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  flushPromise = (async () => {
    try {

      while (writeBuffer.length > 0) {
        const items = writeBuffer.splice(0, writeBuffer.length);
        const db = await getAdapter();
        const config = await getObservabilityConfig();

        const policy = await getCapturePolicy().catch(() => ({ mode: "none", sampleRate: 0.01 }));

        db.transaction(() => {
          for (const item of items) {
            if (!item.id) item.id = generateDetailId(item.model);
            if (!item.timestamp) item.timestamp = new Date().toISOString();
            if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

            const trace_id = item.traceId || item.trace_id || null;
            const decision = decideWithPolicy(policy, item.status, trace_id);
            applyCaptureDecision(item, decision);

            const record = {
              id: item.id,
              provider: item.provider || null,
              model: item.model || null,
              connectionId: item.connectionId || null,
              timestamp: item.timestamp,
              status: item.status || null,
              latency: item.latency || {},
              tokens: item.tokens || {},
              request: persistBody(item.request, config.maxJsonSize, decision),
              providerRequest: persistBody(item.providerRequest, config.maxJsonSize, decision),
              providerResponse: persistBody(item.providerResponse, config.maxJsonSize, decision),
              response: persistBody(item.response, config.maxJsonSize, decision),
            };
            record.trace_id = trace_id;

            record.payload_capture = `${policy.mode}:${decision}`;

            db.run(
              `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data, trace_id, payload_capture) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data, trace_id = excluded.trace_id, payload_capture = excluded.payload_capture`,
              [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record), trace_id, record.payload_capture]
            );
          }

          const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
          if (cnt && cnt.c > config.maxRecords) {
            db.run(
              `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
              [cnt.c - config.maxRecords]
            );
          }
        });
      }
    } catch (e) {
      console.error("[requestDetailsRepo] Batch write failed:", e);
    } finally {
      isFlushing = false;
      flushPromise = null;
    }
  })();
  await flushPromise;
}

export async function clearRequestDetails({ startDate, endDate } = {}) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  await flushToDatabase();
  const db = await getAdapter();
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
  const row = db.get(`SELECT COUNT(*) AS count FROM requestDetails ${where}`, params);
  db.run(`DELETE FROM requestDetails ${where}`, params);
  return Number(row?.count || 0);
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) {return;}

  if (detail && !detail.traceId && !detail.trace_id) {
    const tid = getCurrentTraceId();
    if (tid) {
      detail.traceId = tid;
      detail.trace_id = tid;
    }
  }

  writeBuffer.push(detail);

  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushToDatabase().catch((e) => console.error("[requestDetailsRepo] flush err:", e));
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

async function enrichDetailsWithUsage(db, details) {
  if (!details.length) return details;

  const usageRows = db.all(`
    SELECT timestamp, provider, model, connectionId, promptTokens,
           completionTokens, tokens
    FROM usageHistory
    ORDER BY id DESC
    LIMIT 500
  `);
  const candidates = usageRows.map((row) => ({
    ...row,
    time: Date.parse(row.timestamp),
    tokens: parseJson(row.tokens, {}) || {},
  })).filter((row) => Number.isFinite(row.time));
  const used = new Set();

  return details.map((detail) => {
    const detailTokens = detail?.tokens || {};
    const hasTokens = Number(detailTokens.prompt_tokens ?? detailTokens.input_tokens ?? 0) > 0
      || Number(detailTokens.completion_tokens ?? detailTokens.output_tokens ?? 0) > 0;
    if (hasTokens || !detail?.timestamp) return detail;

    const detailTime = Date.parse(detail.timestamp);
    if (!Number.isFinite(detailTime)) return detail;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const row = candidates[i];
      if (row.provider !== detail.provider || row.model !== detail.model) continue;
      if ((row.connectionId || null) !== (detail.connectionId || null)) continue;
      const distance = Math.abs(row.time - detailTime);
      if (distance <= 10_000 && distance < bestDistance) {
        best = { row, index: i };
        bestDistance = distance;
      }
    }
    if (!best) return detail;
    used.add(best.index);
    return { ...detail, tokens: best.row.tokens };
  });
}

export async function getRequestDetails(filter = {}) {
  await flushToDatabase();
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.query) {
    const like = `%${String(filter.query).replace(/[\\%_]/g, "\\$&").slice(0, 200)}%`;
    conds.push("(provider LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\' OR connectionId LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const order = filter.sortDir === "asc" ? "ASC" : "DESC";
  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp ${order}, id ${order} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const details = await enrichDetailsWithUsage(db, rows.map((r) => parseJson(r.data, {})));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getDistinctProviders() {
  await flushToDatabase();
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM requestDetails WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((r) => r.provider);
}

export async function getRequestDetailById(id) {
  await flushToDatabase();
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

export async function flushRequestDetails() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
}
