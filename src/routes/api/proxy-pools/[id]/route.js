import { NextResponse } from "next/server";
import {
  deleteProxyPool,
  countConnectionsByProxyPool,
  getProxyPoolById,
  updateProxyPool,
} from "@/models";
import { normalizeProxyUrl } from "@/lib/network/proxyUrl.js";
import { publicProxyPool } from "@/lib/network/relay.js";

function normalizeProxyPoolUpdate(body = {}, existing = {}) {
  const updates = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (has("name")) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return { error: "Name is required" };
    }
    updates.name = name;
  }

  if (has("proxyUrl")) {
    const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
    if (!proxyUrl) {
      return { error: "Proxy URL is required" };
    }
    updates.proxyUrl = proxyUrl;
  }

  if (has("noProxy")) {
    updates.noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  }

  if (has("isActive")) {
    updates.isActive = body?.isActive === true;
  }

  if (has("strictProxy")) {
    updates.strictProxy = body?.strictProxy === true;
  }

  if (has("type")) {
    const validTypes = ["http", "https", "socks5", "socks5h", "vercel", "cloudflare"];
    updates.type = validTypes.includes(body?.type) ? body.type : "http";
  }

  if (has("proxyUrl") || has("type")) {
    const proxyUrl = updates.proxyUrl ?? existing.proxyUrl;
    const proxyType = updates.type ?? existing.type ?? "http";
    try {
      normalizeProxyUrl(proxyUrl, proxyType);
    } catch {
      return { error: "Proxy URL is invalid" };
    }
  }

  return { updates };
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    return NextResponse.json({ proxyPool: publicProxyPool(proxyPool) });
  } catch (error) {
    console.log("Error fetching proxy pool:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pool" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const body = await request.json();
    const normalized = normalizeProxyPoolUpdate(body, existing);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const updated = await updateProxyPool(id, normalized.updates);
    return NextResponse.json({ proxyPool: publicProxyPool(updated) });
  } catch (error) {
    console.log("Error updating proxy pool:", error);
    return NextResponse.json({ error: "Failed to update proxy pool" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const usageMap = await countConnectionsByProxyPool();
    const boundConnectionCount = usageMap.get(id) || 0;

    if (boundConnectionCount > 0) {
      return NextResponse.json(
        {
          error: "Proxy pool is currently in use",
          boundConnectionCount,
        },
        { status: 409 }
      );
    }

    await deleteProxyPool(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting proxy pool:", error);
    return NextResponse.json({ error: "Failed to delete proxy pool" }, { status: 500 });
  }
}
