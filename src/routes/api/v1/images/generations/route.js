import { NextResponse } from "next/server";
import { getSettings, getActiveProviderRows } from "@/lib/localDb.js";
import { proxyAwareFetch } from "@/utils/proxyFetch.js";
import { bodyBytesExceeded, normalizeOutput, parseAllowlist, redactError, validateGenerationBody, validateOutput } from "../imageValidation.js";

const MAX_BODY_BYTES = 256 * 1024;
const IMAGE_GENERATION_ERROR = "Image generation failed";

async function callMediaProvider(provider, body, request) {
  const rows = await getActiveProviderRows();
  const connection = rows.find((row) => String(row.provider || "").toLowerCase() === provider);
  if (!connection) throw new Error("No active media provider connection");
  const baseUrl = connection.providerSpecificData?.baseUrl || connection.baseUrl || "";
  if (!baseUrl) throw new Error("Media provider has no base URL");
  const url = `${String(baseUrl).replace(/\/$/, "")}/images/generations`;
  const headers = { "content-type": "application/json", accept: "application/json" };
  const token = connection.accessToken || connection.apiKey;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: request.signal });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(`Media provider returned HTTP ${response.status}`);
  }
  return payload;
}

export async function POST(request) {
  try {
    if (bodyBytesExceeded(request, MAX_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    const body = await request.json();
    const validation = validateGenerationBody(body);
    if (validation.error) return NextResponse.json({ error: validation.error }, { status: 400 });
    const normalizedBody = validation.value; const n = normalizedBody.n; const providers = parseAllowlist((await getSettings()).mediaProviders ?? process.env.SWAY_MEDIA_PROVIDERS);
    if (!providers.size) return NextResponse.json({ error: "Image generation is disabled" }, { status: 404 });
    const provider = String(normalizedBody.provider || [...providers][0]).toLowerCase();
    if (!providers.has(provider)) return NextResponse.json({ error: "Media provider is not enabled" }, { status: 404 });
    const safeBody = { ...normalizedBody }; delete safeBody.provider; delete safeBody.n;
    safeBody.n = n;
    const result = await callMediaProvider(provider, safeBody, request);
    const data = Array.isArray(result?.data) ? result.data.map(normalizeOutput).filter(Boolean) : [];
    if (!validateOutput(data)) return NextResponse.json({ error: "Provider returned no valid image output" }, { status: 502 });
    return NextResponse.json({ created: result.created || Math.floor(Date.now() / 1000), data });

  } catch (error) {
    console.error("[images/generations]", redactError(error));
    return NextResponse.json({ error: IMAGE_GENERATION_ERROR }, { status: 502 });
  }
}
