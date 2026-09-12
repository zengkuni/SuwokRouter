import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

const TOOL_ID = /^[a-z0-9_-]{1,64}$/i;

function sanitize(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [toolId, snapshot] of Object.entries(value)) {
    if (!TOOL_ID.test(toolId) || !snapshot || typeof snapshot !== "object") continue;
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries.map((entry) => ({
      sourceModel: typeof entry?.sourceModel === "string" ? entry.sourceModel.trim().slice(0, 512) : "",
      targetModel: typeof entry?.targetModel === "string" ? entry.targetModel.trim().slice(0, 512) : "",
      enabled: entry?.enabled !== false,
    })).filter((entry) => entry.sourceModel && entry.targetModel).slice(0, 256) : [];
    out[toolId] = { enabled: snapshot.enabled !== false, entries };
  }
  return out;
}

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ mappings: settings.cliModelMappings || {} });
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const mappings = sanitize(body?.mappings);
    await updateSettings({ cliModelMappings: mappings });
    return NextResponse.json({ mappings });
  } catch {
    return NextResponse.json({ error: "Invalid model mappings" }, { status: 400 });
  }
}

export async function DELETE() {
  await updateSettings({ cliModelMappings: {} });
  return NextResponse.json({ mappings: {} });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
