import { NextResponse } from "next/server";
import { clearUsageHistory, getUsageHistory } from "@/lib/usageDb";

const VALID_RANGES = new Set(["today", "24h", "7d", "14d", "30d", "60d", "90d", "1y", "all"]);
const RANGE_DAYS = { "7d": 7, "14d": 14, "30d": 30, "60d": 60, "90d": 90 };

function getRangeStart(range) {
  if (range === "all") return null;
  if (range === "24h") return new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (range === "1y") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 364);
    return start;
  }

  const days = RANGE_DAYS[range];
  if (!days) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function parseBoundedInt(value, fallback, min, max) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedInt(searchParams.get("limit"), 50, 1, 500);
    if (limit === null) {
      return NextResponse.json({ error: "limit must be an integer between 1 and 500" }, { status: 400 });
    }

    const range = searchParams.get("range") || "all";
    if (!VALID_RANGES.has(range)) {
      return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    }

    const rawStartDate = searchParams.get("startDate");
    let startDate = getRangeStart(range);
    if (rawStartDate) {
      const explicitStart = new Date(rawStartDate);
      if (Number.isNaN(explicitStart.getTime())) {
        return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
      }
      startDate = explicitStart;
    }

    const usage = await getUsageHistory({
      limit,
      provider: searchParams.get("provider") || undefined,
      model: searchParams.get("model") || undefined,
      apiKeyId: searchParams.get("apiKeyId") || undefined,
      startDate: startDate?.toISOString(),
    });

    return NextResponse.json({ usage, range, limit });
  } catch (error) {
    console.error("Error fetching usage history:", error);
    return NextResponse.json({ error: "Failed to fetch usage history" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || "all";
    if (!VALID_RANGES.has(range)) {
      return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    }

    const startDate = getRangeStart(range);
    const deleted = await clearUsageHistory({
      startDate: startDate?.toISOString(),
    });
    return NextResponse.json({ ok: true, range, deleted });
  } catch (error) {
    console.error("Error clearing usage history:", error);
    return NextResponse.json({ error: "Failed to clear usage history" }, { status: 500 });
  }
}
