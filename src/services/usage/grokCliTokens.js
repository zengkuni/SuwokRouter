import { getAdapter } from "../../lib/db/driver.js";
import { flushUsageBuffer } from "../../lib/db/repos/usageRepo.js";

// grok2api treats Grok Build free accounts as a rolling token budget with an
// estimated cap (they use 500k tokens / freeUsageWindow). We copy the shape:
// the used side is measured locally from this router's own request log, so the
// number is real even though the cap is an estimate.
export const FREE_ROLLING_WINDOW_HOURS = 5;
export const FREE_ROLLING_TOKEN_LIMIT = 500_000;

/**
 * Sum prompt+completion tokens routed through this connection inside the
 * rolling window. Returns null when there is no usable history (no id, no DB
 * access) so callers can skip the quota instead of showing a fake 0.
 */
export async function getRollingTokenUsage(
  connectionId,
  windowHours = FREE_ROLLING_WINDOW_HOURS,
) {
  if (!connectionId) return null;
  try {
    // Rows are write-behind buffered; drain first so the window is current.
    await flushUsageBuffer();
    const db = await getAdapter();
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    const row = await db.get(
      `SELECT COALESCE(SUM(promptTokens), 0) AS promptTokens,
              COALESCE(SUM(completionTokens), 0) AS completionTokens
         FROM usageHistory
        WHERE connectionId = $1 AND timestamp >= $2`,
      [connectionId, since],
    );
    const promptTokens = Math.max(0, Number(row?.promptTokens) || 0);
    const completionTokens = Math.max(0, Number(row?.completionTokens) || 0);
    return { promptTokens, completionTokens, total: promptTokens + completionTokens };
  } catch {
    return null;
  }
}
