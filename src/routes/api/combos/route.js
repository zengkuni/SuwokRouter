import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { comboGroupError, normalizeComboGroup } from "./comboGroupValidation.js";

export const dynamic = "force-dynamic";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind, group, disabledModels } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const groupError = comboGroupError(group);
    if (groupError) {
      return NextResponse.json({ error: groupError }, { status: 400 });
    }

    if (disabledModels !== undefined && (!Array.isArray(disabledModels) || !disabledModels.every((m) => typeof m === "string"))) {
      return NextResponse.json({ error: "disabledModels must be an array of model ids" }, { status: 400 });
    }

    const combo = await createCombo({ name, models: models || [], kind: kind || null, group: normalizeComboGroup(group), disabledModels: disabledModels || [] });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
