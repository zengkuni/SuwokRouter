import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  classifyError,
  ERROR_TIERS,
  isDeprioitized,
} from "@/config/errorConfig.js";
import {
  isModelLockActive,
  buildModelLockUpdate,
  getModelLockKey,
  pickCacheAffine,
  extractCacheKey,
  sortWithDeprioritization,
  isDeprioritized,
  DEPRIORITIZE_FIELD,
  buildDeprioritizeUpdate,
} from "./accountFallback.js";
import {
  recordLock,
  clearLock,
  clearAllLocksForConnection,
  getActiveLocks,
  isLocked,
  countActiveLocks,
  reapExpired,
} from "@/lib/db/repos/accountModelLocksRepo.js";
import { initDb } from "@/lib/db/index.js";
import { getAdapter } from "@/lib/db/driver.js";

const now = () => Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(async () => {
  await initDb();

  try {
    const db = await getAdapter();
    db.run(`DELETE FROM account_model_locks`);
  } catch {

  }
});
afterEach(() => {});

describe("A4.2 classifyError — 3-tier T1/T2/T3", () => {
  test("T1: rate-limit text + 429 status → cooldown action, capped exponential + jitter", () => {
    const r0 = classifyError(429, "Rate limit exceeded", 0);
    expect(r0.tier).toBe(ERROR_TIERS.T1);
    expect(r0.action).toBe("cooldown");

    expect(r0.cooldownMs).toBe(30 * 1000);

    const r3 = classifyError(429, "Rate limit exceeded", 3);

    expect(r3.cooldownMs).toBe(240 * 1000);

    const r20 = classifyError(429, "too many requests", 20);
    expect(r20.cooldownMs).toBeLessThanOrEqual(5 * 60 * 1000);

    const rt = classifyError(200, "quota exceeded", 1);
    expect(rt.tier).toBe(ERROR_TIERS.T1);
    expect(rt.action).toBe("cooldown");
  });

  test("T1: jitter adds spread but stays within [base, base + 25%]", () => {
    const rng = () => 1;
    const r = classifyError(429, "rate limit", 0, { rng });

    expect(r.cooldownMs).toBe(30 * 1000 + Math.floor(30 * 1000 * 0.25));
    const rZero = classifyError(429, "rate limit", 0, { rng: () => 0 });
    expect(rZero.cooldownMs).toBe(30 * 1000);
  });

  test("T2: 5xx / network / 400 → retry-same action with short cooldown", () => {
    const r500 = classifyError(500, "internal server error", 0);
    expect(r500.tier).toBe(ERROR_TIERS.T2);
    expect(r500.action).toBe("retry-same");
    expect(r500.cooldownMs).toBeGreaterThan(0);
    expect(r500.deprioitizeUntil).toBeUndefined();

    const r503 = classifyError(503, "service unavailable", 0);
    expect(r503.tier).toBe(ERROR_TIERS.T2);

    const rUnknown = classifyError(0, "ECONNRESET", 0);
    expect(rUnknown.tier).toBe(ERROR_TIERS.T2);
  });

  test("T3: 401/403/404 + permanent text → deprioritize action + deprioitizeUntil window", () => {
    const r401 = classifyError(401, "invalid api key", 0);
    expect(r401.tier).toBe(ERROR_TIERS.T3);
    expect(r401.action).toBe("deprioritize");
    expect(r401.deprioitizeUntil).toBeGreaterThan(now());

    expect(r401.deprioitizeUntil! - now()).toBeGreaterThan(r401.cooldownMs);

    const r403 = classifyError(403, "insufficient_quota", 0);
    expect(r403.tier).toBe(ERROR_TIERS.T3);
    expect(r403.action).toBe("deprioritize");

    const rt = classifyError(0, "no credentials available", 0);
    expect(rt.tier).toBe(ERROR_TIERS.T3);
  });

  test("isDeprioitized respects the window boundary", () => {
    expect(isDeprioitized(now() + 60_000)).toBe(true);
    expect(isDeprioitized(now() - 1)).toBe(false);
    expect(isDeprioitized(undefined as any)).toBe(false);
  });
});

