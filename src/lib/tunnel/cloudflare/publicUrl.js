const PUBLIC_TUNNEL_DOMAIN = "abc-tunnel.us";

export function getPublicTunnelUrl(shortId) {
  const id = String(shortId || "").trim().toLowerCase();
  return id ? `https://r${id}.${PUBLIC_TUNNEL_DOMAIN}` : "";
}

function hostnameFromUrl(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostnameFromHeader(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/^\[|\]$/g, "").split(":")[0];
}

export function getTunnelHosts(settings, state) {
  const hosts = new Set();
  const directHost = hostnameFromUrl(settings?.tunnelUrl);
  if (directHost) hosts.add(directHost);

  if (settings?.tunnelEnabled === true) {
    const publicHost = hostnameFromUrl(getPublicTunnelUrl(state?.shortId));
    if (publicHost) hosts.add(publicHost);
  }

  return hosts;
}

export function isTunnelHost(hostHeader, settings, state) {
  const host = hostnameFromHeader(hostHeader);
  return Boolean(host && getTunnelHosts(settings, state).has(host));
}

export const __test__ = { hostnameFromHeader, hostnameFromUrl };
