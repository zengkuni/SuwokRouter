import crypto from "node:crypto";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";

export const OPENCODE_VERSION = "1.18.31";
export const OPENCODE_USER_AGENT = `opencode/${OPENCODE_VERSION}`;

const OPENCODE_ID_PATTERN = /^(ses|msg)_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const TOOL_NAMES = ["bash", "glob", "grep", "read"];
const TOOL_NAME_SET = new Set(TOOL_NAMES);
const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_SESSION_CACHE_SIZE = 5000;
const sessionCache = new Map();
let idCounter = 0;
let lastTimestamp = 0;

function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  const value = key ? headers[key] : "";
  return typeof value === "string" ? value.trim() : "";
}

function createOpenCodeId(prefix) {
  const now = Date.now();
  if (now === lastTimestamp) idCounter += 1;
  else {
    lastTimestamp = now;
    idCounter = 1;
  }

  const current = BigInt(now) * 0x1000n + BigInt(idCounter);
  const value = (~current) & ((1n << 48n) - 1n);
  const timestamp = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - index * 8)) & 0xffn).toString(16).padStart(2, "0"),
  ).join("");
  const random = crypto.randomBytes(14).toString("base64url").replace(/[-_]/g, "").slice(0, 14);
  return `${prefix}${timestamp}${random.padEnd(14, "0")}`;
}

function trimSessionCache() {
  const now = Date.now();
  for (const [key, entry] of sessionCache) {
    if (now - entry.at > SESSION_CACHE_TTL_MS) sessionCache.delete(key);
  }
  while (sessionCache.size > MAX_SESSION_CACHE_SIZE) {
    sessionCache.delete(sessionCache.keys().next().value);
  }
}

export function isOpenCodeId(value, prefix = null) {
  if (typeof value !== "string" || !OPENCODE_ID_PATTERN.test(value)) return false;
  return !prefix || value.startsWith(`${prefix}_`);
}

export function resolveOpenCodeSession(credentials = {}) {
  const rawHeaders = credentials.rawHeaders || {};
  const supplied = readHeader(rawHeaders, "x-opencode-session");
  if (isOpenCodeId(supplied, "ses")) return supplied;

  trimSessionCache();
  const source = supplied || credentials._clientSessionId || "default";
  const key = `${credentials.connectionId || credentials.id || "public"}:${source}`;
  const existing = sessionCache.get(key);
  if (existing) {
    existing.at = Date.now();
    return existing.value;
  }

  const value = createOpenCodeId("ses_");
  sessionCache.set(key, { value, at: Date.now() });
  return value;
}