describe("A4.2 per-model lock — no leak across models", () => {
  test("locking claude/sonnet-4 does not lock claude/haiku-4 on the same connection", () => {
    const conn = buildModelLockUpdate("claude/sonnet-4", 60_000);
    const connection = { id: "c1", ...conn } as any;
    expect(isModelLockActive(connection, "claude/sonnet-4")).toBe(true);
    expect(isModelLockActive(connection, "claude/haiku-4")).toBe(false);
    expect(isModelLockActive(connection, null)).toBe(false);
  });

  test("account-level lock (__all) locks every model + reads back", () => {
    const conn = buildModelLockUpdate(null, 30_000);
    const connection = { id: "c2", ...conn } as any;
    expect(isModelLockActive(connection, "claude/sonnet-4")).toBe(true);
    expect(isModelLockActive(connection, "claude/haiku-4")).toBe(true);
    expect(isModelLockActive(connection, null)).toBe(true);
  });

  test("expired model lock is treated as inactive (lazy reap on read)", () => {
    const conn = buildModelLockUpdate("claude/sonnet-4", -1000);
    const connection = { id: "c3", ...conn } as any;
    expect(isModelLockActive(connection, "claude/sonnet-4")).toBe(false);
  });

  test("getModelLockKey sentinel + model form", () => {
    expect(getModelLockKey("claude/sonnet-4")).toBe("modelLock_claude/sonnet-4");
    expect(getModelLockKey(null)).toBe("modelLock___all");
    expect(getModelLockKey(undefined as any)).toBe("modelLock___all");
  });
});

describe("A4.2 cache-affine routing — sticky → rotate-to-next", () => {
  test("deterministic: same key + same set always picks the same connection", () => {
    const conns = [
      { id: "a", priority: 1 },
      { id: "b", priority: 2 },
      { id: "c", priority: 3 },
    ] as any;
    const p1 = pickCacheAffine(conns, { cacheKey: "prompt-prefix-A" });
    const p2 = pickCacheAffine(conns, { cacheKey: "prompt-prefix-A" });
    expect(p1.connection?.id).toBe(p2.connection?.id);

    const p3 = pickCacheAffine(conns, { cacheKey: "prompt-prefix-B" });
    expect(p3.connection).not.toBeNull();
  });

  test("no cacheKey → affinity=miss, deterministic by survivor set", () => {
    const conns = [{ id: "x" }, { id: "y" }] as any;
    const r = pickCacheAffine(conns, {});
    expect(r.affinity).toBe("miss");
    expect(r.connection?.id).toBe("x");
  });

  test("sticky hit: primary bucket not excluded → stays (affinity=hit)", () => {
    const key = "stable-prefix";
    const conns = [{ id: "a" }, { id: "b" }, { id: "c" }] as any;
    const first = pickCacheAffine(conns, { cacheKey: key });

    const second = pickCacheAffine(conns, { cacheKey: key, excludeIds: new Set() });
    expect(second.connection?.id).toBe(first.connection?.id);
    expect(second.affinity).toBe("hit");
  });

  test("rotate-to-next: primary excluded → re-bucket against survivors (affinity=rotate)", () => {
    const key = "stable-prefix";
    const conns = [{ id: "a" }, { id: "b" }, { id: "c" }] as any;
    const first = pickCacheAffine(conns, { cacheKey: key });
    const primaryId = first.connection!.id;

    const rotated = pickCacheAffine(conns, { cacheKey: key, excludeIds: new Set([primaryId]) });
    expect(rotated.affinity).toBe("rotate");
    expect(rotated.connection?.id).not.toBe(primaryId);

    expect(rotated.connection).not.toBeNull();
  });

  test("2-account provider: when primary locks, prefix rotates to the OTHER account", () => {

    const conns = [{ id: "alpha" }, { id: "beta" }] as any;
    const key = "shared-prefix";
    const first = pickCacheAffine(conns, { cacheKey: key });
    const primary = first.connection!.id;
    const rotated = pickCacheAffine(conns, { cacheKey: key, excludeIds: new Set([primary]) });
    const survivorId = rotated.connection!.id;
    expect(survivorId).not.toBe(primary);
    expect(survivorId).toBe(primary === "alpha" ? "beta" : "alpha");
  });

  test("all excluded → no connection", () => {
    const conns = [{ id: "a" }] as any;
    const r = pickCacheAffine(conns, { cacheKey: "k", excludeIds: new Set(["a"]) });
    expect(r.connection).toBeNull();
  });
});

describe("A4.2 extractCacheKey — format-agnostic", () => {
  test("OpenAI/Anthropic messages (string content)", () => {
    const key = extractCacheKey({ messages: [{ role: "user", content: "Write a haiku about the sea" }] } as any);
    expect(key).toBe("Write a haiku about the sea");
  });

  test("Anthropic content blocks (array of {type,text})", () => {
    const key = extractCacheKey({ messages: [{ role: "user", content: [{ type: "text", text: "Multi-block prompt head" }] }] } as any);
    expect(key).toBe("Multi-block prompt head");
  });

  test("Gemini contents[].parts[].text", () => {
    const key = extractCacheKey({ contents: [{ parts: [{ text: "Gemini prefix head" }] }] } as any);
    expect(key).toBe("Gemini prefix head");
  });

  test("plain prompt / input", () => {
    expect(extractCacheKey({ prompt: "plain prompt" } as any)).toBe("plain prompt");
    expect(extractCacheKey({ input: "plain input" } as any)).toBe("plain input");
  });

  test("truncates to 256 chars + returns null on empty", () => {
    const long = "x".repeat(1000);
    expect(extractCacheKey({ prompt: long } as any)?.length).toBe(256);
    expect(extractCacheKey({} as any)).toBeNull();
    expect(extractCacheKey(null as any)).toBeNull();
    expect(extractCacheKey({ messages: [] } as any)).toBeNull();
  });
});

