export const QUOTA_COLLAPSED_LIMIT = 3;

export function getVisibleQuotas<T>(quotas: T[], expanded: boolean): T[] {
  return expanded ? quotas : quotas.slice(0, QUOTA_COLLAPSED_LIMIT);
}

export function getHiddenQuotaCount<T>(quotas: T[]): number {
  return Math.max(0, quotas.length - QUOTA_COLLAPSED_LIMIT);
}

export function shouldShowQuotaDisclosure<T>(quotas: T[]): boolean {
  return quotas.length > QUOTA_COLLAPSED_LIMIT;
}
