// Exchange a grok.com `sso` session cookie for Grok Build OAuth credentials
// through the xAI device authorization flow (ported from the upstream
// chenyme/grok2api sso_build.go contract, with the consent-token correction —
// auth.x.ai now rejects the approve POST without the consent_token embedded in
// the device/consent page).
//
// IMPORTANT: this flow must NOT use the runtime's fetch (Bun/undici).
// Cloudflare's bot management on accounts.x.ai and on POST /oauth2/device/approve
// challenges non-browser TLS fingerprints (BoringSSL/OpenSSL via fetch) with a
// "Request could not be verified" 403, while plain curl (Schannel/OpenSSL as
// shipped by the OS package) passes. We therefore drive the entire flow through
// the system `curl` binary with a cookie-jar file that holds the session cookie,
// so no secret ever appears in argv or process listing.
//
// Flow:
//   POST https://auth.x.ai/oauth2/device/code      (device_code + user_code)
//   POST https://auth.x.ai/oauth2/device/verify     (303 -> consent page)
//   GET  https://accounts.x.ai/oauth2/device/consent?user_code=... (consent_token)
//   POST https://auth.x.ai/oauth2/device/approve    (303 -> done)
//   POST https://auth.x.ai/oauth2/token             (poll until issued)

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SSO_BUILD_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SSO_BUILD_SCOPE =
  "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
const DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const DEVICE_VERIFY_URL = "https://auth.x.ai/oauth2/device/verify";
const DEVICE_APPROVE_URL = "https://auth.x.ai/oauth2/device/approve";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 75_000;
// Optional: keep the temp dir per conversion for debugging (env override).
const DEBUG_DIR = process.env.GROK_SSO_DEBUG_DIR || "";

class ConversionError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = "ConversionError";
    this.status = status;
  }
}

