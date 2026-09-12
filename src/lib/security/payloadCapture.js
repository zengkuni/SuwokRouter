import { getSettings } from "@/lib/db/repos/settingsRepo.js";

export const CAPTURE_MODES = ["none", "bounded", "sample", "error", "raw"];
const DEFAULT_MODE = "none";
const DEFAULT_SAMPLE_RATE = 0.01;

function resolveMode(settings) {
  const envMode = (process.env.SWAY_PAYLOAD_CAPTURE || "").toLowerCase();
  if (CAPTURE_MODES.includes(envMode)) return envMode;

  if (process.env.NODE_ENV === "production") {
    return settings?.payloadCaptureEnabled === true ? "error" : "none";
  }
  if (settings && typeof settings.payloadCaptureEnabled === "boolean") {
    return settings.payloadCaptureEnabled ? "raw" : "none";
  }
  return DEFAULT_MODE;
}

let cached = { mode: DEFAULT_MODE, sampleRate: DEFAULT_SAMPLE_RATE, ts: 0 };
const CACHE_TTL_MS = 5000;

export async function getCapturePolicy() {
  const now = Date.now();
  if (cached.ts && now - cached.ts < CACHE_TTL_MS) return cached;
  let mode = DEFAULT_MODE;
  let sampleRate = DEFAULT_SAMPLE_RATE;
  try {
    const s = await getSettings();
    mode = resolveMode(s);
    const sr = Number(s.payloadSampleRate);
    if (Number.isFinite(sr) && sr >= 0 && sr <= 1) sampleRate = sr;
    const envRate = parseFloat(process.env.SWAY_PAYLOAD_SAMPLE_RATE || "");
    if (Number.isFinite(envRate) && envRate >= 0 && envRate <= 1) sampleRate = envRate;
  } catch {

    mode = DEFAULT_MODE;
    sampleRate = DEFAULT_SAMPLE_RATE;
  }
  cached = { mode, sampleRate, ts: now };
  return cached;
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export async function shouldCaptureBody(status, traceId) {
  const policy = await getCapturePolicy();
  return decideWithPolicy(policy, status, traceId);
}

export function decideWithPolicy({ mode, sampleRate } = {}, status, traceId) {
  if (mode === "raw") return "raw";
  if (mode === "bounded") return "keep";
  if (mode === "error") return status && status !== "success" ? "keep" : "drop";
  if (mode === "sample") {
    if (sampleRate <= 0) return "drop";
    if (sampleRate >= 1) return "keep";
    const seed = traceId || "no-trace";

    return fnv1a(seed) / 0x100000000 < sampleRate ? "keep" : "drop";
  }

  return "drop";
}

export const BODY_FIELDS = ["request", "providerRequest", "providerResponse", "response"];

export function applyCaptureDecision(detail, decision) {
  if (decision === "keep" || decision === "raw") return detail;
  for (const f of BODY_FIELDS) {
    if (detail[f] != null) {
      detail[f] = { _redacted: "payload_capture_mode=none_or_miss", _field: f };
    }
  }
  return detail;
}

export function __resetPayloadCaptureForTests() {
  cached = { mode: DEFAULT_MODE, sampleRate: DEFAULT_SAMPLE_RATE, ts: 0 };
}
