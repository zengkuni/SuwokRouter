import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDER_OAUTH } from "../../providers/index.js";
import { U, parseResetTime } from "./shared.js";

const GITHUB_CONFIG = {
  apiVersion: PROVIDER_OAUTH.github?.apiVersion,
  userAgent: PROVIDER_OAUTH.github?.userAgent,
};

export async function getGitHubUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { message: "GitHub Copilot access token not available." };
  }

  try {

    const response = await proxyAwareFetch(U("github").url, {
      headers: {
        "Authorization": `token ${accessToken}`,
        "Accept": "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
        "Editor-Version": "vscode/1.100.0",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    }, proxyOptions);

    if (!response.ok) {
      await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        return { message: "GitHub Copilot authentication expired. Please re-authorize." };
      }
      return { message: `GitHub Copilot usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();

    if (data.quota_snapshots) {

      const snapshots = data.quota_snapshots;
      const resetAt = parseResetTime(data.quota_reset_date);

      return {
        plan: data.copilot_plan,
        resetDate: data.quota_reset_date,
        quotas: {
          chat: { ...formatGitHubQuotaSnapshot(snapshots.chat), resetAt },
          completions: { ...formatGitHubQuotaSnapshot(snapshots.completions), resetAt },
          premium_interactions: { ...formatGitHubQuotaSnapshot(snapshots.premium_interactions), resetAt },
        },
      };
    } else if (data.monthly_quotas || data.limited_user_quotas) {

      const monthlyQuotas = data.monthly_quotas || {};
      const usedQuotas = data.limited_user_quotas || {};
      const resetAt = parseResetTime(data.limited_user_reset_date);

      return {
        plan: data.copilot_plan || data.access_type_sku,
        resetDate: data.limited_user_reset_date,
        quotas: {
          chat: {
            used: usedQuotas.chat || 0,
            total: monthlyQuotas.chat || 0,
            unlimited: false,
            resetAt,
          },
          completions: {
            used: usedQuotas.completions || 0,
            total: monthlyQuotas.completions || 0,
            unlimited: false,
            resetAt,
          },
        },
      };
    }

    return { message: "GitHub Copilot connected. Unable to parse quota data." };
  } catch (error) {
    console.error("[GitHub Usage] Failed to fetch usage:", error);
    return { message: "GitHub Copilot usage request failed." };
  }
}

function formatGitHubQuotaSnapshot(quota) {
  if (!quota) return { used: 0, total: 0, unlimited: true };

  return {
    used: quota.entitlement - quota.remaining,
    total: quota.entitlement,
    remaining: quota.remaining,
    unlimited: quota.unlimited || false,
  };
}
