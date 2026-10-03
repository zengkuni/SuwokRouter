import dns from "node:dns/promises";
import net from "node:net";
import { NextResponse } from "@/next/server";
import { fetchWithSsrfGuard, isUnsafeIp, SsrfGuardError } from "@/shared/utils/ssrfGuard.js";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";
import { RUNTIME_CONFIG } from "@/shared/constants/config.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URL_LENGTH = 2_000;
const MAX_BODY_LENGTH = 1_000_000;
const CURL_TIMEOUT_MS = 8_000;
const ALLOW_PRIVATE_TARGETS = () => process.env.SSRF_ALLOW_PRIVATE === "true";
// Cloud metadata endpoints stay blocked even when private targets are allowed.
const BLOCKED_METADATA_HOSTNAMES = new Set([
  "metadata", "metadata.google.internal", "instance-data", "169.254.169.254",
]);
// Loopback targets on the router's own port are the router talking to itself;
// the internal CLI token (machine-derived, accepted by dashboardGuard's
// hasValidCliToken) lets the agent call its own API without an API key.
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
let cachedSelfToken = null;

class CurlInputError extends Error {}

function isPrivateAddress(address) {
  return net.isIP(address) > 0 && isUnsafeIp(address);
}

function isSelfUrl(parsed) {
  return LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase()) &&
    Number(parsed.port) === RUNTIME_CONFIG.appPort;
}

async function selfTokenHeader(parsed) {
  if (!isSelfUrl(parsed)) return null;
  if (!cachedSelfToken) {
    try { cachedSelfToken = await getConsistentMachineId("suwokrouter-cli-auth"); }
    catch { return null; }
  }
  return cachedSelfToken ? { "x-suwokrouter-cli-token": cachedSelfToken } : null;
}

async function assertPublicUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new CurlInputError("URL is required");
  const raw = value.trim();
  if (raw.length > MAX_URL_LENGTH) throw new CurlInputError(`URL must be ${MAX_URL_LENGTH} characters or fewer`);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new CurlInputError("URL must be valid"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new CurlInputError("Only http:// and https:// URLs are allowed");
  if (parsed.username || parsed.password) throw new CurlInputError("URLs with embedded credentials are not allowed");
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_METADATA_HOSTNAMES.has(hostname)) throw new CurlInputError("Cloud metadata endpoints are not allowed");
  // The router talking to itself over loopback on its own port is not an SSRF
  // risk: allow it even without SSRF_ALLOW_PRIVATE so the chat agent can
  // inspect its own API (/api/models, /api/combos, ...) out of the box.
  if (isSelfUrl(parsed)) return parsed;
  // SSRF_ALLOW_PRIVATE=true opts a self-hosted instance into LAN/loopback
  // targets (the chat curl tool then behaves like a local curl).
  if (ALLOW_PRIVATE_TARGETS()) return parsed;
  if (isPrivateAddress(parsed.hostname)) throw new CurlInputError("Private and loopback targets are not allowed");
  if (hostname === "localhost" || hostname === "metadata" || hostname === "metadata.google.internal" || hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".localhost") || hostname.endsWith(".lan")) {
    throw new CurlInputError("Private and metadata hostnames are not allowed");
  }
  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new CurlInputError("URL resolves to a private or loopback address");
    }
  } catch (error) {
    if (error instanceof CurlInputError) throw error;
    throw new CurlInputError("URL host could not be resolved safely");
  }
  return parsed;
}

async function readBoundedBody(response) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    const remaining = MAX_BODY_LENGTH - bytes;
    if (chunk.byteLength > remaining) {
      if (remaining > 0) chunks.push(decoder.decode(chunk.slice(0, remaining), { stream: false }));
      try { await reader.cancel("body limit reached"); } catch {              }
      return { text: chunks.join(""), truncated: true };
    }
    bytes += chunk.byteLength;
    chunks.push(decoder.decode(chunk, { stream: true }));
  }
  chunks.push(decoder.decode());
  return { text: chunks.join(""), truncated: false };
}

export async function POST(request) {
  let timer;
  try {
    const body = await request.json().catch(() => ({}));
    const SAFE_METHODS = new Set(["GET", "HEAD"]);
    const method = String(body?.method || "GET").toUpperCase();
    if (!SAFE_METHODS.has(method) && !["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new CurlInputError("Allowed methods: GET, HEAD, POST, PUT, PATCH, DELETE");
    }
    const url = await assertPublicUrl(body?.url);
    let payload;
    if (SAFE_METHODS.has(method)) {
      if (body?.body !== undefined) throw new CurlInputError("GET and HEAD requests cannot have a body");
    } else if (body?.body !== undefined) {
      if (typeof body.body !== "object" || body.body === null) {
        throw new CurlInputError("body must be a JSON object");
      }
      const serialized = JSON.stringify(body.body);
      if (serialized.length > MAX_BODY_LENGTH) throw new CurlInputError("Request body is too large");
      payload = serialized;
    }
    // Writable methods stay scoped to the router's own API (loopback + own
    // port): the agent may reorder combos / flip settings on itself, but
    // never mutate an arbitrary host.
    if (!SAFE_METHODS.has(method) && !isSelfUrl(url)) {
      throw new CurlInputError("POST/PUT/PATCH/DELETE are only allowed against the router's own API (loopback on its own port)");
    }
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), CURL_TIMEOUT_MS);
    const headers = { Accept: "application/json, text/plain, text/html, */*", "User-Agent": "SuwokRouter Agent/1.0" };
    const selfToken = await selfTokenHeader(url);
    if (selfToken) Object.assign(headers, selfToken);
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const fetchInit = {
      method,
      redirect: "manual",
      cache: "no-store",
      headers,
      signal: controller.signal,
      ...(payload !== undefined ? { body: payload } : {}),
    };
    const bounded = method === "HEAD" ? { text: "", truncated: false } : await readBoundedBody(response);
    return NextResponse.json({
      ok: true,
      method,
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body: bounded.text,
      truncated: bounded.truncated,
    });
  } catch (error) {
    const status = error instanceof CurlInputError || error instanceof SsrfGuardError ? 400 : 502;
    const message = error?.name === "AbortError" ? "Request timed out" : (error instanceof Error ? error.message : "Curl tool failed");
    return NextResponse.json({ ok: false, error: message }, { status });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
