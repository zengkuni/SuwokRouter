import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { SocksProxyAgent } from "socks-proxy-agent";
import { request as undiciRequest } from "undici/index.js";
import { normalizeProxyUrl as normalizeProxyUrlShared } from "../lib/network/proxyUrl.js";

const socksAgents = new Map();

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const patterns = noProxy
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith("."))
      return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function isEnvironmentProxyBypassed(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  if (isLoopbackHostname(parsed.hostname)) return true;
  return shouldBypassByNoProxy(
    targetUrl,
    process.env.NO_PROXY || process.env.no_proxy,
  );
}

function getEnvProxyUrl(targetUrl) {
  if (isEnvironmentProxyBypassed(targetUrl)) return null;

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return null;
  }

  if (parsed.protocol === "https:") {
    return (
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
    );
  }

  return (
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  );
}

function normalizeProxyUrl(proxyUrl, proxyType) {
  try {
    return normalizeProxyUrlShared(proxyUrl, proxyType);
  } catch {
    return null;
  }
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled =
    proxyOptions?.enabled === true ||
    proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(
    proxyOptions?.url ?? proxyOptions?.connectionProxyUrl,
  );
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(
    proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy,
  );
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw, proxyOptions?.type);
}

function isConnectionProxyBypassed(targetUrl, proxyOptions) {
  const enabled =
    proxyOptions?.enabled === true ||
    proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return false;

  const proxyUrlRaw = normalizeString(
    proxyOptions?.url ?? proxyOptions?.connectionProxyUrl,
  );
  if (!proxyUrlRaw) return false;

  const noProxy = normalizeString(
    proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy,
  );
  return Boolean(noProxy && shouldBypassByNoProxy(targetUrl, noProxy));
}

async function getSocksAgent(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!socksAgents.has(normalized)) {
    if (socksAgents.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      socksAgents.delete(socksAgents.keys().next().value);
    }
    socksAgents.set(normalized, new SocksProxyAgent(normalized));
  }

  return socksAgents.get(normalized);
}

function isSocksUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "socks5:" || protocol === "socks5h:";
  } catch {
    return false;
  }
}

function normalizeRequestHeaders(headers) {
  if (!headers) return undefined;
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}

async function directFetch(url, options = {}) {
  const response = await undiciRequest(url, {
    method: options.method || "GET",
    headers: normalizeRequestHeaders(options.headers),
    body: options.body ?? undefined,
    signal: options.signal,
  });
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(response.headers || {})) {
    if (Array.isArray(value))
      value.forEach((item) => responseHeaders.append(key, String(item)));
    else if (value !== undefined) responseHeaders.set(key, String(value));
  }
  return new Response(Readable.toWeb(response.body), {
    status: response.statusCode,
    headers: responseHeaders,
  });
}

async function fetchThroughSocks(url, options, proxyUrl) {
  const target = new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  const agent = await getSocksAgent(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: options.method || "GET",
        headers: options.headers,
        agent,
      },
      (response) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value))
            value.forEach((item) => headers.append(key, String(item)));
          else if (value !== undefined) headers.set(key, String(value));
        }
        resolve(
          new Response(Readable.toWeb(response), {
            status: response.statusCode || 0,
            statusText: response.statusMessage || "",
            headers,
          }),
        );
      },
    );
    request.once("error", reject);
    if (options.signal) {
      const abort = () => request.destroy(new Error("Proxy request aborted"));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function requestViaProxy(url, options, proxyUrl) {
  if (isSocksUrl(proxyUrl)) return fetchThroughSocks(url, options, proxyUrl);
  return Bun.fetch(url, { ...options, proxy: proxyUrl });
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();

  if (
    proxyOptions?.proxyPoolUnavailable === true &&
    proxyOptions?.strictProxy === true
  ) {
    throw new Error(
      `[ProxyFetch] Proxy pool unavailable: ${proxyOptions.proxyPoolError || "assigned pool cannot be used"}`,
    );
  }

  const relayUrl = normalizeString(
    proxyOptions?.relayUrl || proxyOptions?.vercelRelayUrl,
  );
  if (relayUrl) {
    const parsed = new URL(targetUrl);
    const noProxy = normalizeString(
      proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy,
    );
    if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) {
      return directFetch(url, options);
    }
    const relayHeaders = new Headers(options.headers || {});
    relayHeaders.set("x-relay-target", `${parsed.protocol}//${parsed.host}`);
    relayHeaders.set("x-relay-path", `${parsed.pathname}${parsed.search}`);
    const relayToken = normalizeString(proxyOptions?.relayToken);
    if (relayToken) relayHeaders.set("x-sway-relay-token", relayToken);
    return Bun.fetch(relayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyBypassed = isConnectionProxyBypassed(
    targetUrl,
    proxyOptions,
  );
  const connectionProxyUrl = connectionProxyBypassed
    ? null
    : resolveConnectionProxyUrl(targetUrl, proxyOptions);

  const environmentProxyBypassed = isEnvironmentProxyBypassed(targetUrl);
  const envProxyUrl =
    connectionProxyBypassed || connectionProxyUrl || environmentProxyBypassed
      ? null
      : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  if (
    connectionProxyBypassed ||
    (!connectionProxyUrl && environmentProxyBypassed)
  ) {
    return directFetch(url, options);
  }

  if (proxyUrl) {
    try {
      return await requestViaProxy(url, options, proxyUrl);
    } catch (proxyError) {
      if (proxyOptions?.strictProxy === true) {
        throw new Error(
          `[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`,
        );
      }
      console.warn(
        `[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`,
      );
      return directFetch(url, options);
    }
  }

  return Bun.fetch(url, options);
}

async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
