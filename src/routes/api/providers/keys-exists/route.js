import { NextResponse } from "next/server";
import { findExistingApiKeys } from "@/models";
import { normalizeProviderId } from "@/lib/providerNormalization";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const apiKeys = Array.isArray(body.apiKeys)
      ? body.apiKeys.filter((key) => typeof key === "string")
      : [];
    if (!provider || !apiKeys.length) {
      return NextResponse.json({ existingKeys: [] });
    }
    const existingKeys = await findExistingApiKeys(provider, apiKeys);
    return NextResponse.json({ existingKeys });
  } catch (error) {
    console.log("Error checking existing provider keys:", error);
    return NextResponse.json({ error: "Failed to check existing keys" }, { status: 500 });
  }
}
