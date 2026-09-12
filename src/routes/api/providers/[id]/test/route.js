import { NextResponse } from "next/server";
import { testSingleConnection } from "./testUtils.js";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const CONNECTION_TEST_ERROR = publicError("provider", "Provider connection test failed");

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
      latencyMs: result.latencyMs ?? 0,
      testedAt: result.testedAt || new Date().toISOString(),
    });
  } catch (error) {
    logRouteError("ProviderConnectionTest", error);
    return NextResponse.json({ error: CONNECTION_TEST_ERROR }, { status: 500 });
  }
}
