import { NextResponse } from "next/server";
import { exportDb, importDb } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { hasValidCliToken } from "@/dashboardGuard";

const PASSWORD_HEADER = "x-swayrouter-password";
const HEADERS = { "Cache-Control": "no-store" };

export async function GET(request) {
  try {
    if (!(await hasValidCliToken(request)) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json(
        { error: "Invalid password", code: "invalid_reauthentication" },
        { status: 401, headers: HEADERS },
      );
    }
    const scope = new URL(request.url).searchParams.get("scope") || "configuration";
    if (scope !== "configuration" && scope !== "full") {
      return NextResponse.json(
        { error: "Invalid backup scope" },
        { status: 400, headers: HEADERS },
      );
    }
    const payload = await exportDb({ scope });
    return NextResponse.json(payload, { headers: HEADERS });
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json(
      { error: "Failed to export database" },
      { status: 500, headers: HEADERS },
    );
  }
}

export async function POST(request) {
  try {
    const { password, ...payload } = await request.json();
    if (!(await hasValidCliToken(request)) && !(await verifyDashboardPassword(password))) {
      return NextResponse.json(
        { error: "Invalid password", code: "invalid_reauthentication" },
        { status: 401, headers: HEADERS },
      );
    }
    await importDb(payload);

    return NextResponse.json(
      {
        success: true,
        message: "Backup restored successfully",
        result: {
          connectionsImported: Array.isArray(payload.providerConnections)
            ? payload.providerConnections.length
            : 0,
          nodesImported: Array.isArray(payload.providerNodes)
            ? payload.providerNodes.length
            : 0,
          poolsImported: Array.isArray(payload.proxyPools)
            ? payload.proxyPools.length
            : 0,
          combosImported: Array.isArray(payload.combos)
            ? payload.combos.length
            : 0,
          settingsImported: Boolean(payload.settings),
          apiKeysImported:
            payload.apiKeysRedacted === true
              ? 0
              : Array.isArray(payload.apiKeys)
                ? payload.apiKeys.length
                : 0,
          backupScope: payload.backupScope === "full" ? "full" : "configuration",
        },
      },
      { headers: HEADERS },
    );
  } catch (error) {
    console.log("Error importing database:", error);
    console.error("[Settings][DatabaseImport]", error);
    const message = typeof error?.message === "string" && (
      error.message.startsWith("Invalid database payload:")
      || error.message === "API key material is required for database import"
    )
      ? error.message
      : "Failed to import database";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: HEADERS },
    );
  }
}
