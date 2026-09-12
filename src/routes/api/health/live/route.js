import { NextResponse } from "next/server";

const HEADERS = { "Cache-Control": "no-store" };

export function GET() {
  return NextResponse.json({ ok: true, status: "live" }, { headers: HEADERS });
}
