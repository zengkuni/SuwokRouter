import { NextResponse } from "next/server";
import { getSettings, getActiveProviderRows } from "@/lib/localDb.js";
import { proxyAwareFetch } from "@/utils/proxyFetch.js";
import { bodyBytesExceeded, isImageType, normalizeOutput, parseAllowlist, redactError, validateOutput } from "../imageValidation.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const IMAGE_PROVIDER_ERROR = "Image provider request failed";
const IMAGE_EDIT_ERROR = "Image editing failed";

export async function POST(request) {
  try {
    if (bodyBytesExceeded(request, MAX_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    if (!String(request.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data")) return NextResponse.json({ error: "multipart/form-data is required" }, { status: 400 });
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File) || !image.size) return NextResponse.json({ error: "image file is required" }, { status: 400 });
    if (image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "image exceeds 8 MB limit" }, { status: 413 });
    if (!isImageType(image.type)) return NextResponse.json({ error: "image must be PNG, JPEG, WebP, or GIF" }, { status: 400 });
    const mask = form.get("mask");
    if (mask !== null && (!(mask instanceof File) || !mask.size || mask.size > MAX_IMAGE_BYTES || !isImageType(mask.type))) return NextResponse.json({ error: "mask must be a valid image up to 8 MB" }, { status: 400 });
    const n = form.get("n");
    const nValue = n === null || n === "" ? 1 : Number(n);
    if (!Number.isInteger(nValue) || nValue < 1 || nValue > 4) return NextResponse.json({ error: "n must be between 1 and 4" }, { status: 400 });
    const size = form.get("size");
    if (size !== null && !["256x256", "512x512", "1024x1024"].includes(size)) return NextResponse.json({ error: "unsupported image size" }, { status: 400 });
    const responseFormat = form.get("response_format");
    if (responseFormat !== null && !["url", "b64_json"].includes(responseFormat)) return NextResponse.json({ error: "unsupported response_format" }, { status: 400 });

    const prompt = form.get("prompt");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 8000) return NextResponse.json({ error: "prompt is required and must be at most 8000 characters" }, { status: 400 });
    const settings = await getSettings();
    const enabled = parseAllowlist(settings?.mediaProviders ?? process.env.SWAY_MEDIA_PROVIDERS);
    if (!enabled.size) return NextResponse.json({ error: "Image generation is disabled" }, { status: 404 });
    const provider = String(form.get("provider") || [...enabled][0]).toLowerCase();
    if (!enabled.has(provider)) return NextResponse.json({ error: "Media provider is not enabled" }, { status: 404 });
    const connection = (await getActiveProviderRows()).find((row) => String(row.provider || "").toLowerCase() === provider);
    if (!connection) return NextResponse.json({ error: "No active media provider connection" }, { status: 404 });
    const baseUrl = connection.providerSpecificData?.baseUrl || connection.baseUrl || "";
    if (!baseUrl) return NextResponse.json({ error: "Media provider has no base URL" }, { status: 502 });
    const upstream = new FormData();
    upstream.append("image", image, image.name || "image");
    if (mask instanceof File) upstream.append("mask", mask, mask.name || "mask");
    upstream.append("prompt", prompt);
    for (const key of ["model", "size", "response_format"]) {
      const value = form.get(key);
      if (typeof value === "string" && value) upstream.append(key, value);
    }
    upstream.append("n", String(nValue));
    const token = connection.accessToken || connection.apiKey;
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const response = await proxyAwareFetch(`${String(baseUrl).replace(/\/$/, "")}/images/edits`, { method: "POST", headers, body: upstream, signal: request.signal });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = null; }
    if (!response.ok) {
      console.error("[images/edits][upstream]", {
        status: response.status,
        response: text.slice(0, 500),
      });
      return NextResponse.json({ error: IMAGE_PROVIDER_ERROR }, { status: 502 });
    }
    const data = Array.isArray(payload?.data) ? payload.data.map(normalizeOutput).filter(Boolean) : [];
    if (!validateOutput(data)) return NextResponse.json({ error: "Provider returned no valid image output" }, { status: 502 });
    return NextResponse.json({ created: payload.created || Math.floor(Date.now() / 1000), data });
  } catch (error) {
    console.error("[images/edits]", redactError(error));
    return NextResponse.json({ error: IMAGE_EDIT_ERROR }, { status: 502 });
  }
}
