import { describe, expect, it } from "bun:test";
import { parseGrokCliBilling } from "./grok-cli.js";
import { decodeGrokCreditsFrame } from "./grokCliQuotaFrame.js";

const LIVE_UNIFIED_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-09-22T00:00:00+00:00",
      end: "2026-09-29T00:00:00+00:00",
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    topUpMethod: "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
    billingPeriodStart: "2026-09-22T00:00:00+00:00",
    billingPeriodEnd: "2026-09-29T00:00:00+00:00",
  },
};

const LIVE_USER = {
  userId: "bd08e931-0849-44d6-aa12-10b1861680e4",
  email: "toyibnganjuk@gmail.com",
  hasGrokCodeAccess: true,
  subscriptionTier: null,
};

describe("Grok CLI billing parsing", () => {
  it("does not fabricate an exhausted On-demand quota for unified-billing users", () => {
    const result = parseGrokCliBilling(LIVE_UNIFIED_BILLING, LIVE_USER);

    expect(result.quotas).toEqual({});
    expect(result.subscriptionAccess).toBe(true);
    expect(result.periodEnd).toBe("2026-09-29T00:00:00.000Z");
  });

  it("treats a zero on-demand cap with zero usage as no quota even without a subscription", () => {
    const result = parseGrokCliBilling(
      {
        config: {
          currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-29T00:00:00+00:00" },
          onDemandCap: { val: 0 },
          onDemandUsed: { val: 0 },
        },
      },
      null,
    );

    expect(result.quotas).toEqual({});
    expect(result.subscriptionAccess).toBe(false);
  });

  it("keeps a real on-demand cap/usage pair as a USD quota", () => {
    const result = parseGrokCliBilling({
      config: {
        onDemandCap: { val: 500 },
        onDemandUsed: { val: 120 },
        billingPeriodEnd: "2026-10-01T00:00:00Z",
      },
    });

    expect(result.quotas["On-demand"]).toMatchObject({ used: 1.2, total: 5, unit: "USD" });
    expect(result.quotas["On-demand"].remainingPercentage).toBeCloseTo(76);
  });

  it("falls back to the deprecated used field when included/total usage is absent", () => {
    const result = parseGrokCliBilling({
      config: {
        monthlyLimit: { val: 1000 },
        used: { val: 250 },
        billingPeriodEnd: "2026-10-01T00:00:00Z",
      },
    });

    expect(result.quotas["Monthly included"]).toMatchObject({ used: 2.5, total: 10, unit: "USD" });
  });

  it("prefers creditUsagePercent and derives the Weekly SuperGrok quota for paid tiers", () => {
    const result = parseGrokCliBilling(
      {
        config: {
          creditUsagePercent: 12.5,
          monthlyLimit: { val: 1000 },
          used: { val: 900 },
          currentPeriod: { end: "2026-09-29T00:00:00+00:00" },
        },
      },
      null,
      null,
      { subscription_tier_display: "SuperGrok" },
    );

    expect(result.isFree).toBe(false);
    expect(result.quotas["Weekly SuperGrok"]).toMatchObject({ used: 12.5, total: 100 });
    expect(result.periodEnd).toBe("2026-09-29T00:00:00.000Z");
  });

  it("keeps the prepaid balance as a full-remaining USD quota", () => {
    const result = parseGrokCliBilling({ config: { prepaidBalance: { val: 250 } } });

    expect(result.quotas.Prepaid).toMatchObject({ used: 0, total: 2.5, unit: "USD" });
    expect(result.quotas.Prepaid.remainingPercentage).toBe(100);
  });

  it("shows metered spend instead of a fake weekly pool for free accounts", () => {
    const result = parseGrokCliBilling(
      {
        // ?format=credits: weekly window with a default (unused) percent
        ...LIVE_UNIFIED_BILLING,
        config: {
          ...LIVE_UNIFIED_BILLING.config,
          creditUsagePercent: 0,
        },
      },
      LIVE_USER,
      {
        // plain /v1/billing: the real metered ledger for the cycle
        config: {
          monthlyLimit: { val: 0 },
          used: { val: 813 },
          onDemandCap: { val: 0 },
          billingPeriodStart: "2026-09-01T00:00:00+00:00",
          billingPeriodEnd: "2026-10-01T00:00:00+00:00",
        },
      },
      { subscription_tier_display: "Free" },
    );

    expect(result.isFree).toBe(true);
    expect(result.plan).toBe("Free");
    expect(result.quotas["Weekly SuperGrok"]).toBeUndefined();
    expect(result.quotas["Monthly included"]).toBeUndefined();
    expect(result.quotas["Monthly metered"]).toMatchObject({
      used: 8.13,
      total: 0,
      unit: "USD",
      unlimited: true,
    });
  });

  it("keeps the weekly pool for paid tiers even when the ledger has spend", () => {
    const result = parseGrokCliBilling(
      {
        config: {
          creditUsagePercent: 42,
          monthlyLimit: { val: 1000 },
          used: { val: 813 },
          billingPeriodEnd: "2026-10-01T00:00:00Z",
        },
      },
      null,
      {
        config: {
          monthlyLimit: { val: 1000 },
          used: { val: 813 },
          billingPeriodEnd: "2026-10-01T00:00:00Z",
        },
      },
      { subscription_tier_display: "SuperGrok" },
    );

    expect(result.quotas["Weekly SuperGrok"]).toMatchObject({ used: 42, total: 100 });
    expect(result.quotas["Monthly included"]).toMatchObject({ used: 8.13, total: 10, unit: "USD" });
    expect(result.quotas["Monthly metered"]).toBeUndefined();
  });
});

