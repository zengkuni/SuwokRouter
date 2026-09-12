process.env.PORT = process.env.PORT || String(envPortFallback());

import { Hono } from "hono";
import pkg from "../package.json" with { type: "json" };
import { env } from "@/lib/env";
import {
  stampClientIp,
  downgradeH2c,
  isQueryReadOnlyPath,
  normalizeQueryRequest,
  rewritePublicAlias,
  getRequestBodyLimitBytes,
  estimateRequestBodyBytes,
  estimateRequestWorkUnits,
  readRequestBodyWithLimit,
} from "@/transport/requestBoundary";
import { routerAdmission, wrapResponseWithAdmission } from "@/transport/routerAdmission";
import { cookieStoreAls, NextResponse, PASSTHROUGH } from "@/next/server";
import { createRequestContext } from "@/lib/guardRequest";
import * as dashboardGuard from "@/dashboardGuard";
import { ROUTE_LOADERS, ROUTE_TABLE } from "@/routes/table";
import { initializeApp, shutdownApp } from "@/shared/services/initializeApp";
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer.js";
import { initTranslators } from "@/translator/index";
import { tryServeDashboard } from "@/staticServe";
import { closeAdapter } from "@/lib/db/driver.js";
import { flushAllWriteBehindBuffers } from "@/lib/db/writeBehind.js";
import { flushRequestDetails } from "@/lib/db/repos/requestDetailsRepo.js";
import {
  getConsistentMachineId,
} from "@/shared/utils/machineId";
import {
  toPrometheus,
  recordHttpRequest,
  sampleProcessStats,
  restoreMetrics,
  persistMetrics,
  inFlightRequests,
} from "@/observability/metrics";

import { ensureTraceContext, stampResponseWithTrace } from "@/observability/tracing.js";
import { markLifecycleStarted, markLifecycleReady, markLifecycleDegraded, markLifecycleStopping, markLifecycleStopped, registerShutdownHandler } from "@/lifecycle/appLifecycle";

function envPortFallback() {
  return Number.parseInt(process.env.PORT || "", 10) || 14045;
}

markLifecycleStarted();
const app = new Hono();

const routeModuleCache = new Map<string, Promise<Record<string, unknown>>>();
function loadRouteModule(file: string) {
  let modulePromise = routeModuleCache.get(file);
  if (!modulePromise) {
    const loader = (ROUTE_LOADERS as Record<string, () => Promise<Record<string, unknown>>>)[file];
    if (!loader) throw new Error(`Route loader is missing for ${file}`);
    modulePromise = loader();
    routeModuleCache.set(file, modulePromise);
  }
  return modulePromise;
}

function extractParams(c: any, pathPattern: string, params: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of params) {

    const isCatchAll = pathPattern.includes(`:${name}*`);
    const value = c.req.param(isCatchAll ? `${name}*` : name);
    if (value === undefined) continue;

    out[name] = isCatchAll ? value.split("/").filter(Boolean) : value;
  }
  return out;
}

function routeCmp(a: { method: string; pathPattern: string }, b: { method: string; pathPattern: string }) {
  if (a.method !== b.method) return a.method.localeCompare(b.method);
  const sa = a.pathPattern.split("/");
  const sb = b.pathPattern.split("/");
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const x = sa[i] ?? "";
    const y = sb[i] ?? "";
    if (x === y) continue;
    if (x === "") return -1;
    if (y === "") return 1;
    const xParam = x.startsWith(":");
    const yParam = y.startsWith(":");
    if (xParam !== yParam) return xParam ? 1 : -1;
    return x.localeCompare(y);
  }
  return a.pathPattern.length - b.pathPattern.length;
}

const ROUTE_ORDER = [...ROUTE_TABLE].sort(routeCmp);

