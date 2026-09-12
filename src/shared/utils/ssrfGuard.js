const allowPrivate = () => process.env.SSRF_ALLOW_PRIVATE === "true";

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "ip6-localhost", "ip6-loopback", "0.0.0.0",
]);
const BLOCKED_METADATA_HOSTNAMES = new Set([
  "metadata.google.internal", "instance-data", "169.254.169.254", "metadata",
]);
const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost", ".localdomain", ".home.arpa", ".lan"];

function ipv4ToInt(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function isIpv4Literal(host) { return ipv4ToInt(host) !== null; }

function isUnsafeIpv4(value) {
  return (
    value < 0x01000000 ||
    (value >= 0x0a000000 && value < 0x0b000000) ||
    (value >= 0x64400000 && value < 0x64800000) ||
    (value >= 0x7f000000 && value < 0x80000000) ||
    (value >= 0xa9fe0000 && value < 0xa9ff0000) ||
    (value >= 0xac100000 && value < 0xac200000) ||
    (value >= 0xc0000000 && value < 0xc0000100) ||
    (value >= 0xc0000200 && value < 0xc0000300) ||
    (value >= 0xc0a80000 && value < 0xc0a90000) ||
    (value >= 0xc6120000 && value < 0xc6140000) ||
    (value >= 0xc6336400 && value < 0xc6336500) ||
    (value >= 0xcb007100 && value < 0xcb007200) ||
    value >= 0xe0000000
  );
}

function ipv6ToBigInt(host) {
  if (!host.includes(":")) return null;
  const compressed = host.split("::");
  if (compressed.length > 2) return null;
  let left = compressed[0] === "" ? [] : (compressed[0] ?? "").split(":");
  let right = compressed.length === 2 ? (compressed[1] === "" ? [] : (compressed[1] ?? "").split(":")) : [];
  let v4 = null;

  const pluckV4 = (arr) => {
    const last = arr[arr.length - 1];
    if (last !== undefined && last.includes(".")) {
      const octets = last.split(".");
      if (octets.length !== 4) return null;
      const nums = [];
      for (const o of octets) { if (!/^\d{1,3}$/.test(o) || Number(o) > 255) return null; nums.push(Number(o)); }
      return [nums[0] * 256 + nums[1], nums[2] * 256 + nums[3]];
    }
    return undefined;
  };

  const v4InLeft = pluckV4(left);
  if (v4InLeft === null) return null;
  if (v4InLeft) { v4 = v4InLeft; left = left.slice(0, -1); }
  else {
    const v4InRight = pluckV4(right);
    if (v4InRight === null) return null;
    if (v4InRight) { v4 = v4InRight; right = right.slice(0, -1); }
  }

  const parseHextet = (part) => /^[0-9a-f]{1,4}$/i.test(part) ? parseInt(part, 16) : null;
  const groups = [];
  for (const part of left) { const h = parseHextet(part); if (h === null) return null; groups.push(h); }
  if (compressed.length === 2) {
    const missing = 8 - groups.length - right.length - (v4 ? 2 : 0);
    if (missing < 0) return null;
    for (let i = 0; i < missing; i++) groups.push(0);
  }
  for (const part of right) { const h = parseHextet(part); if (h === null) return null; groups.push(h); }
  if (v4) groups.push(v4[0], v4[1]);
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(g);
  return value;
}

function ipv6Range(prefixHex, prefixBits) {
  const prefix = BigInt(`0x${prefixHex}`);
  const freeBits = 128n - BigInt(prefixBits);
  const mask = (1n << 128n) - (1n << freeBits);
  const lo = prefix & mask;
  return { lo, hi: lo | ((1n << freeBits) - 1n) };
}

const UNSAFE_IPV6_RANGES = [
  ipv6Range("00000000000000000000000000000000", 128),
  ipv6Range("00000000000000000000000000000001", 128),
  ipv6Range("0064ff9b000100000000000000000000", 48),
  ipv6Range("fc000000000000000000000000000000", 7),
  ipv6Range("fe800000000000000000000000000000", 10),
  ipv6Range("ff000000000000000000000000000000", 8),
  ipv6Range("20010db8000000000000000000000000", 32),
  ipv6Range("20010010000000000000000000000000", 28),
  ipv6Range("20010002000000000000000000000000", 48),
  ipv6Range("01000000000000000000000000000000", 64),
];

function embeddedIpv4(value) {

  const lower32 = Number(value & 0xffffffffn);
  if (!Number.isFinite(lower32) || lower32 < 0) return null;

  if ((value >> 32n) === 0n) return lower32;

  if ((value >> 32n) === 0xffffn) return lower32;

  if ((value >> 96n) === 0x64ff9bn) return lower32;
  return null;
}

function isUnsafeIpv6(value) {
  for (const range of UNSAFE_IPV6_RANGES) if (value >= range.lo && value <= range.hi) return true;
  const emb = embeddedIpv4(value);
  return emb !== null && isUnsafeIpv4(emb);
}

function isIpLiteral(host) {
  if (!host) return false;
  return isIpv4Literal(host) || (host.includes(":") && ipv6ToBigInt(host) !== null);
}

export function isUnsafeIp(host) {
  const ip4 = ipv4ToInt(host);
  if (ip4 !== null) return isUnsafeIpv4(ip4);
  const v6 = ipv6ToBigInt(host);
  if (v6 === null) return true;
  return isUnsafeIpv6(v6);
}

function normalizeHostname(host) {
  let value = (host || "").toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  value = value.replace(/\.$/, "");
  return value === "" ? null : value;
}

function isBlockedHostname(hostname) {
  if (!hostname) return false;
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_METADATA_HOSTNAMES.has(hostname)) return true;
  return BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s));
}

