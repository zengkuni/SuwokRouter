const DEFAULT_PROXY_SCHEME = "http:";
const PROXY_SCHEMES = new Set(["http:", "https:", "socks5:", "socks5h:"]);

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function defaultSchemeForType(proxyType) {
  const type = normalizeString(proxyType).toLowerCase();
  if (type === "https") return "https:";
  if (type === "socks5" || type === "socks5h") return `${type}:`;
  return DEFAULT_PROXY_SCHEME;
}

export function normalizeProxyUrl(value, proxyType) {
  const input = normalizeString(value);
  if (!input) return null;
  if ([...input].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f || char === "`" || char === "$";
  })) {
    throw new TypeError("Proxy URL contains invalid characters");
  }

  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  const schemeWithoutAuthority = /^(?:https?|socks5h?):(?!\/\/)/i.test(input);
  if (schemeWithoutAuthority) {
    throw new TypeError("Proxy URL must include a host");
  }

  const candidate = explicitScheme
    ? input
    : `${defaultSchemeForType(proxyType)}//${input}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TypeError("Proxy URL is invalid");
  }

  if (!PROXY_SCHEMES.has(parsed.protocol) || !parsed.hostname) {
    throw new TypeError("Proxy URL must use http, https, socks5, or socks5h");
  }

  const type = normalizeString(proxyType).toLowerCase();
  const typeIsSocks = type === "socks5" || type === "socks5h";
  const urlIsSocks = parsed.protocol === "socks5:" || parsed.protocol === "socks5h:";
  if (typeIsSocks !== urlIsSocks && explicitScheme) {
    throw new TypeError(`Proxy type ${type || "http"} does not match URL scheme ${parsed.protocol.slice(0, -1)}`);
  }

  return parsed.href;
}

export function isSocksProxyUrl(proxyUrl, proxyType) {
  try {
    const protocol = new URL(proxyUrl).protocol;
    if (protocol === "socks5:" || protocol === "socks5h:") return true;
    if (protocol === "http:" || protocol === "https:") return false;
  } catch {

  }

  const type = normalizeString(proxyType).toLowerCase();
  return type === "socks5" || type === "socks5h";
}

export function safeProxyError(error) {
  const message = error?.message || String(error);
  return message.replace(
    /((?:https?|socks5h?|socks4a?):\/\/)[^/\s@]+@/gi,
    "$1[redacted]@",
  );
}
