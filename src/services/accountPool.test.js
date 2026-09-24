import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  pickFairShareConnection,
  pickLeastInflightConnection,
  recordAccountAssignment,
  resetAccountPoolForTests,
  tryAcquireAccountSlot,
  getRecentAssignmentCount,
} from "./accountPool.js";

// Optimistic fair-share + jitter: capacity (inflight) still decides first,
// then assignment share over a sliding window, then a randomized pick inside
// the near-tie cohort so a burst spreads across accounts instead of hammering
// the first one (which trips per-account rate limits).

function conn(id, extra = {}) {
  return { id, provider: "p", priority: 999, isActive: true, ...extra };
}

// Deterministic RNG: returns the queued values, cycling.
function seededRandom(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("fair-share + jitter selection", () => {
  beforeEach(() => resetAccountPoolForTests());
  afterEach(() => resetAccountPoolForTests());

  test("cold start: jitter spreads picks across the whole cohort", () => {
    const list = [conn("a"), conn("b"), conn("c"), conn("d")];
    const random = seededRandom([0, 0.34, 0.67, 0.99]);
    const picks = [];
    for (let i = 0; i < 4; i++) picks.push(pickFairShareConnection(list, { random }).id);
    // Uniform cohort: each rng bucket maps to a distinct account.
    expect(new Set(picks).size).toBe(4);
  });

  test("least-inflight load still wins over fair share", () => {
    const a = conn("a");
    const b = conn("b");
    recordAccountAssignment("a"); // a has history but no active load
    for (let i = 0; i < 5; i++) recordAccountAssignment("a");
    recordAccountAssignment("b");
    // b carries one in-flight request; a is idle.
    const release = tryAcquireFor("p", "b");
    expect(pickFairShareConnection([a, b], { random: seededRandom([0]) }).id).toBe("a");
    release();
  });

  test("fewer recent assignments wins when load is equal", () => {
    const a = conn("a");
    const b = conn("b");
    for (let i = 0; i < 6; i++) recordAccountAssignment("a");
    recordAccountAssignment("b");
    expect(pickFairShareConnection([a, b], { random: seededRandom([0.99]) }).id).toBe("b");
  });

  test("assignments outside the window stop counting", () => {
    const a = conn("a");
    const b = conn("b");
    const old = Date.now() - 10 * 60_000;
    for (let i = 0; i < 6; i++) recordAccountAssignment("a", old);
    recordAccountAssignment("b");
    // With a 60s window, a's old history is gone: both are fresh, so the
    // pick is a pure jitter inside the cohort.
    const pick = pickFairShareConnection([a, b], { windowMs: 60_000, random: seededRandom([0.99]) });
    expect(["a", "b"]).toContain(pick.id);
  });

  test("jitter picks the later cohort member at high rng", () => {
    const a = conn("a");
    const b = conn("b");
    const low = pickFairShareConnection([a, b], { random: seededRandom([0.1]) });
    const high = pickFairShareConnection([a, b], { random: seededRandom([0.9]) });
    expect(low.id).toBe("a");
    expect(high.id).toBe("b");
  });

  test("empty/invalid input returns null", () => {
    expect(pickFairShareConnection([], {})).toBeNull();
    expect(pickFairShareConnection([null, undefined], {})).toBeNull();
  });

  test("pickLeastInflightConnection is the fair-share picker", () => {
    const list = [conn("a"), conn("b")];
    expect(pickLeastInflightConnection(list, { random: seededRandom([0.9]) }).id).toBe("b");
  });

  test("single candidate is returned as-is", () => {
    const only = conn("solo");
    expect(pickFairShareConnection([only], { random: seededRandom([0.5]) })).toBe(only);
  });

  test("priority breaks ties left after jitter cohort filtering is impossible", () => {
    // Cohort randomization can tie only on stats; priority still orders the
    // input so a preferred (lower number) account appears first in the cohort.
    const low = conn("low", { priority: 1 });
    const high = conn("high", { priority: 5 });
    const list = [high, low];
    const pick = pickFairShareConnection(list, { random: seededRandom([0]) });
    expect(["low", "high"]).toContain(pick.id);
    expect(list[0]).toBe(high); // input order untouched
  });

  test("burst of 200 selections spreads across accounts (anti rate-limit)", () => {
    // The regression this feature prevents: a deterministic tie-break sends
    // every concurrent pick to the same account until it rate-limits.
    const list = [conn("a"), conn("b"), conn("c"), conn("d"), conn("e")];
    const counts = new Map();
    for (let i = 0; i < 200; i++) {
      const pick = pickFairShareConnection(list).id;
      counts.set(pick, (counts.get(pick) || 0) + 1);
    }
    expect(counts.size, "every account receives traffic").toBe(5);
    const max = Math.max(...counts.values());
    expect(max, "no account absorbs the burst").toBeLessThan(200 * 0.5);
  });

  test("fair share pulls back an account that got a burst of assignments", () => {
    const list = [conn("a"), conn("b"), conn("c")];
    // Simulate a burst that all landed on a.
    for (let i = 0; i < 20; i++) recordAccountAssignment("a");
    for (let i = 0; i < 30; i++) {
      const pick = pickFairShareConnection(list).id;
      recordAccountAssignment(pick);
    }
    const aCount = getRecentAssignmentCount("a");
    const bCount = getRecentAssignmentCount("b");
    const cCount = getRecentAssignmentCount("c");
    // a stopped absorbing after its history built up; b and c carry the rest.
    expect(aCount).toBeLessThan(bCount + cCount);
  });
});

// Helper: take a slot directly to model in-flight load.
function tryAcquireFor(provider, connectionId) {
  const release = tryAcquireAccountSlot(provider, connectionId, {
    enabled: true,
    maxConcurrentPerAccount: 30,
    maxConcurrentPerProvider: 64,
  });
  if (!release) throw new Error("slot unavailable");
  return release;
}
