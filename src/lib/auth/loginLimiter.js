import { authFailuresTotal, loginLockActive } from "@/observability/metrics.js";
import { env } from "@/lib/env";
import { ttlGetRaw, ttlSetRaw, ttlDel } from "../cache/ttlStore.js";

const MAX_FAILS_BEFORE_LOCK = 5;
const LOCK_STEPS_MS = [30_000, 120_000, 600_000, 1_800_000];
const FAIL_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_IPS = 10_000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const attempts = new Map();

function now() { return Date.now(); }

// Cross-process mirror of each IP's lockout state in the shared store
// (Valkey when configured, memory otherwise). The local Map stays the hot
// path with its capacity bound; the mirror makes a lockout set by one
// process visible to the others until it expires.
function sharedKey(ip) {
  return `login:ip:${ip}`;
}

function entryTtlMs(e) {
  const base = Math.max(0, (e.lastFailAt || 0) + FAIL_WINDOW_MS - now());
  const locked = Math.max(0, (e.lockUntil || 0) - now());
  return Math.max(base, locked, 1000);
}

async function readShared(ip) {
  try {
    const raw = await ttlGetRaw(sharedKey(ip));
    if (!raw) return null;
    const e = JSON.parse(raw);
    return e && typeof e === "object" ? e : null;
  } catch {
    return null;
  }
}

async function writeShared(ip, e) {
  try { await ttlSetRaw(sharedKey(ip), JSON.stringify(e), entryTtlMs(e)); } catch {}
}

async function deleteShared(ip) {
  try { await ttlDel(sharedKey(ip)); } catch {}
}

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

export async function checkLock(ip) {
  let e = getEntry(ip);
  if (!e) e = await readShared(ip);
  if (!e || !e.lockUntil) return { locked: false };
  const remaining = e.lockUntil - now();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

export async function recordFail(ip) {
  let local = getEntry(ip);
  if (!local) local = await readShared(ip);
  const e = local || { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
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
  await writeShared(ip, e);
  return { remainingBeforeLock: Math.max(0, MAX_FAILS_BEFORE_LOCK - e.fails), locked, retryAfter: locked ? Math.ceil((e.lockUntil - now()) / 1000) : undefined };
}

export async function recordSuccess(ip) {
  attempts.delete(ip);
  await deleteShared(ip);
  try { loginLockActive.set({}, 0); } catch {}
}

export function getClientIp(request) {

  const realIp = request.headers.get("x-suwokrouter-real-ip");
  if (realIp) return realIp;

  if (env.trustProxy && request.headers.get("x-suwokrouter-via-proxy") === "1") {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }

  return "unknown";
}

export async function __resetLoginLimiterForTests() {
  attempts.clear();
  // Best-effort clear of the cross-process mirror so suites start clean.
  try {
    const { getRedis, isRedisAvailable } = await import("../cache/redisClient.js");
    const redis = getRedis();
    if (redis && isRedisAvailable()) {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", "login:ip:*", "COUNT", 200);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== "0");
    } else {
      const { resetTtlStore } = await import("../cache/ttlStore.js");
      resetTtlStore();
    }
  } catch {}
}

export function __getLoginLimiterSizeForTests() {
  return attempts.size;
}
