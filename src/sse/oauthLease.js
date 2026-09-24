import { getAccessToken } from "../services/tokenRefresh.js";
import { getLockStore } from "../lib/cache/lockStore.js";

const LEASES = new Map();

// Lease = distributed refresh lock with a 5s post-complete hold (same
// window as before). Valkey when configured, memory otherwise. Contention
// across processes returns null instead of racing: two concurrent
// rotations burn the rotating refresh token.
const LEASE_TTL_MS = 10_000;
const LEASE_HOLD_MS = 5_000;

export async function forceRefreshOAuth(provider, credentials, log, options = {}) {
  if (options.signal?.aborted) return null;
  const leaseKey = `${provider}:${credentials?.connectionId || "anon"}`;

  const inflight = LEASES.get(leaseKey);
  if (inflight) {
    log?.debug?.("A4.3", `coalescing in-flight refresh · ${leaseKey}`);
    return inflight;
  }

  const lockStore = getLockStore();
  const token = await lockStore.acquire(`lock:oauth-lease:${leaseKey}`, LEASE_TTL_MS);
  if (!token) {
    log?.debug?.("A4.3", `refresh lease held elsewhere · ${leaseKey}`);
    return null;
  }

  const refreshPromise = (async () => {
    try {
      const result = await getAccessToken(provider, credentials, log, options);
      if (options.signal?.aborted) return null;
      return result;
    } finally {
      setTimeout(async () => {
        LEASES.delete(leaseKey);
        await lockStore.release(`lock:oauth-lease:${leaseKey}`, token).catch(() => {});
      }, LEASE_HOLD_MS);
    }
  })();

  LEASES.set(leaseKey, refreshPromise);
  return refreshPromise;
}

export function __resetOAuthLeasesForTests() {
  LEASES.clear();
}
