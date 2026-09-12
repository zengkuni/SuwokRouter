import { PROVIDERS } from "../../providers/index.js";
import { U, fetchWithTimeout, parseResetTime } from "./shared.js";

const PROVIDER_ID = "codebuddy-cn";

function num(precise, plain) {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function numberValue(object, keys) {
  return num(firstValue(object, keys), 0);
}

function extractAccounts(payload) {
  const candidates = [
    payload?.data?.Response?.Data?.Accounts,
    payload?.data?.Response?.Data?.accounts,
    payload?.data?.Response?.Accounts,
    payload?.data?.Response?.accounts,
    payload?.data?.Accounts,
    payload?.data?.accounts,
    payload?.Response?.Data?.Accounts,
    payload?.Response?.Data?.accounts,
    payload?.Accounts,
    payload?.accounts,
    Array.isArray(payload?.data) ? payload.data : null,
    Array.isArray(payload) ? payload : null,
  ];
  return candidates.find(Array.isArray) || [];
}

function accountDescriptor(account) {
  return [
    account?.PackageName,
    account?.SubProductName,
    account?.ProductName,
    account?.PackageDisplayName,
    account?.ResourceName,
    account?.Name,
    account?.PackageCode,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();
}

function accountLabel(account) {
  const descriptor = accountDescriptor(account);
  if (/free|免费|_035_/.test(descriptor)) return "Free Plan";
  if (/bonus|gift|trial|赠送|_006_/.test(descriptor)) return "Bonus Pack";
  return "Quota";
}

function timestamp(value) {
  const parsed = parseResetTime(value);
  return parsed ? new Date(parsed).getTime() : Number.NaN;
}

function refillCadence(acc) {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

function buildCodeBuddyQuotas(accounts) {
  const cycleEndMs = (account) => {
    const value = timestamp(account.CycleEndTime);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };

  const isRefill = (account) => {
    const cycleEnd = cycleEndMs(account);
    const deductionEnd = timestamp(account.DeductionEndTime);
    const descriptor = accountDescriptor(account);
    const isOneTimePackage = /bonus|gift|trial|赠送|_006_/.test(descriptor);
    const isRecurringPackage = /free|subscription|recurring|_035_/.test(descriptor);
    const hasExtendedDeductionWindow = Number.isFinite(cycleEnd)
      && Number.isFinite(deductionEnd)
      && deductionEnd - cycleEnd > 2 * 24 * 60 * 60 * 1000;
    return !isOneTimePackage && (isRecurringPackage || hasExtendedDeductionWindow);
  };

  const byExpiry = (a, b) => cycleEndMs(a) - cycleEndMs(b);
  const refills = accounts.filter(isRefill).sort(byExpiry);
  const bonuses = accounts.filter((account) => !isRefill(account)).sort(byExpiry);
  const quotas = {};

  const seenRefill = {};
  for (const account of refills) {
    const packageName = accountLabel(account);
    const base = packageName === "Quota" ? refillCadence(account) : packageName;
    seenRefill[base] = (seenRefill[base] || 0) + 1;
    const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
    quotas[name] = {
      used: numberValue(account, [
        "CycleCapacityUsedPrecise",
        "CycleCapacityUsed",
        "CapacityUsedPrecise",
        "CapacityUsed",
      ]),
      total: numberValue(account, [
        "CycleCapacitySizePrecise",
        "CycleCapacitySize",
        "CapacitySizePrecise",
        "CapacitySize",
      ]),
      resetAt: parseResetTime(account.CycleEndTime),
      unlimited: false,
      recurring: true,
    };
  }

  const seenPackages = {};
  for (const account of bonuses) {
    const base = accountLabel(account);
    seenPackages[base] = (seenPackages[base] || 0) + 1;
    const name = seenPackages[base] > 1 ? `${base} ${seenPackages[base]}` : base;
    quotas[name] = {
      used: numberValue(account, [
        "CapacityUsedPrecise",
        "CapacityUsed",
        "CycleCapacityUsedPrecise",
        "CycleCapacityUsed",
      ]),
      total: numberValue(account, [
        "CapacitySizePrecise",
        "CapacitySize",
        "CycleCapacitySizePrecise",
        "CycleCapacitySize",
      ]),
      resetAt: parseResetTime(account.CycleEndTime),
      unlimited: false,
      recurring: false,
    };
  }

  const basePackage = accounts[0] || {};
  return {
    plan: basePackage.PackageName || basePackage.SubProductName || "CodeBuddy",
    quotas,
  };
}

async function getCodeBuddyUsage(providerId, accessToken, apiKey, proxyOptions = null) {
  const providerName = providerId === "codebuddy-intl" ? "CodeBuddy Intl" : "CodeBuddy CN";
  const token = accessToken || apiKey;
  if (!token) {
    return { message: `${providerName} access token or API key not available.` };
  }

  try {
    const response = await fetchWithTimeout(U(providerId).url, {
      method: "POST",
      headers: {
        ...(PROVIDERS[providerId]?.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    }, 10_000, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: `${providerName} credential invalid or expired.` };
    }
    if (!response.ok) {
      return { message: `${providerName} usage request failed.` };
    }

    const json = await response.json();
    if (json?.code !== 0) {
      return { message: `${providerName} usage request failed.` };
    }

    const accounts = extractAccounts(json);
    if (accounts.length === 0) {
      return { message: `${providerName} connected. No credit package found.` };
    }

    return buildCodeBuddyQuotas(accounts);
  } catch (error) {
    console.error(`[CodeBuddy Usage] ${providerId} failed:`, error);
    return { message: "CodeBuddy usage request failed." };
  }
}

export async function getCodeBuddyCnUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  return getCodeBuddyUsage(PROVIDER_ID, accessToken, apiKey, proxyOptions);
}

export async function getCodeBuddyIntlUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  return getCodeBuddyUsage("codebuddy-intl", accessToken, apiKey, proxyOptions);
}

export function parseCodeBuddyQuotaResponse(payload) {
  const accounts = extractAccounts(payload);
  return buildCodeBuddyQuotas(accounts);
}
