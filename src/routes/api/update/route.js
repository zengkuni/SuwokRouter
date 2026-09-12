import { NextResponse } from "next/server";
import { checkForUpdate } from "@/lib/update/version.js";
import { canInstallUpdate, installPackageVersion } from "@/lib/update/installer.js";

export async function POST() {
  const version = await checkForUpdate({ force: true });

  if (!version.updateAvailable || !version.latestVersion) {
    return NextResponse.json({
      success: false,
      code: "no_update_available",
      ...version,
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  if (!canInstallUpdate()) {
    return NextResponse.json({
      success: false,
      code: "update_unavailable",
      message: "Package updates are unavailable for this runtime",
      ...version,
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await installPackageVersion(version.latestVersion);
    return NextResponse.json({
      success: true,
      code: "update_installed",
      message: `Updated to v${result.version}. Restart the router to apply it.`,
      restartRequired: true,
      ...version,
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: "update_failed",
      message: error instanceof Error ? error.message : String(error),
      ...version,
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