describe("Grok CLI tier resolution", () => {
  function tokenWithTier(tier) {
    const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    return `${encode({ alg: "RS256" })}.${encode({ sub: "u", tier })}.sig`;
  }

  it("reads the tier from the JWT claim when no endpoint populates it", () => {
    const result = parseGrokCliBilling(
      {
        config: {
          creditUsagePercent: 5,
          monthlyLimit: { val: 0 },
          used: { val: 0 },
        },
      },
      null,
      null,
      null,
      tokenWithTier(1),
    );

    expect(result.tier).toBe("SuperGrok");
    expect(result.tierSource).toBe("endpoint");
    expect(result.isFree).toBe(false);
    expect(result.quotas["Weekly SuperGrok"]).toMatchObject({ used: 5, total: 100 });
  });

  it("accepts a string tier claim", () => {
    const result = parseGrokCliBilling(
      { config: { used: { val: 0 } } },
      null,
      null,
      null,
      tokenWithTier("supergrok"),
    );

    expect(result.tier).toBe("supergrok");
    expect(result.isFree).toBe(false);
  });

  it("infers free from an all-zero billing snapshot with no plan name", () => {
    const result = parseGrokCliBilling({
      config: {
        monthlyLimit: { val: 0 },
        used: { val: 0 },
        onDemandCap: { val: 0 },
        prepaidBalance: { val: 0 },
        isUnifiedBillingUser: true,
      },
    });

    expect(result.tierSource).toBe("inferred");
    expect(result.isFree).toBe(true);
    expect(result.quotas["Weekly SuperGrok"]).toBeUndefined();
  });

  it("treats any positive paid field as a paid signal despite no tier", () => {
    const result = parseGrokCliBilling({
      config: { monthlyLimit: { val: 1000 }, used: { val: 250 } },
    });

    expect(result.tierSource).toBe("unknown");
    expect(result.isFree).toBe(false);
    expect(result.quotas["Monthly included"]).toMatchObject({ used: 2.5, total: 10 });
  });

  it("does not infer free from a payload that carries no billing fields", () => {
    const result = parseGrokCliBilling({ config: {} });

    expect(result.tierSource).toBe("unknown");
    expect(result.isFree).toBe(false);
  });
});

