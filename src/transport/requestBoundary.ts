export function stampClientIp(raw: Request, peerIp: string | null): void {
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

  raw.headers.delete("x-swayrouter-real-ip");
  raw.headers.delete("x-forwarded-for");
  raw.headers.delete("x-swayrouter-via-proxy");
  raw.headers.set("x-swayrouter-real-ip", ip);
  if (viaProxy) raw.headers.set("x-swayrouter-via-proxy", "1");
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
  headers.set("x-swayrouter-query-method", "QUERY");
  return new Request(url.toString(), { method: "GET", headers, signal: raw.signal });
}

export function rewritePublicAlias(raw: Request): Request {
  const url = new URL(raw.url);
  const p = url.pathname;
  const to = (dest: string) => {
    url.pathname = dest;
    const next = new Request(url.toString(), raw);
    next.headers.set("x-swayrouter-rewritten", dest);
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
