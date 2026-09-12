import { NextResponse } from "next/server";
import { getCustomModels, addCustomModel, deleteCustomModel } from "@/models";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { resolveProviderId } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await getCustomModels();
    return NextResponse.json({
      models: models.map((model) => {
        const provider = resolveProviderId(model.providerAlias);
        const capabilities = getCapabilitiesForModel(provider, model.id, model.capabilities || null);
        return {
          ...model,
          capabilities,
          thinkingLevels: getThinkingLevels(provider, model.id, model.capabilities || null),
        };
      }),
    });
  } catch (error) {
    console.log("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { providerAlias, id, type, name, capabilities } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const added = await addCustomModel({ providerAlias, id, type: type || "llm", name, capabilities });
    return NextResponse.json({ success: true, added });
  } catch (error) {
    console.log("Error adding custom model:", error);
    return NextResponse.json({ error: "Failed to add custom model" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "llm";
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    await deleteCustomModel({ providerAlias, id, type });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting custom model:", error);
    return NextResponse.json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}
