import { resolveDns } from "../shared/dnsResolver.js";
import { HEALTH_CHECK } from "./config.js";

function getHostname(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function probeUrlAlive(url) {
  if (!url) return false;
  const hostname = getHostname(url);
  if (!hostname) return false;

  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(url, cancelToken = { cancelled: false }) {
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    if (await probeUrlAlive(url)) return true;
    await pause(HEALTH_CHECK.intervalMs);
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}
