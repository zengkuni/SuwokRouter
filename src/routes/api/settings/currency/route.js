import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getUsdToIdrRate } from "@/services/currencyRate.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [settings, rate] = await Promise.all([getSettings(), getUsdToIdrRate()]);
    return NextResponse.json({
      currency: settings.currency === "IDR" ? "IDR" : "USD",
      usdToIdr: rate.rate,
      rateUpdatedAt: rate.updatedAt,
      rateSource: rate.source,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({
      currency: "USD",
      usdToIdr: 16_500,
      rateUpdatedAt: null,
      rateSource: "fallback",
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
