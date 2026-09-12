import { createCookieStore } from "@/next/server";

export function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name) {
      try {
        out.set(name, decodeURIComponent(value));
      } catch {
        out.set(name, value);
      }
    }
  }
  return out;
}

export function createRequestContext(raw) {
  const url = new URL(raw.url);
  const map = parseCookies(raw.headers.get("cookie") || "");
  const store = {
    cookies: createCookieStore(map),
    headers: raw.headers,
  };

  const guardRequest = new Proxy(raw, {
    get(t, p) {
      if (p === "nextUrl") {
        return {
          pathname: url.pathname,
          searchParams: url.searchParams,
          search: url.search,
          toString: () => raw.url,
        };
      }
      if (p === "cookies") {
        return {
          get: (name) => (map.has(name) ? { name, value: map.get(name) } : undefined),
          getAll: () => [...map.entries()].map(([name, value]) => ({ name, value })),
        };
      }
      return Reflect.get(t, p);
    },
  });

  return { store, guardRequest };
}
