import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { getLifecycleSnapshot } from "@/lifecycle/appLifecycle";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const lifecycle = getLifecycleSnapshot();
  if (lifecycle.state !== "ready") {
    return NextResponse.json({ ok: false, status: "not_ready" }, { status: 503, headers: HEADERS });
  }
  try {
    const db = await getAdapter();
    db.get("SELECT 1 AS ok");
    return NextResponse.json({ ok: true, status: "ready" }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ ok: false, status: "not_ready" }, { status: 503, headers: HEADERS });
  }
}
