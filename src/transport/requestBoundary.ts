import { readFileSync } from "node:fs";

/**
 * Set by the boundary when the peer address belongs to the machine hosting this
 * container, which is how a host-local request reaches a published port. Never
 * trusted from the wire: stampClientIp deletes any inbound copy first.
 */
export const HOST_PEER_HEADER = "x-suwokrouter-host-peer";

/** Aliases a container runtime publishes for the machine that runs the container. */
const HOST_ALIASES = ["host.docker.internal", "host.containers.internal", "gateway.docker.internal"];

export type HostPeerTrust = {
  /** Default gateway: how a host-local request reaches a plain bridge container. */
  gateway: string | null;
  /** Hosting machine as seen from inside the container, when the runtime publishes it. */
  hostAddress: string | null;
};

let cachedDefaultGateway: string | null | undefined;

/**
 * Default gateway of this machine, read once from the kernel route table. A request
 * made from the host to a published port of a plain bridge container arrives from
 * that gateway instead of loopback, so the peer alone cannot prove host locality.
 */
function containerDefaultGateway(): string | null {
  if (cachedDefaultGateway !== undefined) return cachedDefaultGateway;
  cachedDefaultGateway = null;
  try {
    for (const line of readFileSync("/proc/net/route", "utf8").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 3 || cols[1] !== "00000000" || !/^[0-9A-Fa-f]{8}$/.test(cols[2] as string)) continue;
      const value = parseInt(cols[2] as string, 16);
      cachedDefaultGateway = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join(".");
      break;
    }
  } catch {
    cachedDefaultGateway = null;
  }
  return cachedDefaultGateway;
}

/**
 * Desktop container runtimes forward host-local traffic from their VM network, so
 * the peer is a host-side address beside the published host alias rather than the
 * container gateway. Only the /24 that the runtime already dedicates to that link
 * is trusted, never a LAN-wide range.
 */
function isHostLinkAddress(peer: string, hostAddress: string): boolean {
  const peerParts = peer.split(".");
  const hostParts = hostAddress.split(".");
  return peerParts.length === 4
    && hostParts.length === 4
    && peerParts[0] === hostParts[0]
    && peerParts[1] === hostParts[1]
    && peerParts[2] === hostParts[2];
}


/** Startup must not stall on a resolver that never answers for an absent alias. */
const HOST_ALIAS_TIMEOUT_MS = 1_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  const { promise, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error("host alias lookup timed out")), ms);
  return Promise.race([work, promise]).finally(() => clearTimeout(timer));
}

async function resolveHostAddress(): Promise<string | null> {
  for (const alias of HOST_ALIASES) {
    try {
      const records = await withTimeout(Bun.dns.lookup(alias, { family: 4 }), HOST_ALIAS_TIMEOUT_MS);
      const address = records.find((record) => record.address)?.address;
      if (address) return address;
    } catch {
      // This runtime does not publish that alias; try the next one.
    }
  }
  return null;
}

/**
 * Resolve once at startup: the two addresses that identify host-local traffic.
 * Resolution is async, so the boundary takes the result instead of guessing later.
 */
export async function resolveHostPeerTrust(): Promise<HostPeerTrust> {
  return { gateway: containerDefaultGateway(), hostAddress: await resolveHostAddress() };
}

function isHostPeer(peer: string, trust: HostPeerTrust): boolean {
  if (!peer) return false;
  if (trust.gateway === peer) return true;
  return trust.hostAddress !== null && isHostLinkAddress(peer, trust.hostAddress);
}

