import { NextResponse } from "next/server";
import { getProxyPoolById, updateProxyPool } from "@/models";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { logRouteError } from "@/lib/errors/publicError";
import { safeProxyError } from "@/lib/network/proxyUrl.js";
import { isRelayProxyType, isSupportedProxyType, testRelayEndpoint } from "@/lib/network/relay.js";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    if (!isSupportedProxyType(proxyPool.type)) {
      return NextResponse.json({ error: "Proxy pool type is unsupported" }, { status: 400 });
    }

    const result = isRelayProxyType(proxyPool.type)
      ? await testRelayEndpoint(proxyPool.proxyUrl, proxyPool.relayToken)
      : await testProxyUrl({ proxyUrl: proxyPool.proxyUrl, proxyType: proxyPool.type });
    const now = new Date().toISOString();

    await updateProxyPool(id, {
      testStatus: result.ok ? "active" : "error",
      lastTestedAt: now,
      lastError: result.ok ? null : (result.error || `Proxy test failed with status ${result.status}`),
    });

    const elapsedMs = Number.isFinite(Number(result.elapsedMs)) ? Math.max(0, Math.round(Number(result.elapsedMs))) : 0;
    const status = Number.isFinite(Number(result.status)) ? Number(result.status) : 0;
    if (result.ok) {
      console.info("[PROXY_POOL_TEST]", {
        poolId: id,
        poolName: proxyPool.name || id,
        outcome: "ok",
        status,
        elapsedMs,
      });
    } else {
      console.warn("[PROXY_POOL_TEST]", {
        poolId: id,
        poolName: proxyPool.name || id,
        outcome: "error",
        status,
        elapsedMs,
        error: "Proxy test failed",
      });
    }

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      error: result.error || null,
      elapsedMs: result.elapsedMs || 0,
      testedAt: now,
    });
  } catch (error) {
    logRouteError("ProxyPoolTest", safeProxyError(error));
    return NextResponse.json({ error: "Failed to test proxy pool" }, { status: 500 });
  }
}
