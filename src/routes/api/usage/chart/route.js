import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "90d", "180d", "365d", "year", "all"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const granularity = searchParams.get("granularity") || "day";
    const requestedDays = Number(searchParams.get("days"));
    const days = Number.isInteger(requestedDays) && requestedDays > 0 ? requestedDays : undefined;

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    if (granularity !== "day" && granularity !== "hour") {
      return NextResponse.json({ error: "Invalid granularity" }, { status: 400 });
    }

    const data = await getChartData(period, { granularity, days });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
