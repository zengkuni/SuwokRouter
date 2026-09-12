import { NextResponse } from "next/server";
import { getProviderConnectionsPaged } from "@/models";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const BATCH_TEST_ERROR = publicError("provider", "Provider batch test failed");
const CONNECTION_TEST_ERROR = publicError("provider", "Provider connection test failed");
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 500;
import {
  NO_AUTH_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { testSingleConnection } from "../[id]/test/testUtils.js";

function getAuthGroup(providerId, connection = null) {

  if (connection?.authType) {
    if (connection.authType === "oauth") {

      if (NO_AUTH_PROVIDERS[providerId]) return "none";
      return "oauth";
    }
    if (connection.authType === "none") return "none";
    return connection.authType;
  }

  if (NO_AUTH_PROVIDERS[providerId]) return "none";
  if (OAUTH_PROVIDERS[providerId]) return "oauth";
  if (APIKEY_PROVIDERS[providerId]) return "apikey";
  if (
    typeof providerId === "string" &&
    (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) || providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX))
  )
    return "compatible";
  return "apikey";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { mode, providerId } = body;

    if (!mode) {
      return NextResponse.json({ error: "mode is required" }, { status: 400 });
    }

    const validModes = new Set(["provider", "oauth", "none", "apikey", "compatible", "all"]);
    if (!validModes.has(mode)) {
      return NextResponse.json(
        { error: "Invalid mode. Use: provider, oauth, none, apikey, compatible, all" },
        { status: 400 }
      );
    }

    const requestedLimit = Number.parseInt(body.limit, 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_BATCH_LIMIT)
      : DEFAULT_BATCH_LIMIT;

    if (mode === "provider" && !providerId) {
      return NextResponse.json({ error: "providerId is required for provider mode" }, { status: 400 });
    }

    const filter = {
      isActive: true,
      page: 1,
      pageSize: limit,
      ...(mode === "provider" ? { provider: providerId } : {}),
      ...(mode === "oauth" || mode === "none" || mode === "apikey" ? { authType: mode } : {}),
      ...(mode === "compatible"
        ? { providerPrefixes: [OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX] }
        : {}),
    };
    const page = await getProviderConnectionsPaged(filter);
    let connectionsToTest = page.connections;
    const availableTotal = page.total;
    const truncated = availableTotal > limit;

    connectionsToTest = connectionsToTest.slice(0, limit);

    if (connectionsToTest.length === 0) {
      return NextResponse.json({
        mode,
        providerId: providerId || null,
        results: [],
        summary: { total: 0, available: availableTotal ?? 0, passed: 0, failed: 0, truncated },
        limit,
        testedAt: new Date().toISOString(),
      });
    }

    const results = [];
    for (const conn of connectionsToTest) {
      try {
        const data = await testSingleConnection(conn.id);
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name || conn.email || conn.provider,
          authType: conn.authType || getAuthGroup(conn.provider, conn),
          valid: data.valid,
          latencyMs: data.latencyMs || 0,
          error: data.error || null,
          diagnosis: data.diagnosis || null,
          statusCode: data.statusCode || null,
          testedAt: data.testedAt || new Date().toISOString(),
        });
      } catch (error) {
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name || conn.email || conn.provider,
          authType: conn.authType || getAuthGroup(conn.provider, conn),
          valid: false,
          latencyMs: 0,
          error: CONNECTION_TEST_ERROR,
          diagnosis: { type: "network_error", source: "local", code: null, message: CONNECTION_TEST_ERROR },
          statusCode: null,
          testedAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      mode,
      providerId: providerId || null,
      results,
      testedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        available: availableTotal ?? results.length,
        passed: results.filter((r) => r.valid).length,
        failed: results.filter((r) => !r.valid).length,
        truncated,
      },
      limit,
    });
  } catch (error) {
    logRouteError("ProviderBatchTest", error);
    return NextResponse.json({ error: BATCH_TEST_ERROR }, { status: 500 });
  }
}
