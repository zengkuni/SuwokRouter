import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../../config/grokCli.js";
import { decodeGrokCreditsFrame } from "./grokCliQuotaFrame.js";
import {
  FREE_ROLLING_TOKEN_LIMIT,
  getRollingTokenUsage,
} from "./grokCliTokens.js";

const USAGE = U("grok-cli");
const BILLING_URL = USAGE.url || "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const BILLING_LEDGER_URL = USAGE.ledgerUrl || "https://cli-chat-proxy.grok.com/v1/billing";
const USER_URL = USAGE.userUrl || "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
const SETTINGS_URL = USAGE.settingsUrl || "https://cli-chat-proxy.grok.com/v1/settings";

const GRPC_CREDITS_URL =
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";

const GRPC_WEB_EMPTY_REQUEST_FRAME = Buffer.from([0, 0, 0, 0, 0]);

function unwrapVal(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "val" in value) {
    return toFiniteNumber(value.val, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function buildGrokCliHeaders(accessToken, providerSpecificData = {}) {
  const psd = providerSpecificData || {};
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-mode": "headless",
  };
  const email = psd.email;
  const userId = psd.userId || psd.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

// Tier claim mapping mirrors grok2api's CLI adapter: the official CLI tokens
// carry a numeric `tier` claim for the subscription level.
const TIER_FROM_CLAIM = {
  0: "Free",
  1: "SuperGrok",
  2: "X Basic",
  3: "X Premium",
  4: "X Premium Plus",
  5: "SuperGrok Heavy",
  6: "SuperGrok Lite",
};

function firstTierString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function tierFromAccessToken(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split(".")[1], "base64url"));
    const claim = payload?.tier;
    if (typeof claim === "string" && claim.trim()) return claim.trim();
    if (typeof claim === "number" && Number.isInteger(claim) && claim >= 0) {
      return TIER_FROM_CLAIM[claim] || "";
    }
  } catch {
    // Not a JWT or malformed — caller treats it as "no tier signal".
  }
  return "";
}

// Resolution order: the CLI /v1/settings store is the live tier display (the
// only source that populates for xAI CLI accounts), then the subscription
// object from /v1/user, billing plan fields, and finally the JWT claim.
function subscriptionTier(user, config, settings, accessToken) {
  return firstTierString(
    settings?.subscription_tier_display,
    settings?.subscriptionTier,
    settings?.subscription_tier,
    user?.subscriptionTier,
    user?.subscription_tier,
    user?.subscription?.tier,
    user?.subscription?.tier_display,
    config?.subscriptionTier,
    config?.subscription_tier,
    config?.planName,
    config?.planCode,
    tierFromAccessToken(accessToken),
  );
}

function isFreeTier(tier) {
  return /^(free|none|null|basic)$/i.test(tier);
}

// grok2api's inferred-free profile: a successful snapshot with no plan name
// and every paid field at zero is the shape xAI returns for Free accounts
// (the plan name is omitted). Ambiguity against a brand-new paid account is
// resolved toward "no weekly pool": a 0/100 pool that never moves is exactly
// the bug this whole path fixes, and paid accounts with real usage always
// carry at least one positive paid field.
function hasPaidBillingSignal(values) {
  return values.some((value) => Number.isFinite(value) && value > 0);
}

function prettifyTier(tier) {
  return tier
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolvePlan(tier, isFree, user) {
  if (tier) return prettifyTier(tier);
  if (isFree) return "Free";
  if (user?.hasGrokCodeAccess === true) return "Grok Code";
  return "Grok Build";
}

function makeQuota({ used, total, resetAt, unlimited = false, unit }) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));

  if (unlimited || safeTotal === 0) {
    return {
      used: safeUsed,
      total: 0,
      remainingPercentage: unlimited ? 100 : 0,
      resetAt: resetAt || null,
      unlimited: true,
      ...(unit ? { unit } : {}),
    };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  const remainingPercentage = (remaining / safeTotal) * 100;
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage,
    resetAt: resetAt || null,
    unlimited: false,
    ...(unit ? { unit } : {}),
  };
}

