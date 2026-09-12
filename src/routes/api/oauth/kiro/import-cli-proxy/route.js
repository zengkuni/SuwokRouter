import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { normalizeKiroExternalIdpAuth } from "@/lib/oauth/kiroExternalIdp";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const OAUTH_ERROR = publicError("oauth", "CLIProxyAPI import failed");

export async function POST(request) {
  try {
    const body = await request.json();
    const rawAuth = body?.cliProxyAuth ?? body?.auth ?? body?.json ?? body;
    const tokenData = normalizeKiroExternalIdpAuth(rawAuth);

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      autoName: body?.autoName === true || !(typeof body?.name === "string" && body.name.trim()),
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt,
      email: tokenData.email || null,
      providerSpecificData: tokenData.providerSpecificData,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    logRouteError("OAuth][KiroCliProxyImport", error);
    return NextResponse.json(
      { error: OAUTH_ERROR },
      { status: 400 }
    );
  }
}
