const MAX_SERIES_PER_METRIC = 100;
const MAX_LABELS_PER_METRIC = 8;
const MAX_LABEL_VALUE_LEN = 128;

const REGISTRY = new Map();

class Metric {

  constructor({ name, kind, help, labels = [], buckets }) {
    this.name = name;
    this.kind = kind;
    this.help = help ?? "";
    this.labelNames = labels.slice(0, MAX_LABELS_PER_METRIC);

    this.series = new Map();
    this.overflows = 0;
    if (kind === "histogram") {

      this.buckets = (buckets ?? DEFAULT_BUCKETS_MS).slice().sort((a, b) => a - b);
    }
  }
}

const DEFAULT_BUCKETS_MS = [1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

function clampLabelValue(v) {
  const s = String(v ?? "");
  return s.length > MAX_LABEL_VALUE_LEN ? s.slice(0, MAX_LABEL_VALUE_LEN) : s;
}

function labelKey(labelNames, labels) {
  if (labelNames.length === 0) return "";
  const parts = [];
  for (const n of labelNames) {
    parts.push(`${n}=${clampLabelValue(labels?.[n] ?? "")}`);
  }
  return parts.join(",");
}

function escapePromLabel(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labelNames, labels) {
  if (labelNames.length === 0) return "";
  const inner = labelNames.map((n) => `${n}="${escapePromLabel(labels?.[n] ?? "")}"`).join(",");
  return `{${inner}}`;
}

function formatSubsetLabels(pairs) {
  if (pairs.length === 0) return "";
  return `{${pairs.map(([k, v]) => `${k}="${escapePromLabel(v)}"`).join(",")}}`;
}

export function counter(o) {
  return getOrCreate({ ...o, kind: "counter" });
}

export function gauge(o) {
  return getOrCreate({ ...o, kind: "gauge" });
}

export function histogram(o) {
  return getOrCreate({ ...o, kind: "histogram", buckets: o.buckets });
}

function getOrCreate({ name, kind, help, labels, buckets }) {
  const existing = REGISTRY.get(name);
  if (existing) {

    return existing;
  }
  if (REGISTRY.size >= 512) {

    throw new Error(`metrics registry full (512 cap); cannot register "${name}"`);
  }
  const m = new Metric({ name, kind, help, labels, buckets });
  REGISTRY.set(name, m);

  applyPendingRestore(m);
  return m;
}

Metric.prototype.inc = function (labels, by = 1) {
  if (this.kind !== "counter") throw new Error(`${this.name}: inc() is counter-only`);
  const key = labelKey(this.labelNames, labels);
  if (this.series.size >= MAX_SERIES_PER_METRIC && !this.series.has(key)) {
    this.overflows++;
    return;
  }
  this.series.set(key, (this.series.get(key) ?? 0) + by);
};

Metric.prototype.set = function (labels, value) {
  if (this.kind !== "gauge") throw new Error(`${this.name}: set() is gauge-only`);
  const key = labelKey(this.labelNames, labels);
  if (this.series.size >= MAX_SERIES_PER_METRIC && !this.series.has(key)) {
    this.overflows++;
    return;
  }
  this.series.set(key, Number(value) || 0);
};

Metric.prototype.observe = function (labels, value) {
  if (this.kind !== "histogram") throw new Error(`${this.name}: observe() is histogram-only`);
  const key = labelKey(this.labelNames, labels);
  if (this.series.size >= MAX_SERIES_PER_METRIC && !this.series.has(key)) {
    this.overflows++;
    return;
  }
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  let entry = this.series.get(key);
  if (!entry) {

    entry = new Array(this.buckets.length + 1).fill(0);
    entry._sum = 0;
    entry._count = 0;
    this.series.set(key, entry);
  }
  for (let i = 0; i < this.buckets.length; i++) {
    if (v <= this.buckets[i]) entry[i]++;
  }
  entry[entry.length - 1]++;
  entry._sum += v;
  entry._count++;
};

Metric.prototype.value = function (labels) {
  return this.series.get(labelKey(this.labelNames, labels));
};

export function toPrometheus() {
  const out = [];
  for (const m of REGISTRY.values()) {
    out.push(`# HELP ${m.name} ${m.help}`);
    out.push(`# TYPE ${m.name} ${m.kind}`);
    if (m.kind === "histogram") {
      for (const [key, entry] of m.series) {
        const labels = parseLabelKey(key, m.labelNames);
        for (let i = 0; i < m.buckets.length; i++) {
          const le = String(m.buckets[i]);
          out.push(
            `${m.name}_bucket${formatSubsetLabels([...labelPairs(m.labelNames, labels), ["le", le]])} ${entry[i]}`,
          );
        }
        out.push(
          `${m.name}_bucket${formatSubsetLabels([...labelPairs(m.labelNames, labels), ["le", "+Inf"]])} ${entry[entry.length - 1]}`,
        );
        out.push(`${m.name}_sum${formatLabels(m.labelNames, labels)} ${entry._sum}`);
        out.push(`${m.name}_count${formatLabels(m.labelNames, labels)} ${entry._count}`);
      }
    } else {
      for (const [key, v] of m.series) {
        const labels = parseLabelKey(key, m.labelNames);
        out.push(`${m.name}${formatLabels(m.labelNames, labels)} ${v}`);
      }
    }
    if (m.overflows > 0) {
      out.push(`${m.name}_cardinality_overflow_total ${m.overflows}`);
    }
  }
  return out.join("\n") + "\n";
}

function labelPairs(labelNames, labels) {
  return labelNames.map((n) => [n, labels?.[n ?? ""] ?? ""]);
}

function parseLabelKey(key, labelNames) {
  if (!key) return {};
  const out = {};
  const parts = key.split(",");
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    const k = parts[i].slice(0, eq);
    out[k] = parts[i].slice(eq + 1);
  }
  return out;
}