export function parseGrokCliBilling(
  billing,
  user = null,
  monthlyBilling = null,
  settings = null,
  accessToken = null,
) {
  const root = billing && typeof billing === "object" ? billing : {};
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : root;

  // The plain /v1/billing payload carries the metered ledger (used/monthlyLimit);
  // the ?format=credits payload carries the weekly window and percent. Merge
  // both so a free account's real spend is visible next to the window.
  const ledgerRoot =
    monthlyBilling && typeof monthlyBilling === "object" ? monthlyBilling : {};
  const ledgerConfig =
    ledgerRoot.config && typeof ledgerRoot.config === "object" && !Array.isArray(ledgerRoot.config)
      ? ledgerRoot.config
      : ledgerRoot;
  const merged = { ...ledgerConfig, ...config };

  const periodEnd =
    parseResetTime(config.billingPeriodEnd) ||
    parseResetTime(config.billing_period_end) ||
    parseResetTime(config.currentPeriod?.end) ||
    parseResetTime(config.resetAt || config.resetsAt || config.periodEnd) ||
    parseResetTime(ledgerConfig.billingPeriodEnd) ||
    parseResetTime(ledgerConfig.billing_period_end) ||
    parseResetTime(root.billingPeriodEnd) ||
    parseResetTime(root.billing_period_end) ||
    parseResetTime(root.resetAt || root.resetsAt || root.periodEnd) ||
    null;

  const quotas = {};
  const tier = subscriptionTier(user, config, settings, accessToken);
  const paidSignals = hasPaidBillingSignal([
    unwrapVal(merged.monthlyLimit ?? NaN, NaN),
    unwrapVal(merged.includedUsed ?? NaN, NaN),
    unwrapVal(merged.totalUsed ?? NaN, NaN),
    unwrapVal(merged.onDemandCap ?? NaN, NaN),
    unwrapVal(merged.onDemandUsed ?? NaN, NaN),
    unwrapVal(merged.prepaidBalance ?? merged.prepaid_balance ?? NaN, NaN),
  ]);
  // Only a snapshot that actually carries billing keys may be inferred as
  // free; a malformed/empty payload must stay "unknown", not "free".
  const looksLikeBilling = [
    "monthlyLimit", "monthly_limit", "used", "totalUsed", "total_used",
    "onDemandCap", "onDemandUsed", "on_demand_cap", "on_demand_used",
    "prepaidBalance", "prepaid_balance", "creditUsagePercent",
    "isUnifiedBillingUser", "currentPeriod", "billingPeriodEnd", "topUpMethod",
  ].some((key) => key in merged || key in config || key in ledgerConfig);
  const inferredFree = tier === "" && !paidSignals && looksLikeBilling;
  const isFree = isFreeTier(tier) || inferredFree;
  const subscriptionAccess =
    (!isFree && Boolean(tier)) ||
    config?.isUnifiedBillingUser === true ||
    user?.hasGrokCodeAccess === true;

  const monthlyLimit = unwrapVal(
    merged.monthlyLimit ?? merged.monthly_limit ?? NaN,
    NaN,
  );
  const includedUsed = unwrapVal(
    merged.includedUsed ?? merged.included_used ?? NaN,
    NaN,
  );
  const totalUsed = unwrapVal(
    merged.totalUsed ?? merged.total_used ?? NaN,
    NaN,
  );
  const legacyUsed = unwrapVal(config.used ?? root.used ?? ledgerConfig.used ?? ledgerRoot.used, NaN);
  if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
    const rawUsed = Number.isFinite(includedUsed)
      ? includedUsed
      : Number.isFinite(totalUsed)
        ? totalUsed
        : Number.isFinite(legacyUsed)
          ? legacyUsed
          : 0;
    quotas["Monthly included"] = makeQuota({
      used: rawUsed / 100,
      total: monthlyLimit / 100,
      resetAt: periodEnd,
      unit: "USD",
    });
  }

  const onDemandCap = unwrapVal(merged.onDemandCap ?? NaN, NaN);
  const onDemandUsed = unwrapVal(merged.onDemandUsed ?? NaN, NaN);
  if (Number.isFinite(onDemandCap) && onDemandCap > 0) {
    const used = Number.isFinite(onDemandUsed) ? Math.max(0, onDemandUsed) : 0;
    quotas["On-demand"] = makeQuota({
      used: used / 100,
      total: onDemandCap / 100,
      resetAt: periodEnd,
      unit: "USD",
    });
  }

  const prepaid = unwrapVal(config.prepaidBalance ?? root.prepaidBalance ?? merged.prepaidBalance, NaN);
  if (Number.isFinite(prepaid) && prepaid > 0) {

    quotas["Prepaid"] = {
      used: 0,
      total: prepaid / 100,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
      unit: "USD",
    };
  }

  // The weekly SuperGrok pool only exists for paid tiers. Free/unified-free
  // accounts return a default `creditUsagePercent: 0` with no pool at all, so
  // showing "Weekly SuperGrok 0/100" there fabricates a quota that never moves.
  const usedPct = unwrapVal(
    config.creditUsagePercent ?? config.credit_usage_percent ?? root.creditUsagePercent,
    NaN,
  );
  if (!isFree && Number.isFinite(usedPct) && usedPct >= 0) {
    quotas["Weekly SuperGrok"] = makeQuota({
      used: Math.max(0, Math.min(100, usedPct)),
      total: 100,
      resetAt: periodEnd,
    });
  }

  // Metered (pay-as-you-go) spend: real consumption in cents this billing cycle,
  // shown when the account has no included allowance covering it.
  if (
    Number.isFinite(legacyUsed) &&
    legacyUsed > 0 &&
    !quotas["Monthly included"] &&
    !quotas["Weekly SuperGrok"] &&
    !quotas["On-demand"]
  ) {
    const usedUsd = legacyUsed / 100;
    const capUsd = Number.isFinite(onDemandCap) && onDemandCap > 0 ? onDemandCap / 100 : 0;
    quotas["Monthly metered"] = makeQuota({
      used: usedUsd,
      total: capUsd,
      resetAt:
        parseResetTime(ledgerConfig.billingPeriodEnd) ||
        parseResetTime(ledgerConfig.billing_period_end) ||
        periodEnd,
      unit: "USD",
    });
  }

  const creditBags = [
    root.credits,
    root.creditBalance,
    root.usage,
    config.credits,
    config.includedCredits,
    config.subscriptionCredits,
  ].filter((bag) => bag && typeof bag === "object" && !Array.isArray(bag));

  for (const bag of creditBags) {
    const total = unwrapVal(
      bag.total ?? bag.limit ?? bag.cap ?? bag.allocation ?? bag.amount,
      NaN,
    );
    const used = unwrapVal(bag.used ?? bag.spent ?? bag.consumed, NaN);
    const remaining = unwrapVal(bag.remaining ?? bag.balance ?? bag.left, NaN);
    if (Number.isFinite(total) && total > 0) {
      const resolvedUsed = Number.isFinite(used)
        ? used
        : Number.isFinite(remaining)
          ? Math.max(0, total - remaining)
          : 0;
      if (!quotas.Credits) {
        quotas.Credits = makeQuota({
          used: resolvedUsed,
          total,
          resetAt: parseResetTime(bag.resetAt || bag.resetsAt || bag.end) || periodEnd,
        });
      }
    } else if (Number.isFinite(remaining) && remaining >= 0 && !quotas.Credits) {
      quotas.Credits = {
        used: 0,
        total: remaining > 0 ? remaining : 1,
        remainingPercentage: remaining > 0 ? 100 : 0,
        resetAt: periodEnd,
        unlimited: false,
      };
    }
  }

  const exhausted =
    Object.keys(quotas).length > 0 &&
    Object.values(quotas).every(
      (q) => q.unlimited !== true && (q.remainingPercentage ?? 100) <= 0,
    );

  return {
    plan: resolvePlan(tier, isFree, user),
    tier,
    tierSource: tier ? "endpoint" : inferredFree ? "inferred" : "unknown",
    quotas,
    periodEnd,
    exhausted,
    subscriptionAccess,
    isFree,
    rawConfig: config,
  };
}

