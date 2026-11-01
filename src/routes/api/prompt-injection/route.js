import { NextResponse } from "next/server";
import {
  getPromptInjectionState, resolvePromptInjections,
  setInjectGlobal, deleteInjectGlobal,
  setInjectKeyPrompt, deleteInjectKeyPrompt,
  setInjectModelPrompt, deleteInjectModelPrompt,
  setInjectKeyModelPrompt, deleteInjectKeyModelPrompt,
  setTemplate, deleteTemplate,
} from "@/models";

export const dynamic = "force-dynamic";

// GET ?preview=1&model=<name>&keyId=<id>  → stacked injections for one request
// GET                                   → full state (global/byKey/byModel/byKeyModel)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("preview") === "1") {
      const model = searchParams.get("model") || "";
      const keyId = searchParams.get("keyId") || "";
      const stack = await resolvePromptInjections({
        apiKeyId: keyId,
        requestedModel: model,
        resolvedModel: model,
      });
      return NextResponse.json({ stack });
    }
    const state = await getPromptInjectionState();
    return NextResponse.json({ state });
  } catch (error) {
    console.log("Error reading prompt injections:", error);
    return NextResponse.json({ error: "Failed to read prompt injections" }, { status: 500 });
  }
}

// PUT { scope, entry, keyId?, model? }  — scope: global | key | model | keyModel
// PUT { template: {...} }              — create/update a library template
export async function PUT(request) {
  try {
    const body = await request.json();

    if (body?.template && typeof body.template === "object") {
      const template = await setTemplate(body.template);
      if (!template) return NextResponse.json({ error: "Invalid template" }, { status: 400 });
      return NextResponse.json({ ok: true, template });
    }

    const scope = body?.scope;
    const entry = body?.entry && typeof body.entry === "object" ? body.entry : body;
    const keyId = typeof body?.keyId === "string" ? body.keyId.trim() : "";
    const model = typeof body?.model === "string" ? body.model.trim() : "";

    let stored = null;
    if (scope === "global") stored = await setInjectGlobal(entry);
    else if (scope === "key") {
      if (!keyId) return NextResponse.json({ error: "keyId is required" }, { status: 400 });
      stored = await setInjectKeyPrompt(keyId, entry);
    } else if (scope === "model") {
      if (!model) return NextResponse.json({ error: "model is required" }, { status: 400 });
      stored = await setInjectModelPrompt(model, entry);
    } else if (scope === "keyModel") {
      if (!keyId || !model) return NextResponse.json({ error: "keyId and model are required" }, { status: 400 });
      stored = await setInjectKeyModelPrompt(keyId, model, entry);
    } else {
      return NextResponse.json({ error: "Unknown scope" }, { status: 400 });
    }

    if (!stored) return NextResponse.json({ error: "Invalid injection entry" }, { status: 400 });
    return NextResponse.json({ ok: true, entry: stored });
  } catch (error) {
    console.log("Error saving prompt injection:", error);
    return NextResponse.json({ error: "Failed to save prompt injection" }, { status: 500 });
  }
}

// DELETE ?scope=global|key|model|keyModel[&keyId=&model=]
// DELETE ?templateId=<id>  — a library template
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get("templateId") || "";
    if (templateId) {
      const removed = await deleteTemplate(templateId);
      return NextResponse.json({ ok: true, removed });
    }
    const scope = searchParams.get("scope") || "";
    const keyId = searchParams.get("keyId") || "";
    const model = searchParams.get("model") || "";

    let removed = false;
    if (scope === "global") removed = await deleteInjectGlobal();
    else if (scope === "key") removed = await deleteInjectKeyPrompt(keyId);
    else if (scope === "model") removed = await deleteInjectModelPrompt(model);
    else if (scope === "keyModel") removed = await deleteInjectKeyModelPrompt(keyId, model);
    else return NextResponse.json({ error: "Unknown scope" }, { status: 400 });

    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    console.log("Error deleting prompt injection:", error);
    return NextResponse.json({ error: "Failed to delete prompt injection" }, { status: 500 });
  }
}
