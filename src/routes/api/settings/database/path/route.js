import { NextResponse } from "next/server";
import { DATA_FILE } from "@/lib/db/paths.js";

const HEADERS = { "Cache-Control": "no-store" };

export function GET() {
  return NextResponse.json({ dbPath: DATA_FILE }, { headers: HEADERS });
}
