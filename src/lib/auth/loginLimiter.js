import { authFailuresTotal, loginLockActive } from "@/observability/metrics.js";
import { env } from "@/lib/env";

const MAX_FAILS_BEFORE_LOCK = 5;
const LOCK_STEPS_MS = [30_000, 120_000, 600_000, 1_800_000];
const FAIL_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_IPS = 10_000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const attempts = new Map();

function now() { return Date.now(); }

function getEntry(ip) {
  const e = attempts.get(ip);
  if (!e) return null;

  if (e.lastFailAt && now() - e.lastFailAt > FAIL_WINDOW_MS && (!e.lockUntil || now() >= e.lockUntil)) {
    attempts.delete(ip);
    return null;
  }
  return e;
}

function sweepExpiredEntries(at = now()) {
  for (const [ip, entry] of attempts) {
    const locked = entry.lockUntil && at < entry.lockUntil;
    const expired = entry.lastFailAt && at - entry.lastFailAt > FAIL_WINDOW_MS;
    if (!locked && expired) attempts.delete(ip);
  }
}

function ensureCapacity(ip) {
  if (attempts.has(ip)) return;
  sweepExpiredEntries();
  if (attempts.size < MAX_TRACKED_IPS) return;

  const oldest = attempts.keys().next().value;
  if (oldest !== undefined) attempts.delete(oldest);
}

const limiterSweep = setInterval(() => sweepExpiredEntries(), SWEEP_INTERVAL_MS);
limiterSweep.unref?.();

export function checkLock(ip) {
  const e = getEntry(ip);
  if (!e || !e.lockUntil) return { locked: false };
  const remaining = e.lockUntil - now();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

export function recordFail(ip) {
  const e = getEntry(ip) || { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
  e.fails += 1;
  e.lastFailAt = now();

  try { authFailuresTotal.inc({ source: "login" }); } catch {}

  let locked = false;
  if (e.fails >= MAX_FAILS_BEFORE_LOCK) {
    const step = LOCK_STEPS_MS[Math.min(e.lockLevel, LOCK_STEPS_MS.length - 1)];
    e.lockUntil = now() + step;
    e.lockLevel += 1;
    e.fails = 0;
    locked = true;
    try { loginLockActive.set({}, 1); } catch {}

  }
  ensureCapacity(ip);
  attempts.set(ip, e);
  return { remainingBeforeLock: Math.max(0, MAX_FAILS_BEFORE_LOCK - e.fails), locked, retryAfter: locked ? Math.ceil((e.lockUntil - now()) / 1000) : undefined };
}

export function recordSuccess(ip) {
  attempts.delete(ip);
  try { loginLockActive.set({}, 0); } catch {}
}

export function getClientIp(request) {

  const realIp = request.headers.get("x-swayrouter-real-ip");
  if (realIp) return realIp;

  if (env.trustProxy && request.headers.get("x-swayrouter-via-proxy") === "1") {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }

  return "unknown";
}

export function __resetLoginLimiterForTests() {
  attempts.clear();
}

export function __getLoginLimiterSizeForTests() {
  return attempts.size;
}
