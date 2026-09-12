import { getAccessToken } from "../services/tokenRefresh.js";

const LEASES = new Map();

export async function forceRefreshOAuth(provider, credentials, log, options = {}) {
  if (options.signal?.aborted) return null;
  const leaseKey = `${provider}:${credentials?.connectionId || "anon"}`;

  const inflight = LEASES.get(leaseKey);
  if (inflight) {
    log?.debug?.("A4.3", `coalescing in-flight refresh · ${leaseKey}`);
    return inflight;
  }

  const refreshPromise = (async () => {
    try {
      const result = await getAccessToken(provider, credentials, log, options);
      if (options.signal?.aborted) return null;
      return result;
    } finally {

      setTimeout(() => { LEASES.delete(leaseKey); }, 5000);
    }
  })();

  LEASES.set(leaseKey, refreshPromise);
  return refreshPromise;
}

export function __resetOAuthLeasesForTests() {
  LEASES.clear();
}
