import { randomBytes } from "node:crypto";
import { fetch as undiciFetch } from "undici";

export const SUPPORTED_PROXY_TYPES = new Set([
  "http",
  "https",
  "socks5",
  "socks5h",
  "vercel",
  "cloudflare",
]);

export const RELAY_PROXY_TYPES = new Set(["vercel", "cloudflare"]);

export function isSupportedProxyType(type) {
  return SUPPORTED_PROXY_TYPES.has(String(type || "").trim().toLowerCase());
}

export function isRelayProxyType(type) {
  return RELAY_PROXY_TYPES.has(String(type || "").trim().toLowerCase());
}

export function createRelayToken() {
  return randomBytes(32).toString("base64url");
}

export function normalizeRelayProjectName(value, fallback = `relay-${Date.now().toString(36)}`) {
  const name = String(value || fallback).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    throw new TypeError("Project name must use lowercase letters, numbers, and hyphens (max 63 characters)");
  }
  return name;
}

export function publicProxyPool(pool) {
  if (!pool || typeof pool !== "object") return pool;
  const { relayToken: _relayToken, ...safePool } = pool;
  return safePool;
}

export async function testRelayEndpoint(relayUrl, relayToken, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await undiciFetch(relayUrl, {
      method: "GET",
      headers: {
        ...(relayToken ? { "x-sway-relay-token": relayToken } : {}),
        "x-relay-target": "https://www.google.com",
        "x-relay-path": "/generate_204",
      },
      signal: controller.signal,
    });
    await response.body?.cancel();
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "Relay test timed out" : "Relay request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
