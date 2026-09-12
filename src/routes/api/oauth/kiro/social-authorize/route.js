import { NextResponse } from "next/server";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const OAUTH_ERROR = publicError("oauth", "Unable to start social sign-in");

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    const { codeVerifier, codeChallenge, state } = generatePKCE();

    const kiroService = new KiroService();
    const authUrl = kiroService.buildSocialLoginUrl(
      provider,
      codeChallenge,
      state
    );

    return NextResponse.json({
      authUrl,
      state,
      codeVerifier,
      codeChallenge,
      provider,
    });
  } catch (error) {
    logRouteError("OAuth][KiroSocialAuthorize", error);
    return NextResponse.json({ error: OAUTH_ERROR }, { status: 500 });
  }
}
