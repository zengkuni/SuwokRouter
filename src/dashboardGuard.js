import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { loadState } from "@/lib/tunnel/shared/state.js";
import { isTunnelHost } from "@/lib/tunnel/cloudflare/publicUrl.js";

const CLI_TOKEN_HEADER = "x-swayrouter-cli-token";
const CLI_TOKEN_SALT = "swayrouter-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/version",
  "/api/settings/require-login",
];

const PUBLIC_PREFIXES = ["/v1", "/api/v1", "/codex"];

const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

const PROTECTED_API_PATHS = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/proxy-pools",
  "/api/combos",
  "/api/models",
  "/api/usage",
  "/api/oauth",
  "/api/cloud",
  "/api/pricing",
  "/api/tags",
  "/api/cli-tools",
  "/api/mcp",
  "/api/translator",
  "/api/tunnel",
];

const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/chat/tools/curl",
  "/api/chat/tools/shell",
  "/api/mcp/",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/auth/reset-password",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(h) {
  if (!h) return false;
  const name = h.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(name);
}

export function isLocalRequest(request) {

  if (request.headers.get("x-swayrouter-via-proxy")) return false;

  const realIp = request.headers.get("x-swayrouter-real-ip");
  if (realIp) {
    if (!isLoopbackHostname(realIp)) return false;
  } else if (!isLoopbackHostname(request.headers.get("host"))) {

    return false;
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  return request.nextUrl.searchParams?.get("key") || null;
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  if (await hasValidCliToken(request)) return true;
  return await hasValidApiKey(request);
}

async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;

  if (isLocalRequest(request) && await isAuthenticated(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = request.cookies.get("auth_token")?.value;
  return !!(await getDashboardAuthSession(token));
}

async function getAuthSession(request) {
  return await getDashboardAuthSession(request.cookies.get("auth_token")?.value);
}

async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  hasValidCliToken,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const authSession = await getAuthSession(request);
  const passwordChangeRequired = authSession?.mustChangePassword === true;
  const isPasswordSetup = pathname === "/api/settings" && request.method.toUpperCase() === "PATCH";
  const isPasswordSetupPage = pathname === "/setup" || pathname.startsWith("/setup/");
  const isProtectedRequest = pathname.startsWith("/api/") || isPublicLlmApi(pathname) || pathname.startsWith("/dashboard");

  if (passwordChangeRequired && isProtectedRequest && !pathname.startsWith("/api/auth/") && !isPasswordSetup && !isPasswordSetupPage) {
    if (pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }
    return NextResponse.json(
      { error: "Password change required", code: "password_change_required" },
      { status: 403 },
    );
  }

  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    return NextResponse.json({ error: "API key required for remote API access" }, { status: 401 });
  }

  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    if (await hasValidCliToken(request) || await isAuthenticated(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          if (isTunnelHost(host, settings, loadState())) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {

    }

    if (!requireLogin) return NextResponse.next();

    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      if (authSession) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
