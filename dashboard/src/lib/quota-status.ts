export type QuotaStatus = "limit-reached" | "low-quota" | "ok" | "no-quota";

type QuotaStatusItem = {
  remaining: number;
  unlimited?: boolean;
};

const MULTI_PACKAGE_PROVIDERS = new Set(["codebuddy-cn", "codebuddy-intl"]);

export function getQuotaStatus(provider: string, quotas: QuotaStatusItem[]): QuotaStatus {
  if (!Array.isArray(quotas) || quotas.length === 0) return "no-quota";

  const finiteQuotas = quotas.filter((quota) => (
    quota.unlimited !== true && Number.isFinite(quota.remaining)
  ));

  // Package-based providers can keep serving from another package when one expires.
  // Other providers retain their existing all-windows-must-be-healthy behavior.
  if (finiteQuotas.length === 0) return "ok";

  const normalizedProvider = provider.trim().toLowerCase();
  const remaining = MULTI_PACKAGE_PROVIDERS.has(normalizedProvider)
    ? Math.max(...finiteQuotas.map((quota) => quota.remaining))
    : Math.min(...finiteQuotas.map((quota) => quota.remaining));

  if (remaining <= 0) return "limit-reached";
  if (remaining < 30) return "low-quota";
  return "ok";
}