describe("Grok CLI gRPC credits frame decoding", () => {
  function buildFrame(payload) {
    const header = Buffer.alloc(5);
    header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]);
  }

  function buildTimestampMessage(epochSeconds) {
    const timestamp = Buffer.alloc(2 + 6);
    timestamp[0] = (1 << 3) | 0;
    let pos = 1;
    let value = epochSeconds;
    do {
      let byte = value & 0x7f;
      value >>>= 7;
      if (value) byte |= 0x80;
      timestamp[pos++] = byte;
    } while (value);
    return timestamp.subarray(0, pos);
  }

  function buildCreditsMessage(ratio, epochSeconds) {
    const ratioField = Buffer.alloc(5);
    ratioField[0] = (1 << 3) | 5;
    ratioField.writeFloatLE(ratio, 1);

    const timestamp = buildTimestampMessage(epochSeconds);
    const timestampField = Buffer.alloc(1 + 1 + timestamp.length);
    timestampField[0] = (5 << 3) | 2;
    timestampField[1] = timestamp.length;
    timestamp.copy(timestampField, 2);

    const credits = Buffer.concat([ratioField, timestampField]);
    const wrapped = Buffer.alloc(1 + 1 + credits.length);
    wrapped[0] = (1 << 3) | 2;
    wrapped[1] = credits.length;
    credits.copy(wrapped, 2);
    return wrapped;
  }

  it("extracts the used percentage and reset timestamp from a gRPC-web frame", () => {
    const resetSeconds = Math.floor(new Date("2026-09-29T00:00:00.000Z").getTime() / 1000);
    const decoded = decodeGrokCreditsFrame(buildFrame(buildCreditsMessage(0.25, resetSeconds)));

    expect(decoded).toEqual({
      percentUsed: 25,
      resetAt: "2026-09-29T00:00:00.000Z",
    });
  });

  it("skips gRPC-web trailer frames and reads the first data frame", () => {
    const resetSeconds = Math.floor(new Date("2026-09-29T00:00:00.000Z").getTime() / 1000);
    const trailer = Buffer.from("grpc-status:0\r\n", "utf8");
    const trailerHeader = Buffer.alloc(5);
    trailerHeader[0] = 0x80;
    trailerHeader.writeUInt32BE(trailer.length, 1);

    const decoded = decodeGrokCreditsFrame(
      Buffer.concat([Buffer.concat([trailerHeader, trailer]), buildFrame(buildCreditsMessage(0, resetSeconds))]),
    );

    expect(decoded).toEqual({ percentUsed: 0, resetAt: "2026-09-29T00:00:00.000Z" });
  });

  function buildCreditsWindowMessage(epochSeconds) {
    const timestamp = buildTimestampMessage(epochSeconds);
    const resetField = Buffer.alloc(2 + timestamp.length);
    resetField[0] = (5 << 3) | 2;
    resetField[1] = timestamp.length;
    timestamp.copy(resetField, 2);

    const periodBody = Buffer.from([(1 << 3) | 0, 0x02]);
    const period = Buffer.alloc(2 + periodBody.length);
    period[0] = (8 << 3) | 2;
    period[1] = periodBody.length;
    periodBody.copy(period, 2);

    const credits = Buffer.concat([resetField, period]);
    const wrapped = Buffer.alloc(2 + credits.length);
    wrapped[0] = (1 << 3) | 2;
    wrapped[1] = credits.length;
    credits.copy(wrapped, 2);
    return wrapped;
  }

  it("treats a usage-period window without a ratio as zero usage (live shape)", () => {
    const resetSeconds = Math.floor(new Date("2026-09-29T00:00:00.000Z").getTime() / 1000);
    const decoded = decodeGrokCreditsFrame(buildFrame(buildCreditsWindowMessage(resetSeconds)));

    expect(decoded).toEqual({ percentUsed: 0, resetAt: "2026-09-29T00:00:00.000Z" });
  });

  it("returns null for frames without a credits payload", () => {
    expect(decodeGrokCreditsFrame(buildFrame(Buffer.from([0x0a, 0x00])))).toBeNull();
    expect(decodeGrokCreditsFrame(null)).toBeNull();
    expect(decodeGrokCreditsFrame(Buffer.alloc(0))).toBeNull();
  });
});