describe("A4.2 account_model_locks ledger — dual-write/clear/reap", () => {
  test("recordLock + isLocked + getActiveLocks (per-model, no leak)", async () => {
    await recordLock("conn-A", "claude/sonnet-4", { tier: "T1", reason: "rate limit", expiresAt: iso(now() + 60_000) });
    expect(await isLocked("conn-A", "claude/sonnet-4")).toBe(true);

    expect(await isLocked("conn-A", "claude/haiku-4")).toBe(false);
    const active = await getActiveLocks({ connectionId: "conn-A" });
    expect(active.length).toBe(1);
    expect(active[0]?.tier).toBe("T1");
    expect(active[0]?.reason).toBe("rate limit");
  });

  test("clearLock removes a single model; clearAllLocksForConnection removes all", async () => {
    await recordLock("conn-B", "claude/sonnet-4", { tier: "T1", reason: "rl", expiresAt: iso(now() + 60_000) });
    await recordLock("conn-B", "claude/haiku-4", { tier: "T2", reason: "5xx", expiresAt: iso(now() + 60_000) });
    expect(await countActiveLocks()).toBe(2);
    await clearLock("conn-B", "claude/sonnet-4");
    expect(await isLocked("conn-B", "claude/sonnet-4")).toBe(false);
    expect(await isLocked("conn-B", "claude/haiku-4")).toBe(true);
    await clearAllLocksForConnection("conn-B");
    expect(await countActiveLocks()).toBe(0);
  });

  test("account-wide lock uses __all sentinel (UNIQUE constraint holds)", async () => {
    await recordLock("conn-C", null, { tier: "T1", reason: "github monthly", expiresAt: iso(now() + 60_000) });
    expect(await isLocked("conn-C", "claude/sonnet-4")).toBe(true);
    expect(await isLocked("conn-C", "claude/haiku-4")).toBe(true);

    await recordLock("conn-C", null, { tier: "T1", reason: "rl2", expiresAt: iso(now() + 120_000) });
    const active = await getActiveLocks({ connectionId: "conn-C" });
    expect(active.length).toBe(1);
    expect(active[0]?.reason).toBe("rl2");
  });

  test("reapExpired deletes only expired rows", async () => {
    await recordLock("conn-D", "m1", { tier: "T1", reason: "rl", expiresAt: iso(now() - 10_000) });
    await recordLock("conn-D", "m2", { tier: "T1", reason: "rl", expiresAt: iso(now() + 60_000) });
    expect(await countActiveLocks()).toBe(1);
    await reapExpired();
    const db = await getAdapter();
    const row = db.get(`SELECT COUNT(*) AS c FROM account_model_locks WHERE connectionId = ?`, ["conn-D"]);
    expect(row?.c).toBe(1);
  });
});

describe("A4.2 T3 deprioritization — sort + lift", () => {
  test("sortWithDeprioritization sinks deprioritized credentials to the bottom", () => {
    const conns = [
      { id: "low-prio-but-clean", priority: 5 },
      { id: "high-prio-deprioritized", priority: 1, [DEPRIORITIZE_FIELD]: now() + 60_000 },
      { id: "mid-prio-clean", priority: 3 },
    ] as any;
    const sorted = sortWithDeprioritization(conns);
    expect(sorted[sorted.length - 1]!.id).toBe("high-prio-deprioritized");

    expect(sorted[0]!.id).toBe("mid-prio-clean");
    expect(sorted[1]!.id).toBe("low-prio-but-clean");
  });

  test("isDeprioritized + buildDeprioritizeUpdate/clear", () => {
    const deprioritizeUntil = now() + 60_000;
    expect(isDeprioritized(null as any)).toBe(false);
    expect(isDeprioritized({ [DEPRIORITIZE_FIELD]: deprioritizeUntil } as any)).toBe(true);
    expect(isDeprioritized({ [DEPRIORITIZE_FIELD]: now() - 1 } as any)).toBe(false);
    expect(buildDeprioritizeUpdate(deprioritizeUntil)).toEqual({ deprioritizeUntil });
    expect(buildDeprioritizeUpdate(0)).toEqual({ deprioritizeUntil: null });
  });
});