export async function fetchGrokCliCreditsConfig(accessToken, proxyOptions = null) {
  if (!accessToken) return null;
  try {
    const res = await proxyAwareFetch(
      GRPC_CREDITS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/grpc-web+proto",
          "X-Grpc-Web": "1",
          Accept: "application/grpc-web+proto",
        },
        body: GRPC_WEB_EMPTY_REQUEST_FRAME,
      },
      proxyOptions,
    );
    if (!res?.ok) return null;
    const arrayBuffer = await res.arrayBuffer().catch(() => null);
    if (!arrayBuffer) return null;
    return decodeGrokCreditsFrame(Buffer.from(arrayBuffer));
  } catch {
    return null;
  }
}

function quotasFromGrpcCredits(decoded) {
  if (!decoded || !Number.isFinite(decoded.percentUsed)) return null;

  const used = Math.round(Math.max(0, Math.min(100, decoded.percentUsed)));
  return {
    "Weekly SuperGrok": makeQuota({
      used,
      total: 100,
      resetAt: decoded.resetAt || null,
    }),
  };
}

export async function getGrokCliUsage(
  accessToken,
  providerSpecificData = null,
  proxyOptions = null,
  connection = null,
) {
  if (!accessToken) {
    return { message: "Grok CLI access token not available." };
  }

  const headers = buildGrokCliHeaders(accessToken, providerSpecificData);

  try {

    const [billingRes, ledgerRes, userRes, settingsRes] = await Promise.all([
      proxyAwareFetch(
        BILLING_URL,
        { method: "GET", headers },
        proxyOptions,
      ),
      proxyAwareFetch(
        BILLING_LEDGER_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
      proxyAwareFetch(
        USER_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
      proxyAwareFetch(
        SETTINGS_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
    ]);

    if (billingRes.status === 401 || billingRes.status === 403) {
      return { message: "Grok CLI authentication expired. Please re-authorize." };
    }

    if (!billingRes.ok) {
      await billingRes.text().catch(() => "");
      return { message: `Grok CLI billing API error (${billingRes.status}).` };
    }

    const billing = await billingRes.json().catch(() => null);
    if (!billing || typeof billing !== "object") {
      return { message: "Grok CLI billing response was not JSON." };
    }

    let user = null;
    if (userRes?.ok) {
      user = await userRes.json().catch(() => null);
    }

    let settings = null;
    if (settingsRes?.ok) {
      settings = await settingsRes.json().catch(() => null);
    }

    let monthlyBilling = null;
    if (ledgerRes?.ok) {
      monthlyBilling = await ledgerRes.json().catch(() => null);
    }

    const parsed = parseGrokCliBilling(billing, user, monthlyBilling, settings, accessToken);

    const hasAllowanceQuota = Boolean(
      parsed.quotas["Weekly SuperGrok"] || parsed.quotas["Monthly included"],
    );
    // The gRPC credits config only carries a weekly SuperGrok pool; a free
    // account has none, so skip it there instead of fabricating one.
    if (!hasAllowanceQuota && !parsed.isFree) {
      const grpc = await fetchGrokCliCreditsConfig(accessToken, proxyOptions);
      const grpcQuotas = quotasFromGrpcCredits(grpc);
      if (grpcQuotas) {
        return {
          plan: parsed.plan,
          quotas: { ...parsed.quotas, ...grpcQuotas },
        };
      }
      if (Object.keys(parsed.quotas).length === 0) {
        return {
          plan: parsed.plan,
          message: parsed.subscriptionAccess
            ? "Subscription access is active; Grok does not expose a numeric included quota."
            : "Grok Build connected, but no credit allotment was returned. Free promo may be exhausted.",
          quotas: {},
        };
      }
    }
    // Free accounts: add the locally measured rolling token budget next to
    // the metered USD spend. The cap is an estimate (mirrors grok2api); the
    // used side is real, counted from this router's own request log.
    if (parsed.isFree) {
      const rolling = await getRollingTokenUsage(connection?.id);
      if (rolling) {
        parsed.quotas["Tokens (rolling 5h, est.)"] = makeQuota({
          used: rolling.total,
          total: FREE_ROLLING_TOKEN_LIMIT,
          unit: "tokens",
        });
      }
    }

    if (Object.keys(parsed.quotas).length === 0 && parsed.isFree) {
      return {
        plan: parsed.plan,
        message: "Grok free plan: no included quota — usage is pay-as-you-go.",
        quotas: {},
      };
    }

    return {
      plan: parsed.plan,
      quotas: parsed.quotas,
    };
  } catch (error) {
    console.error("[Grok CLI Usage] Failed to fetch billing:", error);
    return { message: "Grok CLI usage request failed." };
  }
}