for (const row of ROUTE_ORDER) {
  const method = row.method.toLowerCase() as
    | "get"
    | "post"
    | "put"
    | "patch"
    | "delete"
    | "head"
    | "options";
  const handler = async (c: any) => {
    try {

      const store = cookieStoreAls.getStore();
      const mod = await loadRouteModule(row.file);
      const routeHandler = mod[row.method];
      if (typeof routeHandler !== "function") {
        return NextResponse.json({ error: "Not Found" }, { status: 404 });
      }

      const paramsObj = extractParams(c, row.pathPattern, row.params);

      const res = await routeHandler(c.req.raw, { params: paramsObj });

      const cookieStore = store?.cookies;
      if (cookieStore && cookieStore.__set.length > 0) {
        const headers = new Headers(res.headers);
        for (const line of cookieStore.__set) headers.append("set-cookie", line);
        return new NextResponse(res.body, { status: res.status, headers });
      }
      return res;
    } catch (error) {
      console.error(`[route:${row.pathPattern}]`, error);
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  };

  app.on(method, row.pathPattern, handler);
}

app.get("/health", (c) =>
  c.json({
    ok: true,
    name: "sway-router",
    version: pkg.version,
    time: new Date().toISOString(),
  }),
);

app.get("/version", (c) =>
  c.json({
    ok: true,
    name: "sway-router",
    version: pkg.version,
  }),
);

app.get("/", (c) => c.json({ ok: true, service: "sway-router", docs: "/health" }));

const METRICS_TOKEN = env.metricsToken;
const CLI_TOKEN_CACHE: { v?: string } = {};
async function cliToken() {
  if (CLI_TOKEN_CACHE.v !== undefined) return CLI_TOKEN_CACHE.v;
  try {
    CLI_TOKEN_CACHE.v = await getConsistentMachineId("swayrouter-cli-auth");
  } catch {
    CLI_TOKEN_CACHE.v = "";
  }
  return CLI_TOKEN_CACHE.v;
}

app.get("/metrics", async (c) => {
  const presented = c.req.header("x-swayrouter-cli-token") || "";
  const isLocal =
    (c.req.header("x-swayrouter-real-ip") || "").startsWith("127.0.0.1") ||
    (c.req.header("x-swayrouter-real-ip") || "") === "::1";
  const token = await cliToken();
  const allowedLocal = isLocal && env.metricsLocal;
  const allowedCliToken = token && presented === token;
  const allowedEnvToken = METRICS_TOKEN && presented === METRICS_TOKEN;
  if (!allowedLocal && !allowedCliToken && !allowedEnvToken) {
    return c.text("Unauthorized", 401);
  }
  return new Response(toPrometheus(), {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
});

initConsoleLogCapture();

initTranslators();

restoreMetrics().catch((e) => console.error("[metrics:restore]", e));

const server = Bun.serve({
  port: env.port,
  hostname: env.hostname,

  idleTimeout: 0,
  async fetch(request, server) {
    const t0 = Date.now();
    const pathname = new URL(request.url).pathname;
    const isProxyPath = isGatewayRequestPath(pathname);
    const bodyLimit = getRequestBodyLimitBytes(pathname, request.method);
    let admissionLease: { release(): void; releaseBody(): void } | null = null;
    let admissionTransferred = false;
    if (isProxyPath) {
      let admitted;
      try {
        admitted = await routerAdmission.acquire(
          estimateRequestBodyBytes(request, bodyLimit),
          request.signal,
          estimateRequestWorkUnits(request, bodyLimit),
        );
      } catch (error) {
        console.error("[admission] acquire failed:", error instanceof Error ? error.message : String(error));
        const response = new Response(JSON.stringify({
          error: { message: "Internal server error", code: "internal_server_error" },
        }), {
          status: 500,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
          },
        });
        try {
          recordHttpRequest(request.method, routeShapeFor(request.url), response.status, Date.now() - t0);
        } catch (recordError) {
          console.error("[admission] failed to record acquire error:", recordError instanceof Error ? recordError.message : String(recordError));
        }
        return response;
      }
      if (!admitted.ok || !admitted.lease) {
        const aborted = admitted.reason === "aborted";
        const response = new Response(JSON.stringify({
          error: {
            message: aborted ? "Request aborted" : "Router is temporarily busy",
            code: aborted ? "request_aborted" : "router_capacity_exhausted",
          },
        }), {
          status: aborted ? 499 : 503,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": aborted ? "0" : "2",
          },
        });
        try {
          recordHttpRequest(request.method, routeShapeFor(request.url), response.status, Date.now() - t0);
        } catch (recordError) {
          console.error("[admission] failed to record rejection:", recordError instanceof Error ? recordError.message : String(recordError));
        }
        return response;
      }
      admissionLease = admitted.lease;
      if (isProxyPath) inFlightRequests.set({}, ((inFlightRequests.value({}) ?? 0) as number) + 1);
    }

    try {
      let bounded;
      try {
        bounded = bodyLimit > 0
          ? await readRequestBodyWithLimit(request, bodyLimit, env.routerBodyReadTimeoutMs)
          : { request, tooLarge: false };
      } catch (error) {
        const code = (error as Error & { code?: string })?.code;
        const status = request.signal.aborted ? 499 : code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
        const response = new Response(JSON.stringify({
          error: request.signal.aborted ? "Request aborted" : code === "REQUEST_BODY_TIMEOUT" ? "Request body read timed out" : "Unable to read request body",
        }), {
          status,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
          },
        });
        recordHttpRequest(request.method, routeShapeFor(request.url), response.status, Date.now() - t0);
        return response;
      }
      if (bounded.tooLarge) {
        const response = new Response(JSON.stringify({ error: "Request body too large" }), {
          status: 413,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
          },
        });
        recordHttpRequest(request.method, routeShapeFor(request.url), response.status, Date.now() - t0);
        return response;
      }
      const dispatchRequest = bounded.request;

      stampClientIp(dispatchRequest, server.requestIP(request)?.address ?? null);
      downgradeH2c(dispatchRequest);

      const isQuery = dispatchRequest.method.toUpperCase() === "QUERY";
      if (isQuery && !isQueryReadOnlyPath(pathname)) {
        const queryResp = NextResponse.json(
          { error: "QUERY is supported only for read-only API routes" },
          { status: 405, headers: { Allow: "GET" } },
        );
        recordHttpRequest(dispatchRequest.method, routeShapeFor(dispatchRequest.url), queryResp.status, Date.now() - t0);
        return queryResp;
      }
      const { store, guardRequest } = createRequestContext(dispatchRequest) as {
        store: { cookies: { __set: string[] } };
        guardRequest: object;
      };

      const trace = ensureTraceContext(
        store as { trace?: unknown },
        dispatchRequest.headers.get("traceparent"),
        dispatchRequest.headers.get("tracestate"),
      );

      const isMetricsScrape = pathname === "/metrics";
      const resp = await cookieStoreAls.run(store, async () => {
        const guarded = (await dashboardGuard.proxy(guardRequest)) as
          | (NextResponse & { [PASSTHROUGH]?: boolean })
          | undefined;
        if (guarded && !guarded[PASSTHROUGH]) {

          const cookieStore = store.cookies;
          if (cookieStore.__set.length > 0) {
            const headers = new Headers(guarded.headers);
            for (const line of cookieStore.__set) headers.append("set-cookie", line);
            return new NextResponse(guarded.body, { status: guarded.status, headers });
          }
          return guarded;
        }

        const staticRes = tryServeDashboard(dispatchRequest);
        if (staticRes) return staticRes;

        const dispatched = rewritePublicAlias(normalizeQueryRequest(dispatchRequest));

        return await app.fetch(dispatched, server);
      });
      // The body has been fully consumed before app.fetch returns. Do not
      // reserve upload memory while a long streaming response is in flight.
      admissionLease?.releaseBody();
      if (!isMetricsScrape) {
        const routeShape = routeShapeFor(dispatchRequest.url);
        recordHttpRequest(dispatchRequest.method, routeShape, resp.status, Date.now() - t0);
      }

      const stamped = isMetricsScrape ? resp : stampResponseWithTrace(resp, trace);
      if (isProxyPath && admissionLease) {
        const releaseAdmission = () => {
          admissionLease?.releaseBody();
          admissionLease?.release();
        };
        const wrapped = wrapResponseWithAdmission(stamped, releaseAdmission);
        admissionTransferred = true;
        return wrapped;
      }
      return stamped;
    } catch (error) {
      // Keep request failures inside the HTTP boundary. Re-throwing here lets
      // Bun terminate the fetch handler without a response, which clients see
      // as ECONNRESET instead of a useful 5xx. The admission lease is released
      // by finally below, just like the normal response path.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[request] ${request.method} ${pathname} failed:`, message);

      const failure = new Response(JSON.stringify({
        error: {
          message: "Internal server error",
          code: "internal_server_error",
        },
      }), {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });

      if (pathname !== "/metrics") {
        try {
          recordHttpRequest(request.method, routeShapeFor(request.url), 500, Date.now() - t0);
        } catch (recordError) {
          console.error("[request] failed to record request error:", recordError instanceof Error ? recordError.message : String(recordError));
        }
      }

      return failure;
    } finally {
      if (!admissionTransferred) {
        admissionLease?.releaseBody();
        admissionLease?.release();
      }
      if (isProxyPath) {
        const v = (inFlightRequests.value({}) ?? 0) as number;
        inFlightRequests.set({}, Math.max(0, v - 1));
      }
    }
  },
});

