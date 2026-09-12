import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel";
import { getSettings } from "@/lib/localDb";
import { configureTunnelMonitoring } from "@/shared/services/initializeApp";
import { logRouteError, publicError } from "@/lib/errors/publicError";
import { getTunnelEnableError } from "@/lib/tunnel/cloudflare/requirements.js";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  try {
    const settings = await getSettings();
    const requirementError = getTunnelEnableError(settings);
    if (requirementError) {
      return NextResponse.json(
        { success: false, error: requirementError },
        { status: 400 },
      );
    }

    const result = await enableTunnel();
    getSettings()
      .then(configureTunnelMonitoring)
      .catch((error) => console.warn("Tunnel monitor start failed:", error.message));

    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error) {
    logRouteError("Tunnel][Enable", error);
    return NextResponse.json({ error: publicError("tunnel") }, { status: 500 });
  }
}
