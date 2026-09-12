import { NextResponse } from "next/server";
import { countProviderConnections } from "@/models";
import { normalizeProviderId } from "@/lib/providerNormalization";

function normalizeCountRow(row) {
  const provider = normalizeProviderId(row.provider);
  return {
    provider,
    total: Number(row.total) || 0,
    active: Number(row.active) || 0,
    inactive: Number(row.inactive) || 0,
  };
}

function mergeProviderCounts(rows) {
  const merged = new Map();
  for (const row of rows) {
    const normalized = normalizeCountRow(row);
    const key = String(normalized.provider || "").trim().toLowerCase();
    if (!key) continue;
    const existing = merged.get(key);
    if (existing) {
      existing.total += normalized.total;
      existing.active += normalized.active;
      existing.inactive += normalized.inactive;
    } else {
      merged.set(key, normalized);
    }
  }
  return [...merged.values()];
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const counts = mergeProviderCounts(await countProviderConnections());
    return NextResponse.json({ counts });
  } catch (error) {
    console.log("Error fetching provider counts:", error);
    return NextResponse.json({ error: "Failed to fetch provider counts" }, { status: 500 });
  }
}