export function stampClientIp(raw: Request, peerIp: string | null, trust: HostPeerTrust): void {
  const peer = (peerIp || "").replace(/^::ffff:/, "");
  const isLoopback = peer === "127.0.0.1" || peer === "::1";
  const xff = raw.headers.get("x-forwarded-for");
  const xRealIp = raw.headers.get("x-real-ip");
  const viaProxy = Boolean(xff || xRealIp);

  let ip = peer;
  if (isLoopback) {
    const proxyIp = xRealIp ?? (xff ? String(xff).split(",")[0]?.trim() : "");
    if (proxyIp) ip = proxyIp;
  }

  raw.headers.delete("x-suwokrouter-real-ip");
  raw.headers.delete("x-forwarded-for");
  raw.headers.delete("x-suwokrouter-via-proxy");
  raw.headers.delete(HOST_PEER_HEADER);
  raw.headers.set("x-suwokrouter-real-ip", ip);
  if (viaProxy) raw.headers.set("x-suwokrouter-via-proxy", "1");
  if (!isLoopback && isHostPeer(peer, trust)) raw.headers.set(HOST_PEER_HEADER, "1");
}

const KIB = 1024;
const MIB = 1024 * KIB;

export function getRequestBodyLimitBytes(pathname: string, method = "GET"): number {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(String(method).toUpperCase())) return 0;
  const path = String(pathname || "");
  if (path === "/api/v1/images/generations" || path === "/v1/images/generations") return 256 * KIB;
  if (path === "/api/v1/images/edits" || path === "/v1/images/edits") return 10 * MIB;
  if (
    path === "/api/v1/chat/completions" ||
    path === "/v1/chat/completions" ||
    path === "/api/v1/responses" ||
    path === "/v1/responses" ||
    path === "/api/v1/messages" ||
    path === "/v1/messages" ||
    path === "/codex" ||
    path === "/responses"
  ) return 8 * MIB;
  if (path === "/api/settings/database" || path === "/api/settings/migrate-9router") return 25 * MIB;
  return 1 * MIB;
}

function declaredContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function estimateRequestBodyBytes(request: Request, maxBytes: number): number {
  if (maxBytes <= 0 || !request.body) return 0;
  const declared = declaredContentLength(request);
  if (declared === null) return maxBytes;
  if (declared > maxBytes) return 0;
  return declared;
}

/**
 * Assign a small amount of work budget to large bodies. Active request count
 * alone treats an 8 MiB prompt and a tiny health check as identical, which
 * lets a burst of large uploads consume the event loop and memory at once.
 */
export function estimateRequestWorkUnits(request: Request, maxBytes: number): number {
  if (maxBytes <= 0 || !request.body) return 1;
  const declared = declaredContentLength(request);
  const size = declared === null ? Math.min(maxBytes, 512 * KIB) : declared;
  if (size <= 256 * KIB) return 1;
  if (size <= 1 * MIB) return 2;
  return Math.min(8, 1 + Math.ceil(size / MIB));
}

