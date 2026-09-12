const isNode = typeof process !== "undefined" && process.versions?.node && typeof window === "undefined";

import { env } from "@/lib/env";

const LOGGING_ENABLED = isNode && env.requestLogsEnabled;

let fs = null;
let path = null;
let LOGS_DIR = null;

async function ensureNodeModules() {
  if (!isNode || !LOGGING_ENABLED || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
    LOGS_DIR = path.join(env.dataDir || (typeof process !== "undefined" && process.cwd ? process.cwd() : "."), "logs");
  } catch {

  }
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

async function createLogSession(sourceFormat, targetFormat, model) {
  await ensureNodeModules();
  if (!fs || !LOGS_DIR) return null;

  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const timestamp = formatTimestamp();
    const safeModel = (model || "unknown").replace(/[/:]/g, "-");
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}`;
    const sessionPath = path.join(LOGS_DIR, folderName);

    fs.mkdirSync(sessionPath, { recursive: true });

    return sessionPath;
  } catch (err) {
    console.log("[LOG] Failed to create log session:", err.message);
    return null;
  }
}

function writeJsonFile(sessionPath, filename, data) {
  if (!fs || !sessionPath) return;

  try {
    const filePath = path.join(sessionPath, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`[LOG] Failed to write ${filename}:`, err.message);
  }
}

const SENSITIVE_KEY_PATTERN = /(authorization|proxy-authorization|api[-_]?key|cookie|set-cookie|token|secret|password|credential|private[-_]?key|signature)/i;
const MAX_CAPTURE_BYTES = 64 * 1024;
const MAX_STREAM_LOG_BYTES = 1024 * 1024;
const MAX_PENDING_STREAM_LOG_BYTES = 256 * 1024;

function redactString(value) {
  const text = String(value);
  if (text.length > MAX_CAPTURE_BYTES) return `[redacted:truncated ${text.length} bytes]`;
  return text;
}

function redactValue(value, key = "", seen = new WeakSet()) {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED:circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key, seen));
  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redactValue(childValue, childKey, seen);
  }
  return output;
}

function maskSensitiveHeaders(headers) {
  if (!headers) return {};
  const plain = typeof headers.entries === "function" ? Object.fromEntries(headers.entries()) : headers;
  return redactValue(plain);
}

function redactBody(body) {
  return redactValue(body);
}

function createNoOpLogger() {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {}
  };
}

export async function createRequestLogger(sourceFormat, targetFormat, model) {

  if (!LOGGING_ENABLED) {
    return createNoOpLogger();
  }

  const sessionPath = await createLogSession(sourceFormat, targetFormat, model);
  const pendingChunks = new Map();
  const streamBytes = new Map();
  let pendingBytes = 0;
  let flushTimer = null;
  let flushChain = Promise.resolve();

  const flushPendingChunks = () => {
    flushTimer = null;
    if (!fs || !sessionPath || pendingChunks.size === 0) return;
    const batch = [...pendingChunks.entries()];
    pendingChunks.clear();
    pendingBytes = 0;
    flushChain = flushChain.then(async () => {
      for (const [filename, chunk] of batch) {
        try {
          await fs.promises.appendFile(path.join(sessionPath, filename), chunk);
        } catch {
          // Request logging must never affect the proxy response.
        }
      }
    }).catch(() => {});
  };

  const queueStreamChunk = (filename, chunk) => {
    if (!fs || !sessionPath || chunk == null) return;
    const text = String(chunk);
    const currentBytes = streamBytes.get(filename) || 0;
    const remaining = MAX_STREAM_LOG_BYTES - currentBytes;
    if (!text || remaining <= 0 || pendingBytes >= MAX_PENDING_STREAM_LOG_BYTES) return;
    const bounded = text.slice(0, remaining);
    const byteLength = Buffer.byteLength(bounded, "utf8");
    if (!byteLength || pendingBytes + byteLength > MAX_PENDING_STREAM_LOG_BYTES) return;
    streamBytes.set(filename, currentBytes + byteLength);
    pendingChunks.set(filename, `${pendingChunks.get(filename) || ""}${bounded}`);
    pendingBytes += byteLength;
    if (!flushTimer) {
      flushTimer = setTimeout(flushPendingChunks, 50);
      flushTimer?.unref?.();
    }
  };

  return {
    get sessionPath() { return sessionPath; },

    logClientRawRequest(endpoint, body, headers = {}) {
      writeJsonFile(sessionPath, "1_req_client.json", {
        timestamp: new Date().toISOString(),
        endpoint,
        headers: maskSensitiveHeaders(headers),
        body: redactBody(body)
      });
    },

    logRawRequest(body, headers = {}) {
      writeJsonFile(sessionPath, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        headers: maskSensitiveHeaders(headers),
        body: redactBody(body)
      });
    },

    logOpenAIRequest(body) {
      writeJsonFile(sessionPath, "3_req_openai.json", {
        timestamp: new Date().toISOString(),
        body: redactBody(body)
      });
    },

    logTargetRequest(url, headers, body) {
      writeJsonFile(sessionPath, "4_req_target.json", {
        timestamp: new Date().toISOString(),
        url,
        headers: maskSensitiveHeaders(headers),
        body: redactBody(body)
      });
    },

    logProviderResponse(status, statusText, headers, body) {
      const filename = "5_res_provider.json";
      writeJsonFile(sessionPath, filename, {
        timestamp: new Date().toISOString(),
        status,
        statusText,
        headers: maskSensitiveHeaders(headers),
        body: redactBody(body)
      });
    },

    appendProviderChunk(chunk) {
      queueStreamChunk("5_res_provider.txt", chunk);
    },

    appendOpenAIChunk(chunk) {
      queueStreamChunk("6_res_openai.txt", chunk);
    },

    logConvertedResponse(body) {
      writeJsonFile(sessionPath, "7_res_client.json", {
        timestamp: new Date().toISOString(),
        body: redactBody(body)
      });
    },

    appendConvertedChunk(chunk) {
      queueStreamChunk("7_res_client.txt", chunk);
    },

    logError(error, requestBody = null) {
      writeJsonFile(sessionPath, "6_error.json", {
        timestamp: new Date().toISOString(),
        error: error?.message || String(error),
        stack: error?.stack,
        requestBody: redactBody(requestBody)
      });
    }
  };
}

export function logRequest() {}
export function logResponse() {}
export function logError(provider, { error, url, model, requestBody }) {
  if (!fs || !LOGS_DIR) return;

  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const date = new Date().toISOString().split("T")[0];
    const logPath = path.join(LOGS_DIR, `${provider}-${date}.log`);

    const logEntry = {
      timestamp: new Date().toISOString(),
      type: "error",
      provider,
      model,
      url,
      error: error?.message || String(error),
      stack: error?.stack,
      requestBody
    };

    fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
  } catch (err) {
    console.log("[LOG] Failed to write error log:", err.message);
  }
}
