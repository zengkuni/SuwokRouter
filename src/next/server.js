import { AsyncLocalStorage } from "node:async_hooks";

export const cookieStoreAls = new AsyncLocalStorage();

export const PASSTHROUGH = Symbol("nextResponse.next");

export function createCookieStore(initial = new Map()) {
  const map = new Map();
  for (const [name, value] of initial) map.set(name, { name, value });
  const store = {
    map,
    __set: [],
    __dirty: false,
    set(name, value, opts = {}) {
      map.set(name, { name, value });
      const parts = [`${name}=${encodeURIComponent(value)}`];
      if (opts.httpOnly) parts.push("HttpOnly");
      if (opts.secure) parts.push("Secure");
      if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
      if (opts.path) parts.push(`Path=${opts.path}`);
      if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
      if (opts.expires) {
        parts.push(`Expires=${opts.expires instanceof Date ? opts.expires.toUTCString() : opts.expires}`);
      }
      store.__set.push(parts.join("; "));
      store.__dirty = true;
      return store;
    },
    get(name) {
      const v = map.get(name);
      return v ? { name, value: v.value } : undefined;
    },
    getAll() {
      return [...map.values()];
    },
    has(name) {
      return map.has(name);
    },
    delete(name) {
      map.delete(name);
      store.__set.push(`${name}=; Max-Age=0; Path=/`);
      store.__dirty = true;
      return true;
    },
  };
  return store;
}

export class NextResponse extends Response {
  constructor(body, init = {}) {
    super(body, init);
  }

  static json(data, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(data), { ...init, headers });
  }

  static redirect(url, init = {}) {
    return new NextResponse(null, {
      status: init.status ?? 307,
      headers: { location: String(url), ...(init.headers || {}) },
    });
  }

  static next(init = {}) {
    const res = new NextResponse(null, init);
    res[PASSTHROUGH] = true;
    return res;
  }
}

export const NextRequest = Request;