export async function readRequestBodyWithLimit(
  raw: Request,
  maxBytes: number,
  timeoutMs = 30_000,
): Promise<{ request: Request; tooLarge: boolean }> {
  const declared = declaredContentLength(raw);
  if (declared !== null && declared > maxBytes) return { request: raw, tooLarge: true };
  if (!raw.body) return { request: raw, tooLarge: false };

  const reader = raw.body.getReader();
  const declaredBody = declared === null ? null : new Uint8Array(declared);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortHandler: (() => void) | null = null;
  const abortPromise = raw.signal
    ? new Promise<never>((_, reject) => {
      abortHandler = () => {
        const error = new Error("Request body read aborted");
        (error as Error & { code?: string }).code = "REQUEST_ABORTED";
        reject(error);
      };
      if (raw.signal.aborted) abortHandler();
      else raw.signal.addEventListener("abort", abortHandler, { once: true });
    })
    : null;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const readPromise = reader.read();
      const timeoutPromise = timeoutMs > 0
        ? new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error("Request body read timed out");
            (error as Error & { code?: string }).code = "REQUEST_BODY_TIMEOUT";
            reject(error);
          }, timeoutMs);
        })
        : null;
      let result;
      try {
        if (timeoutPromise && abortPromise) {
          result = await Promise.race([readPromise, timeoutPromise, abortPromise]);
        } else if (timeoutPromise) {
          result = await Promise.race([readPromise, timeoutPromise]);
        } else if (abortPromise) {
          result = await Promise.race([readPromise, abortPromise]);
        } else {
          result = await readPromise;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
      const { done, value } = result;
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes || (declared !== null && total > declared)) {
        await reader.cancel("request body too large").catch(() => {});
        return { request: raw, tooLarge: true };
      }
      if (declaredBody) declaredBody.set(chunk, total - chunk.byteLength);
      else chunks.push(chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    const code = (error as Error & { code?: string })?.code;
    if (code === "REQUEST_BODY_TIMEOUT" || code === "REQUEST_ABORTED") throw error;
    throw new Error("Unable to read request body");
  } finally {
    if (raw.signal && abortHandler) raw.signal.removeEventListener("abort", abortHandler);
  }

  const body = declaredBody ?? new Uint8Array(total);
  if (!declaredBody) {
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  const bodyView = body.byteLength === total ? body : body.subarray(0, total);
  return {
    request: new Request(raw.url, {
      method: raw.method,
      headers: raw.headers,
      body: bodyView.byteLength ? bodyView : undefined,
      signal: raw.signal,
    }),
    tooLarge: false,
  };
}

export function downgradeH2c(raw: Request): void {
  if ((raw.headers.get("upgrade") || "").toLowerCase() !== "h2c") return;
  raw.headers.delete("upgrade");
  raw.headers.delete("http2-settings");
  raw.headers.set("connection", "close");
}

export function queryCanonicalPath(pathname: string): string {
  if (pathname === "/v1") return "/api/v1";
  if (pathname.startsWith("/v1/")) return `/api/v1/${pathname.slice(4)}`;
  if (pathname === "/codex") return "/api/v1/responses";
  if (pathname.startsWith("/codex/")) return `/api/v1/responses/${pathname.slice("/codex/".length)}`;
  if (pathname === "/responses") return "/api/v1/responses";
  if (pathname.startsWith("/responses/")) return `/api/v1/responses/${pathname.slice("/responses/".length)}`;
  return pathname;
}

export function isQueryReadOnlyPath(pathname: string): boolean {
  const canonical = queryCanonicalPath(pathname);
  if (!canonical.startsWith("/api/")) return false;
  return !(
    canonical.startsWith("/api/v1") ||
    canonical.startsWith("/api/chat") ||
    canonical.startsWith("/api/auth") ||
    canonical.startsWith("/api/cli-tools") ||
    canonical.startsWith("/api/providers/test") ||
    canonical.startsWith("/api/providers/validate") ||
    canonical.startsWith("/api/connections")
  );
}

export function normalizeQueryRequest(raw: Request): Request {
  if (raw.method.toUpperCase() !== "QUERY") return raw;
  const url = new URL(raw.url);
  if (!isQueryReadOnlyPath(url.pathname)) return raw;
  const headers = new Headers(raw.headers);
  headers.set("x-suwokrouter-query-method", "QUERY");
  return new Request(url.toString(), { method: "GET", headers, signal: raw.signal });
}

export function rewritePublicAlias(raw: Request): Request {
  const url = new URL(raw.url);
  const p = url.pathname;
  const to = (dest: string) => {
    url.pathname = dest;
    const next = new Request(url.toString(), raw);
    next.headers.set("x-suwokrouter-rewritten", dest);
    return next;
  };

  if (p.startsWith("/v1/v1/")) return to(`/api/v1/${p.slice("/v1/v1/".length)}`);
  if (p === "/v1/v1") return to("/api/v1");
  if (p.startsWith("/codex/")) return to(`/api/v1/responses/${p.slice("/codex/".length)}`);
  if (p === "/codex") return to("/api/v1/responses");
  if (p.startsWith("/responses/")) return to(`/api/v1/responses/${p.slice("/responses/".length)}`);
  if (p === "/responses") return to("/api/v1/responses");
  if (p.startsWith("/v1/")) return to(`/api/v1/${p.slice("/v1/".length)}`);
  if (p === "/v1") return to("/api/v1");
  return raw;
}
