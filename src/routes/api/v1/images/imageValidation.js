export const MAX_PROMPT_LENGTH = 8000;
export const MAX_IMAGES = 4;
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export function parseAllowlist(raw) {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return new Set(values.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
}

export function validateGenerationBody(body) {
  if (!body || typeof body !== "object" || typeof body.prompt !== "string" || !body.prompt.trim()) return { error: "prompt is required" };
  if (body.prompt.length > MAX_PROMPT_LENGTH) return { error: "prompt is too long" };
  const n = body.n === undefined ? 1 : Number(body.n);
  if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGES) return { error: "n must be between 1 and 4" };
  if (body.size !== undefined && !["256x256", "512x512", "1024x1024"].includes(body.size)) return { error: "unsupported image size" };
  if (body.response_format !== undefined && !["url", "b64_json"].includes(body.response_format)) return { error: "unsupported response_format" };
  return { value: { ...body, n } };
}

export function normalizeOutput(item) {
  if (!item || typeof item !== "object") return null;
  if (typeof item.b64_json === "string" && item.b64_json.length > 0) return { b64_json: item.b64_json };
  if (typeof item.url === "string" && /^https?:\/\//i.test(item.url)) return { url: item.url };
  return null;
}

export function validateOutput(data) {
  return Array.isArray(data) && data.length > 0 && data.length <= MAX_IMAGES && JSON.stringify(data).length <= MAX_OUTPUT_BYTES;
}

export function bodyBytesExceeded(request, maxBytes) {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const value = Number(raw);
  return !Number.isSafeInteger(value) || value > maxBytes;
}

export function isImageType(type) {
  return /^image\/(png|jpeg|webp|gif)$/i.test(String(type || ""));
}

export function redactError(error) {
  return String(error?.message || error || "media operation failed")
    .replace(/(authorization|token|api[_-]?key|password)\s*[:=]\s*[^\s,;&]+/gi, "$1=[redacted]");
}
