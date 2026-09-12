import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const OAUTH_ERROR = publicError("oauth", "Social sign-in failed");

export async function POST(request) {
  try {
    const { code, codeVerifier, provider } = await request.json();

    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();

    const tokenData = await kiroService.exchangeSocialCode(
      code,
      codeVerifier
    );

    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: provider,
        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
      },
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
    logRouteError("OAuth][KiroSocialExchange", error);
    return NextResponse.json({ error: OAUTH_ERROR }, { status: 500 });
  }
}
