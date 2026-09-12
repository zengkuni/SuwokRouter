import { NextResponse } from "next/server";
import { pingModelByKind } from "./ping";

export async function POST(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const result = await pingModelByKind(model, kind || "llm");
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Models][Test]", err);
    return NextResponse.json({ ok: false, error: "Model test failed" }, { status: 500 });
  }
}