export function buildOpenCodeHeaders(credentials = {}, stream = true, { authorization = "public", format = "openai" } = {}) {
  const rawHeaders = credentials.rawHeaders || {};
  const providerSpecificData = credentials.providerSpecificData || {};
  const token = credentials.apiKey || credentials.accessToken || authorization;
  const project = readHeader(rawHeaders, "x-opencode-project") || providerSpecificData.projectId;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token || "public"}`,
    "User-Agent": OPENCODE_USER_AGENT,
    "x-opencode-client": "desktop",
    "x-opencode-session": resolveOpenCodeSession(credentials),
    "x-opencode-request": createOpenCodeId("msg_"),
  };

  if (format === "claude") headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  if (project) headers["x-opencode-project"] = String(project);
  if (stream) headers.Accept = "text/event-stream";
  return headers;
}

function toolName(tool) {
  return typeof tool?.function?.name === "string"
    ? tool.function.name
    : typeof tool?.name === "string"
      ? tool.name
      : "";
}

function normalizedToolName(name) {
  const normalized = typeof name === "string" ? name.trim().toLowerCase() : "";
  return TOOL_NAME_SET.has(normalized) ? normalized : "";
}

function renameTool(tool, name, format) {
  if (format === "claude") return { ...tool, name };
  if (format === "responses") return { ...tool, name };
  return {
    ...tool,
    function: { ...(tool.function || {}), name },
  };
}

function decoyTool(name, format) {
  const description = "OpenCode compatibility tool";
  const parameters = { type: "object", properties: {} };
  if (format === "claude") return { name, description, input_schema: parameters };
  if (format === "responses") return { type: "function", name, description, parameters };
  return { type: "function", function: { name, description, parameters } };
}

function toolChoiceName(choice, format) {
  if (format === "claude") return choice?.name || "";
  if (format === "responses") return choice?.name || "";
  return choice?.function?.name || (typeof choice === "string" ? choice : "");
}

function renameToolChoice(choice, name, format) {
  if (typeof choice === "string") return name;
  if (!choice || typeof choice !== "object") return choice;
  if (format === "claude" || format === "responses") return { ...choice, name };
  return { ...choice, function: { ...(choice.function || {}), name } };
}

function normalizeTools(tools, format) {
  const normalized = [];
  const seen = new Set();
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || typeof tool !== "object") continue;
    const compatibilityName = normalizedToolName(toolName(tool));
    const next = compatibilityName ? renameTool(tool, compatibilityName, format) : tool;
    const identity = toolName(next) || JSON.stringify(next);
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push(next);
  }

  for (const name of TOOL_NAMES) {
    if (!normalized.some((tool) => toolName(tool) === name)) normalized.push(decoyTool(name, format));
  }

  return normalized.sort((left, right) => toolName(left).localeCompare(toolName(right)));
}

function stripEncryptedReasoning(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(stripEncryptedReasoning);
    return;
  }
  delete value.encrypted_content;
  delete value.reasoning_encrypted_content;
  Object.values(value).forEach(stripEncryptedReasoning);
}

export function applyOpenCodeFingerprint(body, format = "openai", { forceStream = false } = {}) {
  const next = body && typeof body === "object" ? body : {};
  const hadCallerTools = Array.isArray(next.tools) && next.tools.length > 0;
  const tools = normalizeTools(next.tools, format);
  next.tools = tools;

  if (format === "responses") {
    if (forceStream) next.stream = true;
    next.store = false;
    stripEncryptedReasoning(next.input);
    if (!next.tool_choice) next.tool_choice = "auto";
  } else if (format === "claude") {
    if (forceStream) next.stream = true;
    if (!next.tool_choice) next.tool_choice = { type: "auto" };
  } else {
    if (forceStream) next.stream = true;
    if (!hadCallerTools && !next.tool_choice) next.tool_choice = "none";
  }

  const currentChoiceName = toolChoiceName(next.tool_choice, format);
  const normalizedChoiceName = normalizedToolName(currentChoiceName);
  if (normalizedChoiceName && currentChoiceName !== normalizedChoiceName) {
    next.tool_choice = renameToolChoice(next.tool_choice, normalizedChoiceName, format);
  }
  return next;
}

export const OPENCODE_FREE_MODELS = [
  { id: "mimo-v2.5-free", name: "MiMo V2.5 Free" },
  { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free" },
  { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free" },
  { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
  { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses" },
  { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
  { id: "big-pickle", name: "Big Pickle" },
];

export const OPENCODE_GO_MODELS = [
  { id: "grok-4.5", name: "Grok 4.5", targetFormat: "openai-responses" },
  { id: "glm-5.3", name: "GLM 5.3" },
  { id: "glm-5.2", name: "GLM 5.2" },
  { id: "glm-5.1", name: "GLM 5.1" },
  { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
  { id: "kimi-k3", name: "Kimi K3" },
  { id: "kimi-k2.7", name: "Kimi K2.7" },
  { id: "kimi-k2.6", name: "Kimi K2.6" },
  { id: "mimo-v2.5", name: "MiMo V2.5" },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
  { id: "minimax-m3", name: "MiniMax M3", targetFormat: "claude" },
  { id: "minimax-m2.7", name: "MiniMax M2.7", targetFormat: "claude" },
  { id: "qwen3.8", name: "Qwen 3.8" },
  { id: "qwen3.7", name: "Qwen 3.7" },
  { id: "qwen3.6", name: "Qwen 3.6" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "hy3", name: "Hy3" },
];
