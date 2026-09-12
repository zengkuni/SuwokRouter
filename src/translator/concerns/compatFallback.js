const CACHE_MAX_KEYS = 512;
const CACHE_TTL_MS = 30 * 60 * 1000;

if (!global._swayCompatFallback) {
  global._swayCompatFallback = {

    rejected: new Map(),
  };
}
const REJECTED = global._swayCompatFallback.rejected;

function cacheKey(provider, model) {
  return `${provider || "?"}:${model || "?"}`;
}

export function rememberRejectedParam(provider, model, fieldPath) {
  if (!fieldPath) return;
  const key = cacheKey(provider, model);
  let entry = REJECTED.get(key);
  const now = Date.now();
  if (!entry || entry.expireAt <= now) {

    if (REJECTED.size >= CACHE_MAX_KEYS) {
      const eldest = REJECTED.keys().next().value;
      if (eldest !== undefined) REJECTED.delete(eldest);
    }
    entry = { paths: new Set(), expireAt: now + CACHE_TTL_MS };
    REJECTED.set(key, entry);
  }
  entry.paths.add(fieldPath);

  entry.expireAt = now + CACHE_TTL_MS;
}

export function stripKnownRejected(payload, provider, model) {
  if (!payload || typeof payload !== "object") return [];
  const key = cacheKey(provider, model);
  const entry = REJECTED.get(key);
  if (!entry) return [];
  const now = Date.now();
  if (entry.expireAt <= now) {
    REJECTED.delete(key);
    return [];
  }
  const stripped = [];
  for (const path of entry.paths) {
    if (removeCompatibilityProjection(payload, path)) stripped.push(path);
  }
  return stripped;
}

export function isOptionalProjectionPath(value) {
  const path = normalizeFieldPath(value);
  if (!path) return false;
  if (path === "prompt_cache_options" || path === "prompt_cache_breakpoint") return true;
  if (path.startsWith("prompt_cache_options.")) return true;
  if (path === "reasoning" || path === "reasoning_effort" || path === "thinking") return true;
  if (/^reasoning\.(?:effort|max_tokens|summary|exclude|enabled|mode)$/.test(path)) return true;
  if (path === "output_config" || path === "output_config.effort") return true;
  return (
    path === "response_format" ||
    path === "parallel_tool_calls" ||
    path === "tool_choice" ||
    path === "stream_options"
  );
}

export function removeCompatibilityProjection(payload, fieldPath) {
  const path = normalizeFieldPath(fieldPath);
  if (!path || !isOptionalProjectionPath(path)) return false;
  if (path === "prompt_cache_options") {
    const had = _deleteTop(payload, "prompt_cache_options");
    const nested =
      _removeNested(payload.input, "prompt_cache_breakpoint") ||
      _removeNested(payload.messages, "prompt_cache_breakpoint");
    return had || nested;
  }
  if (path.startsWith("prompt_cache_options.")) {
    return _removeNested(payload.prompt_cache_options, path.slice("prompt_cache_options.".length));
  }
  if (path === "prompt_cache_breakpoint") {
    return (
      _removeNested(payload.input, "prompt_cache_breakpoint") ||
      _removeNested(payload.messages, "prompt_cache_breakpoint")
    );
  }
  if (path === "reasoning") return _deleteTop(payload, "reasoning");
  if (path.startsWith("reasoning.")) return _removeNested(payload.reasoning, path.slice("reasoning.".length));
  if (path === "reasoning_effort" || path === "thinking") return _deleteTop(payload, path);
  if (path === "output_config") return _deleteTop(payload, "output_config");
  if (path.startsWith("output_config.")) return _removeNested(payload.output_config, path.slice("output_config.".length));
  if (path === "response_format" || path === "parallel_tool_calls" || path === "tool_choice" || path === "stream_options") {
    return _deleteTop(payload, path);
  }
  return false;
}

export function applyRejectedParam(payload, provider, model, fieldPath) {
  const retryable = isOptionalProjectionPath(fieldPath);
  if (!retryable) return { removed: false, retryable: false };
  rememberRejectedParam(provider, model, normalizeFieldPath(fieldPath));
  const removed = removeCompatibilityProjection(payload, fieldPath);
  return { removed, retryable: true };
}

function normalizeFieldPath(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^["'`]|["'`]$/g, "");
}

function _isRecord(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function _deleteTop(payload, field) {
  if (_isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, field)) {
    delete payload[field];
    return true;
  }
  return false;
}

function _removeNested(value, field) {
  let removed = false;
  if (Array.isArray(value)) {
    for (const item of value) removed = _removeNested(item, field) || removed;
    return removed;
  }
  if (!_isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, field)) {
    delete value[field];
    removed = true;
  }
  for (const child of Object.values(value)) removed = _removeNested(child, field) || removed;
  return removed;
}

export function __resetCompatFallbackForTests() {
  REJECTED.clear();
}

export function _peekRejected(provider, model) {
  const key = cacheKey(provider, model);
  const entry = REJECTED.get(key);
  if (!entry) return undefined;
  if (entry.expireAt <= Date.now()) return undefined;
  return new Set(entry.paths);
}
