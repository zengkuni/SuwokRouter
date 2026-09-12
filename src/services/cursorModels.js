import crypto from "crypto";
import http2 from "http2";
import { PROVIDER_OAUTH } from "../providers/index.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { decodeMessage } from "../utils/cursorProtobuf.js";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;

const MODEL_ID_FIELD = 1;
const DISPLAY_MODEL_ID_FIELD = 3;
const DISPLAY_NAME_FIELD = 4;
const DISPLAY_NAME_SHORT_FIELD = 5;
const RESPONSE_MODELS_FIELD = 1;

const catalogCache = new Map();
const failureCache = new Map();

function getCursorModelsUrl() {
  const config = PROVIDER_OAUTH.cursor;
  if (!config?.agentEndpoint || !config?.modelsEndpoint) return null;
  return `${config.agentEndpoint.replace(/\/$/, "")}${config.modelsEndpoint}`;
}

function cacheKey(credentials) {
  const seed = [
    credentials?.providerSpecificData?.machineId,
    credentials?.accessToken,
  ].filter(Boolean).join(":");
  if (!seed) return "cursor-anonymous";
  return crypto.createHash("sha256").update(`cursor:${seed}`).digest("hex");
}

function firstString(fields, fieldNumber) {
  const value = fields.get(fieldNumber)?.[0]?.value;
  if (!value || typeof value === "number") return "";
  return Buffer.from(value).toString("utf8");
}

export function parseCursorUsableModels(payload) {
  const response = decodeMessage(payload);
  const seen = new Set();
  const models = [];

  for (const entry of response.get(RESPONSE_MODELS_FIELD) || []) {
    if (!entry?.value || typeof entry.value === "number") continue;
    const detail = decodeMessage(entry.value);
    const id = firstString(detail, MODEL_ID_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (
      firstString(detail, DISPLAY_NAME_FIELD)
      || firstString(detail, DISPLAY_NAME_SHORT_FIELD)
      || firstString(detail, DISPLAY_MODEL_ID_FIELD)
      || id
    ).trim();
    models.push({ id, name });
  }

  return models;
}

function http2PostProto(url, headers, body, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`);
    const chunks = [];
    let responseHeaders = {};
    let settled = false;

    const finish = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { client.close(); } catch {}
      fn(...args);
    };

    const timeoutId = setTimeout(finish(() => {
      reject(new Error("Cursor GetUsableModels timed out"));
    }), timeoutMs);

    client.on("error", finish(reject));

    const req = client.request({
      ":method": "POST",
      ":path": urlObj.pathname,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("response", (hdrs) => { responseHeaders = hdrs; });
    req.on("data", (chunk) => { chunks.push(chunk); });
    req.on("end", finish(() => {
      resolve({
        status: Number(responseHeaders[":status"] || 0),
        body: Buffer.concat(chunks),
      });
    }));
    req.on("error", finish(reject));

    if (signal) {
      const onAbort = finish(() => reject(new Error("Request aborted")));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    req.end(body && body.length ? Buffer.from(body) : undefined);
  });
}

async function fetchCursorCatalog(credentials, signal) {
  const accessToken = credentials?.accessToken;
  const machineId = credentials?.providerSpecificData?.machineId;
  const url = getCursorModelsUrl();
  if (!accessToken || !machineId || !url) return null;

  const headers = {
    ...buildCursorHeaders(accessToken, machineId, credentials?.providerSpecificData?.ghostMode !== false),

    accept: "application/proto",
    "content-type": "application/proto",
  };
  delete headers["connect-accept-encoding"];
  delete headers["connect-protocol-version"];

  const response = await http2PostProto(url, headers, new Uint8Array(), signal, FETCH_TIMEOUT_MS);
  if (response.status !== 200) {
    const error = new Error(`Cursor GetUsableModels returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return parseCursorUsableModels(new Uint8Array(response.body));
}

export async function resolveCursorModels(credentials, options = {}) {
  if (!credentials?.accessToken || !credentials?.providerSpecificData?.machineId) {
    options.log?.debug?.("CURSOR_MODELS", "No Cursor access token or machine ID; skipping live fetch");
    return null;
  }

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached?.expiresAt > now) return { models: cached.models };

    const failure = failureCache.get(key);
    if (failure?.expiresAt > now) {
      return {
        models: null,
        credentialStatus: failure.status === 401 ? "stale" : "unavailable",
        warning: failure.warning,
      };
    }
    if (failure) failureCache.delete(key);
  }

  try {
    const models = await fetchCursorCatalog(credentials, options.signal);
    if (!models?.length) return null;
    catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
    failureCache.delete(key);
    return { models };
  } catch (error) {
    const status = Number(error?.status || 0);
    const isCredentialFailure = status === 401;
    const warning = isCredentialFailure
      ? "Cursor credentials were rejected (401); re-authenticate Cursor. Using the static model catalog until the cooldown expires."
      : `Cursor live model fetch failed; using the static model catalog until the next refresh.`;

    if (isCredentialFailure) {
      failureCache.set(key, {
        expiresAt: Date.now() + FAILURE_BACKOFF_MS,
        status,
        warning,
      });
      try {
        await options.onAuthFailure?.({ status, error, retryAt: new Date(Date.now() + FAILURE_BACKOFF_MS).toISOString() });
      } catch (persistError) {
        options.log?.debug?.("CURSOR_MODELS", `Failed to persist Cursor stale status: ${persistError?.message || persistError}`);
      }
    }

    options.log?.warn?.("CURSOR_MODELS", `${error?.message || error}${isCredentialFailure ? "; re-authenticate Cursor credentials" : ""}`);
    return { models: null, credentialStatus: isCredentialFailure ? "stale" : "unavailable", warning };
  }
}

export function clearCursorModelCache() {
  catalogCache.clear();
  failureCache.clear();
}
