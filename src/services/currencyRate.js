import { fetchWithTimeout } from "./usage/shared.js";

const RATE_URL = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_USD_TO_IDR = 16_500;
const RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_REQUEST_TIMEOUT_MS = 5_000;

let cached = {
  rate: FALLBACK_USD_TO_IDR,
  updatedAt: null,
  fetchedAt: 0,
  source: "fallback",
};
let inFlight = null;

export async function getUsdToIdrRate() {
  if (Date.now() - cached.fetchedAt < RATE_CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetchWithTimeout(
        RATE_URL,
        { headers: { Accept: "application/json" } },
        RATE_REQUEST_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(`Rate service returned ${response.status}`);

      const payload = await response.json();
      const rate = Number(payload?.rates?.IDR);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("IDR rate is unavailable");

      cached = {
        rate,
        updatedAt: typeof payload?.time_last_update_utc === "string"
          ? payload.time_last_update_utc
          : new Date().toISOString(),
        fetchedAt: Date.now(),
        source: "ExchangeRate-API",
      };
    } catch (error) {
      cached = { ...cached, fetchedAt: Date.now() };
      console.warn(`[Currency] USD/IDR rate unavailable; using ${cached.source}: ${error.message}`);
    }
    return cached;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export const __test__ = {
  FALLBACK_USD_TO_IDR,
  RATE_CACHE_TTL_MS,
};
