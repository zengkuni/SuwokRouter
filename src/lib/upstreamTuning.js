import { env } from "@/lib/env";
import { FETCH_CONNECT_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS } from "@/config/runtimeConfig.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";

export const UPSTREAM_TIMEOUT_MS_MIN = 1_000;
export const UPSTREAM_TIMEOUT_MS_MAX = 600_000;
export const UPSTREAM_MAX_ATTEMPTS_MIN = 1;
export const UPSTREAM_MAX_ATTEMPTS_MAX = 100;
export const UPSTREAM_STREAM_TIMEOUT_MS_MIN = 1_000;
export const UPSTREAM_STREAM_TIMEOUT_MS_MAX = 3_600_000;

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function normalizeUpstreamTimeoutMs(value) {
  if (value === null || value === undefined || value === "") return null;
  return clampInt(value, UPSTREAM_TIMEOUT_MS_MIN, UPSTREAM_TIMEOUT_MS_MAX);
}

export function normalizeUpstreamMaxAttempts(value) {
  if (value === null || value === undefined || value === "") return null;
  return clampInt(value, UPSTREAM_MAX_ATTEMPTS_MIN, UPSTREAM_MAX_ATTEMPTS_MAX);
}
export function normalizeUpstreamStreamTimeoutMs(value) {
  if (value === null || value === undefined || value === "") return null;
  return clampInt(value, UPSTREAM_STREAM_TIMEOUT_MS_MIN, UPSTREAM_STREAM_TIMEOUT_MS_MAX);
}


export function resolveUpstreamTuning(settings = null) {
  const timeoutMs = normalizeUpstreamTimeoutMs(settings?.upstreamTimeoutMs) ?? FETCH_CONNECT_TIMEOUT_MS;
  const maxAttempts = normalizeUpstreamMaxAttempts(settings?.upstreamMaxAttempts)
    ?? clampInt(env.upstreamMaxAttempts, UPSTREAM_MAX_ATTEMPTS_MIN, UPSTREAM_MAX_ATTEMPTS_MAX)
    ?? 8;
  const streamTimeoutMs = normalizeUpstreamStreamTimeoutMs(settings?.upstreamStreamTimeoutMs)
    ?? STREAM_STALL_TIMEOUT_MS;
  return { timeoutMs, maxAttempts, streamTimeoutMs };
}

export async function getUpstreamTuning(log = null) {
  try {
    return resolveUpstreamTuning(await getSettings());
  } catch (error) {
    log?.debug?.("UPSTREAM", `tuning fallback to defaults: ${error.message}`);
    return resolveUpstreamTuning(null);
  }
}
