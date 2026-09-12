import { api } from "@/lib/api";
import { FALLBACK_USD_TO_IDR, normalizeCurrency, type DisplayCurrency } from "@/lib/currency";

export type CurrencySettings = {
  currency: DisplayCurrency;
  usdToIdr: number;
  rateUpdatedAt: string | null;
  rateSource: string;
};

export async function fetchCurrencySettings(): Promise<CurrencySettings> {
  const { data } = await api.get<Partial<CurrencySettings>>("/settings/currency");
  return {
    currency: normalizeCurrency(data.currency),
    usdToIdr: Number.isFinite(Number(data.usdToIdr)) && Number(data.usdToIdr) > 0
      ? Number(data.usdToIdr)
      : FALLBACK_USD_TO_IDR,
    rateUpdatedAt: typeof data.rateUpdatedAt === "string" ? data.rateUpdatedAt : null,
    rateSource: data.rateSource || "fallback",
  };
}
