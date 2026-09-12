import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  isSocksProxyUrl,
  normalizeProxyUrl,
  safeProxyError,
} from "./proxyUrl.js";

function isSocksProxy(proxyUrl, proxyType) {
  return isSocksProxyUrl(proxyUrl, proxyType);
}

function createProxyDispatcher(proxyUrl, proxyType) {
  return isSocksProxy(proxyUrl, proxyType)
    ? new SocksProxyAgent(proxyUrl)
    : new ProxyAgent({ uri: proxyUrl });
}

async function fetchThroughSocks(url, options, proxyUrl) {
  const agent = new SocksProxyAgent(proxyUrl);
  const target = new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  const requestOptions = {
    method: options.method || "GET",
    headers: options.headers,
    agent,
  };
  return new Promise((resolve, reject) => {
    const request = transport.request(target, requestOptions, (response) => {
      response.resume();
      response.once("end", () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 400,
        status: response.statusCode || 0,
        statusText: response.statusMessage || "",
        url,
      }));
    });
    request.once("error", reject);
    if (options.signal) {
      const abort = () => request.destroy(new Error("Proxy test aborted"));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }
    request.end();
  });
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const DEFAULT_TEST_URL = "https://www.google.com/generate_204";
const DEFAULT_TIMEOUT_MS = 8000;

function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

export async function testProxyUrl({ proxyUrl, proxyType, testUrl, timeoutMs } = {}) {
  const rawProxyUrl = normalizeString(proxyUrl);
  if (!rawProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  let normalizedProxyUrl;
  try {
    normalizedProxyUrl = normalizeProxyUrl(rawProxyUrl, proxyType);
  } catch (err) {
    return {
      ok: false,
      status: 400,
      error: `Invalid proxy URL: ${safeProxyError(err)}`,
    };
  }

  const normalizedTestUrl = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    try {
      dispatcher = createProxyDispatcher(normalizedProxyUrl, proxyType);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${safeProxyError(err)}`,
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const requestOptions = {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "SwayRouter",
        },
      };
      const res = isSocksProxy(normalizedProxyUrl, proxyType)
        ? await fetchThroughSocks(normalizedTestUrl, requestOptions, normalizedProxyUrl)
        : await undiciFetch(normalizedTestUrl, { ...requestOptions, dispatcher });

      try {
        await res.body?.cancel?.();
      } catch {

      }

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Proxy test timed out"
          : safeProxyError(getErrorMessage(err));
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {

    }
  }
}