export class SsrfGuardError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "SsrfGuardError";
    this.reason = reason;
  }
}

const MAX_SSRF_URL_LENGTH = 4096;
const DEFAULT_ALLOWED_PROTOCOLS = new Set(["http:", "https:", "socks5:"]);

export function assertPublicUrl(rawUrl, options = {}) {
  const label = options.label ?? "URL";
  if (typeof rawUrl !== "string" || rawUrl.length === 0) throw new SsrfGuardError("invalid_url", `Invalid ${label}: no URL provided`);
  if (rawUrl.length > MAX_SSRF_URL_LENGTH) throw new SsrfGuardError("invalid_url", `Invalid ${label}: URL exceeds ${MAX_SSRF_URL_LENGTH} characters`);
  let url;
  try { url = new URL(rawUrl); } catch { throw new SsrfGuardError("invalid_url", `Invalid ${label}: malformed URL`); }
  const allowed = options.allowedProtocols ?? DEFAULT_ALLOWED_PROTOCOLS;
  if (!allowed.has(url.protocol)) throw new SsrfGuardError("unsupported_protocol", `Invalid ${label}: protocol "${url.protocol}" not allowed`);
  if (url.username !== "" || url.password !== "") throw new SsrfGuardError("invalid_url", `Invalid ${label}: URL with embedded credentials is not allowed`);
  const host = normalizeHostname(url.hostname);
  if (host === null) throw new SsrfGuardError("invalid_url", `Invalid ${label}: no usable host`);

  if (BLOCKED_METADATA_HOSTNAMES.has(host)) throw new SsrfGuardError("blocked_host", `Blocked metadata host: "${url.hostname}"`);
  if (allowPrivate()) return url;
  if (isBlockedHostname(host)) throw new SsrfGuardError("blocked_host", `Blocked private/loopback host: "${url.hostname}"`);
  if (isIpLiteral(host) && isUnsafeIp(host)) throw new SsrfGuardError("blocked_ip", `Blocked private/reserved IP: "${url.hostname}"`);
  return url;
}

export function validatePublicUrl(rawUrl, label = "URL") {
  try { assertPublicUrl(rawUrl, { label }); return null; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

const RESOLVE_CACHE = new Map();
const RESOLVE_CACHE_MAX = 4;
const RESOLVE_CACHE_TTL_MS = 30_000;

function cachedLookup(hostname) {
  const now = Date.now();
  const hit = RESOLVE_CACHE.get(hostname);
  if (hit && hit.expiresAt > now) return hit.addresses;
}

function setCachedLookup(hostname, addresses) {
  RESOLVE_CACHE.set(hostname, { addresses, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
  if (RESOLVE_CACHE.size > RESOLVE_CACHE_MAX) RESOLVE_CACHE.delete(RESOLVE_CACHE.keys().next().value);
}

async function defaultResolver(hostname) {
  const cached = cachedLookup(hostname);
  if (cached) return cached;
  let addresses = [];
  try {

    if (typeof Bun !== "undefined" && Bun.dns?.lookup) {
      addresses = await Bun.dns.lookup(hostname, { family: 0 });
      addresses = Array.isArray(addresses) ? addresses : [addresses];
    } else if (typeof require === "function") {
      const { lookup } = require("node:dns").promises;
      for (const r of await lookup(hostname, { all: true })) addresses.push(r);
    }
  } catch {                                         }
  setCachedLookup(hostname, addresses);
  return addresses;
}

export async function assertPublicUrlAtDispatch(rawUrl, options = {}) {
  const url = assertPublicUrl(rawUrl, options);
  if (allowPrivate()) return url;
  const host = normalizeHostname(url.hostname);
  if (host === null) throw new SsrfGuardError("invalid_url", `Invalid ${options.label ?? "URL"}: no usable host`);
  if (isIpLiteral(host)) return url;
  const lookup = options.lookup ?? defaultResolver;
  const records = await lookup(host);
  if (records.length === 0) throw new SsrfGuardError("invalid_url", `Invalid ${options.label ?? "URL"}: hostname did not resolve`);
  for (const r of records) {
    const addr = typeof r === "string" ? r : r.address;
    if (!addr) continue;
    if (isUnsafeIp(addr)) throw new SsrfGuardError("blocked_ip", `Blocked private/resolved IP "${url.hostname}" -> "${addr}"`);
  }
  return url;
}

const MAX_REDIRECTS = 5;
function resolveRedirectTarget(base, location) {
  let next;
  try { next = new URL(location, base); } catch { throw new SsrfGuardError("unsupported_protocol", "Redirect target is not a valid URL"); }
  if (next.protocol !== "http:" && next.protocol !== "https:") throw new SsrfGuardError("unsupported_protocol", `Redirect target uses unsupported protocol "${next.protocol}"`);
  return next.toString();
}

export async function fetchWithSsrfGuard(url, init = {}, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const maxRedirects = Math.max(0, Math.min(MAX_REDIRECTS, Math.floor(options.maxRedirects ?? MAX_REDIRECTS)));
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrlAtDispatch(current, {
      ...options,
      label: "redirect target",
    });
    const response = await fetcher(current, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) return response;
    current = resolveRedirectTarget(current, location);
  }
  throw new SsrfGuardError("invalid_url", "Too many redirects while following server-side fetch");
}

export async function validatePublicUrlAtDispatch(rawUrl, options, { onBlock } = {}) {
  try {
    return await assertPublicUrlAtDispatch(rawUrl, options);
  } catch (e) {
    if (e instanceof SsrfGuardError && typeof onBlock === "function") {
      try { await onBlock(e); } catch {}
    }
    return e;
  }
}

export function __resetSsrfCacheForTests() {
  RESOLVE_CACHE.clear();
}