function firstString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function safeXaiUrl(raw, expectedPathPrefix) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".x.ai")) return null;
    if (expectedPathPrefix && !parsed.pathname.startsWith(expectedPathPrefix)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Map a verify/approve Location to the flow state it represents.
function deviceRedirectState(location) {
  if (!location) return "";
  const parsed = safeXaiUrl(location);
  if (!parsed) return "external";
  const path = parsed.pathname;
  if (path.startsWith("/oauth2/device/consent")) return "consent";
  if (path.startsWith("/oauth2/device/done")) return "done";
  if (path.startsWith("/sign-in")) return "sign-in";
  return path.replace(/^\//, "").replace(/\//g, "-");
}

function httpFailure(stage, status) {
  return new ConversionError(`${stage} failed (HTTP ${status})`, { status });
}

function decodeBuildClaims(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function claimString(claims, key) {
  const value = claims?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

// Netscape cookie-jar seed for the sso session cookies (curl merges jar entries
// with Set-Cookie headers across hosts under *.x.ai).
async function seedCookieJar(jarPath, token, hostname) {
  const domain = `.${hostname.split(".").slice(-2).join(".")}`;
  const lines = [
    "# Netscape HTTP Cookie File",
    `${domain}\tTRUE\t/\tFALSE\t0\tsso\t${token}`,
    `${domain}\tTRUE\t/\tFALSE\t0\tsso-rw\t${token}`,
    "",
  ];
  await writeFile(jarPath, lines.join("\n"), { mode: 0o600 });
}

function parseHeaderBlock(raw) {
  const headers = { setCookie: [] };
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name === "set-cookie") headers.setCookie.push(value);
    else if (!(name in headers)) headers[name] = value;
  }
  return headers;
}

function curlExitError(code, stderr) {
  if (code === 28 || code === 60 || code === 68) {
    return new ConversionError("Grok Build authorization timed out — retry", { status: null });
  }
  return new ConversionError(
    `Grok Build authorization transport failed (curl exit ${code}${stderr ? `: ${stderr.trim()}` : ""})`,
    { status: null },
  );
}

async function curlRequest(dir, url, { form = null, timeoutMs = REQUEST_TIMEOUT_MS, referer = null } = {}) {
  const headersPath = join(dir, "headers.txt");
  const bodyPath = join(dir, "body.txt");
  const jarPath = join(dir, "jar.txt");
  const args = [
    "--silent",
    "--max-time",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "--connect-timeout",
    "15",
    "--user-agent",
    BROWSER_UA,
    "--cookie",
    jarPath,
    "--cookie-jar",
    jarPath,
    "--dump-header",
    headersPath,
    "--output",
    bodyPath,
    "--write-out",
    "%{http_code}",
  ];
  if (form) {
    args.push("--header", "Content-Type: application/x-www-form-urlencoded");
    if (referer) {
      args.push("--header", `Referer: ${referer}`);
      args.push("--header", `Origin: ${new URL(referer).origin}`);
    }
    for (const [key, value] of Object.entries(form)) {
      args.push("--data-urlencode", `${key}=${value}`);
    }
  } else {
    args.push("--header", "Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
  }
  args.push(url);

  const status = await new Promise((resolve, reject) => {
    execFile(
      "curl",
      args,
      { timeout: timeoutMs + 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(curlExitError(typeof error.code === "number" ? error.code : 1, stderr));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
  const statusCode = Number(status);
  if (!Number.isFinite(statusCode) || statusCode <= 0) {
    throw httpFailure("Grok Build request", 0);
  }
  let headersRaw = "";
  let body = "";
  try {
    headersRaw = await readFile(headersPath, "utf8");
    body = await readFile(bodyPath, "utf8");
  } catch {
    /* transport failure already surfaced via status parsing */
  }
  return { status: statusCode, headers: parseHeaderBlock(headersRaw), body };
}

async function postForm(dir, url, form, { timeoutMs = REQUEST_TIMEOUT_MS, referer = null } = {}) {
  const res = await curlRequest(dir, url, { form, timeoutMs, referer });
  let json = null;
  if (res.body) {
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
  }
  return { status: res.status, location: res.headers.location || "", json, body: res.body };
}

async function getConsentToken(dir, consentUrl, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const parsed = safeXaiUrl(consentUrl, "/oauth2/device/consent");
  if (!parsed) {
    throw new ConversionError("Grok Build consent page URL is not trusted");
  }
  const res = await curlRequest(dir, parsed.toString(), { timeoutMs });
  if (res.status >= 300 && res.status < 400) {
    const state = deviceRedirectState(res.headers.location);
    if (state === "sign-in") {
      throw new ConversionError("Grok SSO cookie is not signed in — re-import a valid sso value", { status: 401 });
    }
    throw new ConversionError(`Grok Build consent page redirected unexpectedly (HTTP ${res.status})`, {
      status: res.status,
    });
  }
  if (res.status < 200 || res.status >= 300) {
    throw httpFailure("Grok Build consent page", res.status);
  }
  // The approve POST is protected by an anti-forgery token embedded in the
  // consent form: <input type="hidden" name="consent_token" value="...">.
  const match = res.body.match(/name="consent_token"\s+value="([^"]+)"/);
  if (!match?.[1]) {
    throw new ConversionError("Grok Build consent page did not contain a consent token");
  }
  return match[1];
}

async function pollToken(dir, deviceCode, intervalSeconds, expiresInSeconds) {
  const interval = Math.max(1, intervalSeconds) * 1000;
  const deadline = Date.now() + Math.min(Math.max(1, expiresInSeconds), POLL_TIMEOUT_MS / 1000) * 1000;
  let lastHttp = null;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (Date.now() >= deadline) {
      throw lastHttp || new ConversionError("Grok Build token request timed out after approval");
    }
    const { status, json } = await postForm(dir, TOKEN_URL, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: SSO_BUILD_CLIENT_ID,
      device_code: deviceCode,
    });
    if (typeof json?.error === "string" && json.error) {
      if (json.error === "authorization_pending") continue;
      if (json.error === "slow_down") {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      if (json.error === "access_denied" || json.error === "expired_token") {
        throw new ConversionError(
          json.error === "expired_token"
            ? "Grok SSO session expired before Build token completion — re-import the cookie"
            : "Grok Build authorization was denied",
          { status },
        );
      }
      const detail = firstString(json.error_description, `error ${json.error}`);
      throw new ConversionError(`Grok Build token request failed: ${detail || `HTTP ${status}`}`, { status });
    }
    if (!json?.access_token) {
      if (status >= 400 && !lastHttp) lastHttp = httpFailure("Grok Build token", status);
      continue;
    }
    const expiresIn = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600;
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : "",
      idToken: typeof json.id_token === "string" ? json.id_token : "",
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      expiresInSeconds: expiresIn,
    };
  }
}

export async function convertGrokSsoToBuild(ssoToken, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const token = String(ssoToken || "").trim();
  if (!token) {
    return { ok: false, error: "Grok SSO cookie is empty", status: 400 };
  }
  let dir = null;
  try {
    dir = await mkdtemp(join(DEBUG_DIR || tmpdir(), "grok-sso-build-"));
    await seedCookieJar(join(dir, "jar.txt"), token, "auth.x.ai");

    const started = await postForm(dir, DEVICE_CODE_URL, {
      client_id: SSO_BUILD_CLIENT_ID,
      scope: SSO_BUILD_SCOPE,
    }, { timeoutMs });
    if (started.status < 200 || started.status >= 300) {
      throw httpFailure("Grok Build device authorization", started.status);
    }
    const deviceCode = firstString(started.json?.device_code);
    const userCode = firstString(started.json?.user_code);
    const interval = Number(started.json?.interval) > 0 ? Number(started.json.interval) : 5;
    const expiresIn = Number(started.json?.expires_in) > 0 ? Number(started.json.expires_in) : 1800;
    if (!deviceCode || !userCode) {
      throw new ConversionError("Grok Build device authorization returned an incomplete response");
    }
    const verified = await postForm(dir, DEVICE_VERIFY_URL, { user_code: userCode }, { timeoutMs });
    if (verified.status === 401) {
      throw new ConversionError("Grok SSO cookie is not authorized — re-import a valid sso value", { status: 401 });
    }
    if (verified.status < 200 || verified.status >= 400) {
      throw httpFailure("Grok Build device verification", verified.status);
    }
    const verifyState = deviceRedirectState(verified.location);
    if (verifyState === "sign-in") {
      throw new ConversionError("Grok SSO cookie is not signed in — re-import a valid sso value", { status: 401 });
    }
    if (verifyState !== "consent") {
      throw new ConversionError(
        `Grok Build device verification was rejected (expected consent page, got "${verifyState || verified.status}")`,
      );
    }

    // auth.x.ai requires the consent-page anti-forgery token for approval.
    const consentToken = await getConsentToken(dir, verified.location, { timeoutMs });

    const approved = await postForm(
      dir,
      DEVICE_APPROVE_URL,
      {
        user_code: userCode,
        consent_token: consentToken,
        action: "allow",
        principal_type: "User",
        principal_id: "",
      },
      { timeoutMs, referer: verified.location },
    );
    if (approved.status < 200 || approved.status >= 400) {
      throw httpFailure("Grok Build device approval", approved.status);
    }
    const approveState = deviceRedirectState(approved.location);
    if (approveState === "sign-in") {
      throw new ConversionError("Grok SSO cookie is not signed in — re-import a valid sso value", { status: 401 });
    }
    if (approveState !== "done") {
      throw new ConversionError(
        `Grok Build device approval was rejected (expected done page, got "${approveState || approved.status}")`,
      );
    }

    const built = await pollToken(dir, deviceCode, interval, expiresIn);
    const claims = decodeBuildClaims(built.idToken || built.accessToken);
    return {
      ok: true,
      ...built,
      email: claimString(claims, "email"),
      userId: claimString(claims, "sub"),
      teamId: claimString(claims, "team_id"),
    };
  } catch (err) {
    const message = err instanceof ConversionError
      ? err.message
      : `Grok Build authorization failed: ${err?.message || "unknown error"}`;
    return { ok: false, error: message, status: err?.status ?? null };
  } finally {
    // Keep the dir when GROK_SSO_DEBUG_DIR is set; otherwise clean up.
    if (dir && !DEBUG_DIR) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export default convertGrokSsoToBuild;
