import { NextResponse } from "next/server";
import { getTunnelStatus, getDownloadStatus } from "@/lib/tunnel";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const STATUS_CACHE_TTL_MS = 3000;

const statusCache = (global.__tunnelStatusCache ??= { value: null, fetchedAt: 0 });

export async function GET() {
  try {
    let tunnel = statusCache.value;
    if (!tunnel || Date.now() - statusCache.fetchedAt >= STATUS_CACHE_TTL_MS) {
      tunnel = await getTunnelStatus();
      statusCache.value = tunnel;
      statusCache.fetchedAt = Date.now();
    }
    const download = getDownloadStatus();
    return NextResponse.json({ tunnel, download });
  } catch (error) {
    logRouteError("Tunnel][Status", error);
    return NextResponse.json({ error: publicError("tunnel") }, { status: 500 });
  }
}
