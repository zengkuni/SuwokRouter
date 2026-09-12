import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";

const LOG_LIMIT = 200;

export async function GET() {
  try {
    const logs = await getRecentLogs(LOG_LIMIT);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
