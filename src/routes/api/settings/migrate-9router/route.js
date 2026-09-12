import { NextResponse } from "next/server";
import { hasValidCliToken, isLocalRequest } from "@/dashboardGuard";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import {
  applyNineRouterMigration,
  getNineRouterDetection,
  previewNineRouterMigration,
  readDetectedNineRouterDatabase,
  validateNineRouterPayload,
} from "@/lib/db/nineRouterMigration.js";

const HEADERS = { "Cache-Control": "no-store" };

async function resolveSource(request, body) {
  if (body.source === "local") {
    if (!isLocalRequest(request)) {
      const error = new Error("Local 9Router migration is only available from this machine");
      error.code = "LOCAL_SOURCE_FORBIDDEN";
      throw error;
    }
    return await readDetectedNineRouterDatabase();
  }
  if (body.source === "json") return validateNineRouterPayload(body.payload);
  const error = new Error("Choose a local installation or a 9Router JSON backup");
  error.code = "INVALID_MIGRATION_SOURCE";
  throw error;
}

function publicMigrationError(error) {
  const allowedCodes = new Set([
    "INVALID_9ROUTER_SOURCE",
    "LOCAL_SOURCE_UNAVAILABLE",
    "LOCAL_SOURCE_FORBIDDEN",
    "INVALID_MIGRATION_SOURCE",
    "NOTHING_TO_MIGRATE",
  ]);
  if (allowedCodes.has(error?.code) && typeof error?.message === "string") return error.message;
  return "9Router migration failed";
}

export async function GET(request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ available: false, localOnly: true }, { headers: HEADERS });
  }
  try {
    return NextResponse.json(await getNineRouterDetection(), { headers: HEADERS });
  } catch {
    return NextResponse.json({ available: false }, { headers: HEADERS });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid migration request" }, { status: 400, headers: HEADERS });
    }
    const payload = await resolveSource(request, body);
    if (body.action === "preview") {
      const preview = await previewNineRouterMigration(payload, body.options);
      return NextResponse.json({ success: true, preview }, { headers: HEADERS });
    }
    if (body.action !== "migrate") {
      return NextResponse.json({ error: "Invalid migration action" }, { status: 400, headers: HEADERS });
    }
    if (!(await hasValidCliToken(request)) && !(await verifyDashboardPassword(body.password))) {
      return NextResponse.json(
        { error: "Invalid password", code: "invalid_reauthentication" },
        { status: 401, headers: HEADERS },
      );
    }
    return NextResponse.json(await applyNineRouterMigration(payload, body.options), { headers: HEADERS });
  } catch (error) {
    const message = publicMigrationError(error);
    console.error(`[Settings][9RouterMigration] ${error?.code || "FAILED"}: ${message}`);
    return NextResponse.json(
      { error: message, code: error?.code || "MIGRATION_FAILED" },
      { status: 400, headers: HEADERS },
    );
  }
}