import { getAdapter } from "../lib/db/driver.js";
import { stringifyJson, parseJson } from "../lib/db/helpers/jsonCol.js";

const META_KEY = "metrics.snapshot";

export async function persistMetrics() {
  try {
    const db = await getAdapter();
    const snap = { ts: Date.now(), metrics: {} };
    for (const m of REGISTRY.values()) {
      snap.metrics[m.name] = {
        kind: m.kind,
        overflows: m.overflows,
        series: Array.from(m.series.entries()).map(([k, v]) => [
          k,
          Array.isArray(v) ? { b: v.slice(), sum: v._sum ?? 0, count: v._count ?? 0 } : v,
        ]),
      };
    }
    db.run(
      `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [META_KEY, stringifyJson(snap)],
    );
  } catch (e) {

    console.error("[metrics:persist]", e?.message ?? e);
  }
}

export async function restoreMetrics() {
  try {
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [META_KEY]);
    if (!row?.value) return;
    const snap = parseJson(row.value, null);
    if (!snap?.metrics) return;

    PENDING_RESTORE = snap;
  } catch (e) {
    console.error("[metrics:restore]", e?.message ?? e);
  }
}

let PENDING_RESTORE = null;

function applyPendingRestore(m) {
  if (!PENDING_RESTORE) return;
  const saved = PENDING_RESTORE.metrics?.[m.name];
  if (!saved || saved.kind !== m.kind) return;
  m.overflows = saved.overflows ?? 0;
  for (const [k, v] of saved.series ?? []) {
    if (m.kind === "histogram") {
      const arr = v.b.slice();
      arr._sum = v.sum;
      arr._count = v.count;
      m.series.set(k, arr);
    } else {
      m.series.set(k, v);
    }
  }

  if (PENDING_RESTORE.metrics) delete PENDING_RESTORE.metrics[m.name];
}

/** @type {Metric} */ let httpRequestsTotal;
/** @type {Metric} */ let httpRequestDuration;
/** @type {Metric} */ let inFlightRequests;
/** @type {Metric} */ let proxyCallsTotal;
/** @type {Metric} */ let proxyCallDuration;
/** @type {Metric} */ let tokensTotal;
/** @type {Metric} */ let errorsTotal;
/** @type {Metric} */ let sseListeners;
/** @type {Metric} */ let sseListenerDropsTotal;
/** @type {Metric} */ let processRss;
/** @type {Metric} */ let walloColumn;
/** @type {Metric} */ let authFailuresTotal;
/** @type {Metric} */ let loginLockActive;
/** @type {Metric} */ let traceSpansTotal;
/** @type {Metric} */ let accountFallbackDecisionsTotal;
/** @type {Metric} */ let cacheAffineSelectionsTotal;
/** @type {Metric} */ let clientDetectionsTotal;
/** @type {Metric} */ let clientDetectionConflictsTotal;
/** @type {Metric} */ let compatFallbackStripsTotal;
/** @type {Metric} */ let routerActiveRequests;
/** @type {Metric} */ let routerQueuedRequests;
/** @type {Metric} */ let routerConcurrencyLimit;
/** @type {Metric} */ let routerBodyBytesInUse;
/** @type {Metric} */ let routerAdmissionRejectsTotal;

function registerStandardMetrics() {
  httpRequestsTotal = counter({
    name: "sway_http_requests_total",
    help: "Total HTTP requests handled by the gateway",
    labels: ["method", "route", "status"],
  });
  httpRequestDuration = histogram({
    name: "sway_http_request_duration_ms",
    help: "HTTP request handling latency in milliseconds",
    labels: ["method", "route"],
  });
  inFlightRequests = gauge({
    name: "sway_in_flight_requests",
    help: "Currently in-flight proxy requests",
  });
  proxyCallsTotal = counter({
    name: "sway_proxy_calls_total",
    help: "Upstream provider proxy calls",
    labels: ["provider", "model", "status"],
  });
  proxyCallDuration = histogram({
    name: "sway_proxy_call_duration_ms",
    help: "Upstream provider call latency in milliseconds",
    labels: ["provider", "model"],
  });
  tokensTotal = counter({
    name: "sway_tokens_total",
    help: "Tokens processed by kind (input/output/cached)",
    labels: ["kind", "provider"],
  });
  errorsTotal = counter({
    name: "sway_errors_total",
    help: "Gateway errors by class",
    labels: ["class", "provider"],
  });
  sseListeners = gauge({
    name: "sway_sse_listeners",
    help: "Active SSE listener registrations",
  });
  sseListenerDropsTotal = counter({
    name: "sway_sse_listeners_dropped_total",
    help: "SSE listener registrations rejected due to the cap",
  });
  processRss = gauge({
    name: "sway_process_rss_bytes",
    help: "Bun process resident set size in bytes",
  });
  walloColumn = gauge({

    name: "sway_write_behind_buffer_rows",
    help: "Rows pending in the usage write-behind buffer",
  });

  authFailuresTotal = counter({
    name: "sway_auth_failures_total",
    help: "Authentication failures by source (login/api-key/cli-token)",
    labels: ["source"],
  });
  loginLockActive = gauge({
    name: "sway_login_lock_active",
    help: "Dashboard login lockouts currently active",
    labels: [],
  });

  traceSpansTotal = counter({
    name: "sway_trace_spans_total",
    help: "W3C trace spans opened by origin (child=inbound parent present, root=fresh)",
    labels: ["kind"],
  });

  accountFallbackDecisionsTotal = counter({
    name: "sway_account_fallback_decisions_total",
    help: "Per-model account fallback decisions by tier (T1 rate-limit / T2 transient / T3 permanent)",
    labels: ["tier", "action"],
  });
  cacheAffineSelectionsTotal = counter({
    name: "sway_cache_affine_selections_total",
    help: "Cache-affine routing outcomes (hit=sticky bucket kept, rotate=primary bucket locked→next, miss=no input key)",
    labels: ["result"],
  });

  clientDetectionsTotal = counter({
    name: "sway_client_detections_total",
    help: "Client-identity resolutions by the multi-signal detector (A4.5)",
    labels: ["client", "signals"],
  });
  clientDetectionConflictsTotal = counter({
    name: "sway_client_detection_conflicts_total",
    help: "Requests where ≥2 detection channels disagreed on the client identity (A4.5)",
    labels: ["resolved", "conflicting"],
  });

  compatFallbackStripsTotal = counter({
    name: "sway_compat_fallback_strips_total",
    help: "Optional-parameter compat auto-fallback strips (A4.4): pre-strip vs retry vs cache-miss",
    labels: ["provider", "model", "action"],
  });
  routerActiveRequests = gauge({
    name: "sway_router_admission_active_requests",
    help: "Gateway requests currently holding an adaptive Router admission slot",
  });
  routerQueuedRequests = gauge({
    name: "sway_router_admission_queued_requests",
    help: "Gateway requests waiting for an adaptive Router admission slot",
  });
  routerConcurrencyLimit = gauge({
    name: "sway_router_admission_concurrency_limit",
    help: "Current adaptive Router admission target",
  });
  routerBodyBytesInUse = gauge({
    name: "sway_router_admission_body_bytes",
    help: "Request-body bytes retained by active gateway requests",
  });
  routerAdmissionRejectsTotal = counter({
    name: "sway_router_admission_rejects_total",
    help: "Gateway requests rejected by the adaptive Router admission guard",
    labels: ["reason"],
  });
}

registerStandardMetrics();

export {
  httpRequestsTotal,
  httpRequestDuration,
  inFlightRequests,
  proxyCallsTotal,
  proxyCallDuration,
  tokensTotal,
  errorsTotal,
  sseListeners,
  sseListenerDropsTotal,
  processRss,
  walloColumn as writeBehindBufferRows,
  authFailuresTotal,
  loginLockActive,
  traceSpansTotal,
  accountFallbackDecisionsTotal,
  cacheAffineSelectionsTotal,
  clientDetectionsTotal,
  clientDetectionConflictsTotal,
  compatFallbackStripsTotal,
  routerActiveRequests,
  routerQueuedRequests,
  routerConcurrencyLimit,
  routerBodyBytesInUse,
  routerAdmissionRejectsTotal,
};

export function recordHttpRequest(method, route, status, durationMs) {
  httpRequestsTotal.inc({ method, route, status: String(status) });
  httpRequestDuration.observe({ method, route }, durationMs);
}

export function sampleProcessStats() {
  try {
    const mem = process.memoryUsage?.();
    if (mem?.rss) processRss.set({}, mem.rss);
  } catch {

  }
}

export function __resetMetricsForTests() {
  REGISTRY.clear();
  PENDING_RESTORE = null;

  registerStandardMetrics();
}
