import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import { comboGroupError, normalizeComboGroup } from "../comboGroupValidation.js";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    // `id` is a UUID for the dashboard; the chat agent knows combos by name,
    // so fall back to a name lookup before reporting "not found".
    const combo = (await getComboById(id)) ?? (await getComboByName(id));

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }

      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    if (body.group !== undefined) {
      const groupError = comboGroupError(body.group);
      if (groupError) {
        return NextResponse.json({ error: groupError }, { status: 400 });
      }
    }

    if (body.disabledModels !== undefined && (!Array.isArray(body.disabledModels) || !body.disabledModels.every((m) => typeof m === "string"))) {
      return NextResponse.json({ error: "disabledModels must be an array of model ids" }, { status: 400 });
    }

    const prev = await getComboById(id);
    const combo = await updateCombo(id, body.group === undefined ? body : { ...body, group: normalizeComboGroup(body.group) });

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const prev = await getComboById(id);
    const success = await deleteCombo(id);

    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
