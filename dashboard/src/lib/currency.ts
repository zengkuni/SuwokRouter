export const FALLBACK_USD_TO_IDR = 16_500;
export const DEFAULT_CURRENCY = "USD" as const;
export type DisplayCurrency = "USD" | "IDR";

const IDR_FORMATTER = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  currencyDisplay: "symbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function normalizeCurrency(value: unknown): DisplayCurrency {
  return value === "IDR" ? "IDR" : DEFAULT_CURRENCY;
}

export function usdToDisplay(
  value: number | null | undefined,
  currency: DisplayCurrency,
  usdToIdrRate = FALLBACK_USD_TO_IDR,
): number {
  const usd = Number(value);
  if (!Number.isFinite(usd)) return 0;
  if (currency === "USD") return Math.max(0, usd);
  const rate = Number(usdToIdrRate);
  return Math.max(0, usd) * (Number.isFinite(rate) && rate > 0 ? rate : FALLBACK_USD_TO_IDR);
}

export function formatCostFromUsd(
  value: number | null | undefined,
  currency: DisplayCurrency,
  usdToIdrRate = FALLBACK_USD_TO_IDR,
): string {
  const amount = usdToDisplay(value, currency, usdToIdrRate);
  if (currency === "USD") return `$${amount >= 1 ? amount.toFixed(2) : amount.toFixed(4)}`;
  return IDR_FORMATTER.format(amount);
}
