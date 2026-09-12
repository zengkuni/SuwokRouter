import { randomBytes } from "node:crypto";
import { cookieStoreAls } from "@/next/server";
import { traceSpansTotal } from "@/observability/metrics";

const TRACE_RE = /^[0-9a-f]{32}$/i;
const SPAN_RE = /^[0-9a-f]{16}$/i;
const FLAGS_RE = /^[0-9a-f]{2}$/i;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);
const TRACESTATE_MAX = 512;

export function parseTraceparent(header) {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== "00") return null;
  if (!TRACE_RE.test(traceId) || traceId === ZERO_TRACE) return null;
  if (!SPAN_RE.test(spanId) || spanId === ZERO_SPAN) return null;
  if (!FLAGS_RE.test(flags)) return null;
  const sampled = (parseInt(flags, 16) & 0x01) === 0x01;
  return { version, traceId, spanId, flags, sampled };
}

export function parseTracestate(header) {
  if (!header) return "";
  return String(header).slice(0, TRACESTATE_MAX);
}

export function newSpanId() {
  return randomBytes(8).toString("hex");
}

export function newTraceId() {
  return randomBytes(16).toString("hex");
}

export function createChildSpan(parent, opts = {}) {
  const traceId = parent?.traceId || newTraceId();
  const spanId = newSpanId();
  const flags = parent?.flags || "01";
  const sampled = parent?.sampled ?? true;
  return {
    version: "00",
    traceId,
    spanId,
    parentSpanId: parent?.spanId || null,
    flags,
    sampled,
    name: opts.name || "sway.proxy",
  };
}

export function ensureTraceContext(store, inboundTraceparent, inboundTracestate) {
  if (!store) return null;
  if (store.trace) return store.trace;
  const parent = parseTraceparent(inboundTraceparent);
  const span = createChildSpan(parent, {
    name: parent ? "sway.proxy.child" : "sway.proxy.root",
  });
  store.trace = {
    ...span,
    tracestate: parseTracestate(inboundTracestate),
    inbound: Boolean(parent),
  };
  try {
    traceSpansTotal.inc({ kind: parent ? "child" : "root" });
  } catch {

  }
  return store.trace;
}

export function getCurrentTrace() {
  const store = cookieStoreAls.getStore();
  return store?.trace || null;
}

export function getCurrentTraceId() {
  return getCurrentTrace()?.traceId || null;
}

export function outboundTraceparent() {
  const t = getCurrentTrace();
  if (!t) return null;
  return `${t.version || "00"}-${t.traceId}-${t.spanId}-${t.flags}`;
}

export function stampResponseWithTrace(response, trace) {
  if (!trace) return response;
  try {
    const headers = new Headers(response.headers);
    headers.set("x-swayrouter-trace-id", trace.traceId);
    headers.set("traceparent", `${trace.version || "00"}-${trace.traceId}-${trace.spanId}-${trace.flags}`);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

export function stampResponseTrace(response) {
  return stampResponseWithTrace(response, getCurrentTrace());
}
