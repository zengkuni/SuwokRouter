import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

function resolveDashboardDist(): string {
  const candidates = [
    join(import.meta.dir, "..", "dashboard", "dist"),
    join(process.cwd(), "dashboard", "dist"),
    join(process.cwd(), "dist-binary", "dashboard", "dist"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]!;
}

const DIST_DIR = resolveDashboardDist();
const INDEX_HTML = join(DIST_DIR, "index.html");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

const API_PREFIXES = ["/api", "/v1", "/codex", "/responses", "/health", "/version", "/metrics"];

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function serveFile(filePath: string, request: Request): Response {
  const stat = statSync(filePath);
  const type = CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";

  const since = request.headers.get("if-modified-since");
  if (since) {
    const sinceMs = Date.parse(since);
    if (!Number.isNaN(sinceMs) && Math.floor(stat.mtimeMs / 1000) * 1000 <= sinceMs) {
      return new Response(null, { status: 304 });
    }
  }

  const body = readFileSync(filePath);
  const isImmutable = filePath.includes(`${sep}assets${sep}`);
  return new Response(body, {
    headers: {
      "content-type": type,
      "cache-control": isImmutable ? "public, max-age=31536000, immutable" : "no-cache",
      "last-modified": stat.mtime.toUTCString(),
      "x-content-type-options": "nosniff",
    },
  });
}

export function tryServeDashboard(request: Request): Response | null {
  if (!existsSync(DIST_DIR)) return null;

  const url = new URL(request.url);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {

    return null;
  }

  if (isApiPath(pathname)) return null;
  if (pathname.includes("..")) return null;

  const filePath = normalize(join(DIST_DIR, pathname));

  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) return null;

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return serveFile(filePath, request);
  }

  if (!extname(pathname)) {
    if (existsSync(INDEX_HTML)) return serveFile(INDEX_HTML, request);
    return null;
  }

  return null;
}