function routeShapeFor(urlStr: string): string {
  try {
    const p = new URL(urlStr).pathname;

    return p
      .replace(/\/[0-9a-fA-F]{8,}([/-].*)?$/, "/:id")
      .replace(/\/(\d+)$/, "/:id");
  } catch {
    return "unknown";
  }
}

function isGatewayRequestPath(pathname: string): boolean {
  return /^\/(?:v1|api\/v1|codex|responses)(?:\/|$)/.test(pathname);
}

const statsTimer = setInterval(sampleProcessStats, 15000);
// @ts-ignore - Bun's Timer has unref; Node's typing doesn't expose it here.
statsTimer.unref?.();

let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function gracefulShutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  markLifecycleStopping();
  routerAdmission.stopAccepting();
  clearInterval(statsTimer);

  try { await server.stop(false); } catch (e) { console.error("[shutdown] stop listener failed:", e instanceof Error ? e.message : String(e)); }

  let timedOut = false;
  const drain = (async () => {
    await shutdownApp();
    await flushRequestDetails();
    await flushAllWriteBehindBuffers();
    await persistMetrics();
    await closeAdapter();
  })();
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    shutdownTimer = setTimeout(() => { timedOut = true; resolve(); }, SHUTDOWN_TIMEOUT_MS);
  });
  await Promise.race([
    drain.catch((e) => console.error("[shutdown] drain failed:", e instanceof Error ? e.message : String(e))),
    timeout,
  ]);
  if (shutdownTimer) clearTimeout(shutdownTimer);
  if (timedOut) console.error(`[shutdown] drain exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing connection close`);

  try { await server.stop(true); } catch {}
  markLifecycleStopped();

  // Do not leave a half-alive process behind after the listener is closed.
  // A supervisor (Docker/systemd/NSSM) can then restart a non-zero fatal exit.
  process.exitCode = exitCode;
  process.exit(exitCode);
}
registerShutdownHandler(gracefulShutdown);
process.on("SIGINT", () => { void gracefulShutdown(0); });
process.on("SIGTERM", () => { void gracefulShutdown(0); });
process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaught exception:", error);
  void gracefulShutdown(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled rejection:", reason);
  void gracefulShutdown(1);
});

initializeApp()
  .then(() => markLifecycleReady())
  .catch((e) => {
    console.error("[init]", e);
    markLifecycleDegraded(e);
  });

console.log(`[sway-router] listening on http://localhost:${server.port}`);
