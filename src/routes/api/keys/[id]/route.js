import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, getApiKeySecretById, rotateApiKey, updateApiKey } from "@/lib/localDb";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    const secret = await getApiKeySecretById(id);
    return NextResponse.json({ key: secret ? { ...key, key: secret } : key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, rotate } = body;

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
    }
    if (rotate !== undefined && typeof rotate !== "boolean") {
      return NextResponse.json({ error: "rotate must be a boolean" }, { status: 400 });
    }

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    if (rotate === true) {
      const rotated = await rotateApiKey(id);
      return NextResponse.json({ key: rotated, message: "API key rotated. Replace the old secret in your clients." });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    if (error?.code === "DEFAULT_API_KEY") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
