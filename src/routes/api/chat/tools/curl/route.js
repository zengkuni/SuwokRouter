import dns from "node:dns/promises";
import net from "node:net";
import { NextResponse } from "@/next/server";
import { fetchWithSsrfGuard, isUnsafeIp, SsrfGuardError } from "@/shared/utils/ssrfGuard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URL_LENGTH = 2_000;
const MAX_BODY_LENGTH = 1_000_000;
const CURL_TIMEOUT_MS = 8_000;

class CurlInputError extends Error {}

function isPrivateAddress(address) {
  return net.isIP(address) > 0 && isUnsafeIp(address);
}

async function assertPublicUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new CurlInputError("URL is required");
  const raw = value.trim();
  if (raw.length > MAX_URL_LENGTH) throw new CurlInputError(`URL must be ${MAX_URL_LENGTH} characters or fewer`);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new CurlInputError("URL must be valid"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new CurlInputError("Only http:// and https:// URLs are allowed");
  if (parsed.username || parsed.password) throw new CurlInputError("URLs with embedded credentials are not allowed");
  if (isPrivateAddress(parsed.hostname)) throw new CurlInputError("Private and loopback targets are not allowed");
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
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
    const method = String(body?.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw new CurlInputError("Only GET and HEAD requests are allowed");
    const url = await assertPublicUrl(body?.url);
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), CURL_TIMEOUT_MS);
    const response = await fetchWithSsrfGuard(url.toString(), {
      method,
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "application/json, text/plain, text/html, */*", "User-Agent": "SwayRouter Agent/1.0" },
      signal: controller.signal,
    }, { maxRedirects: 0 });
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
