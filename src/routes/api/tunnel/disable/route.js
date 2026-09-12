import { NextResponse } from "next/server";
import { disableTunnel } from "@/lib/tunnel";
import { getSettings } from "@/lib/localDb";
import { configureTunnelMonitoring } from "@/shared/services/initializeApp";
import { logRouteError, publicError } from "@/lib/errors/publicError";

export async function POST() {
  try {
    const result = await disableTunnel();
    getSettings()
      .then(configureTunnelMonitoring)
      .catch((error) => console.warn("Tunnel monitor update failed:", error.message));
    return NextResponse.json(result);
  } catch (error) {
    logRouteError("Tunnel][Disable", error);
    return NextResponse.json({ error: publicError("tunnel") }, { status: 500 });
  }
}
