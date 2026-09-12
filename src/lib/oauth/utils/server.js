import http from "http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "url";
import { CODEX_CONFIG, TRAE_CONFIG, WINDSURF_CONFIG } from "../constants/oauth.js";

function isLoopbackOrigin(origin) {
  if (!origin) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

export function startLocalServer(onCallback, fixedPort = null, provider = "codex") {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      if (url.pathname === "/callback" || url.pathname === "/auth/callback") {
        const params = Object.fromEntries(url.searchParams);

        const callbackFailed = Boolean(params.error);
        res.writeHead(callbackFailed ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(
          !callbackFailed,
          callbackFailed ? "OAuth sign-in failed. Return to the app and try again." : "You can close this window.",
          provider
        ));

        onCallback(params);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    const portToUse = fixedPort || 0;
    server.listen(portToUse, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        close: () => server.close(),
      });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && fixedPort) {
        reject(new Error(`Port ${fixedPort} is already in use. Please close other applications using this port.`));
      } else {
        reject(err);
      }
    });
  });
}

export function waitForCallback(timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Authentication timeout"));
      }
    }, timeoutMs);

    const onCallback = (params) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(params);
      }
    };

    resolve.__onCallback = onCallback;
  });
}

let codexProxyServer = null;
let codexProxyTimeout = null;

const CODEX_PROXY_TIMEOUT_MS = 300000;
const CODEX_PORT = CODEX_CONFIG.fixedPort;
const OAUTH_SESSION_TTL_MS = 300000;

const pendingExchanges = new Map();

function scheduleSessionExpiry(map, state, session) {
  session.expiryTimer = setTimeout(() => {
    if (map.get(state) !== session) return;
    map.delete(state);
  }, OAUTH_SESSION_TTL_MS);
}

function clearSessionTimer(session) {
  if (session?.expiryTimer) {
    clearTimeout(session.expiryTimer);
    session.expiryTimer = null;
  }
}

function clearMapSession(map, state) {
  const session = map.get(state);
  clearSessionTimer(session);
  map.delete(state);
}

function claimSession(map, state) {
  const session = map.get(state);
  if (!session || session.status !== "pending") return null;
  session.status = "processing";
  clearSessionTimer(session);
  return session;
}

export function registerCodexSession({ state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  clearMapSession(pendingExchanges, state);
  const session = {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  };
  pendingExchanges.set(state, session);
  scheduleSessionExpiry(pendingExchanges, state, session);
  return true;
}

export function getCodexSessionStatus(state) {
  return pendingExchanges.get(state) || null;
}

export function clearCodexSession(state) {
  clearMapSession(pendingExchanges, state);
}

function markSessionFinished(session, status, error = null) {
  session.status = status;
  session.error = error;
  session.finishedAt = Date.now();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CALLBACK_PROVIDER_ICON_FILES = Object.freeze({
  antigravity: "antigravity.svg",
  claude: "claude.svg",
  codex: "codex.svg",
  "gemini-cli": "geminicli.svg",
  github: "github.svg",
  kimchi: "kimchi.svg",
  openai: "openai.svg",
  trae: "trae.svg",
  windsurf: "windsurf.svg",

  xai: "grok.svg",
});

const CALLBACK_PROVIDER_ALIASES = Object.freeze({
  "gemini cli": "gemini-cli",
  "github copilot": "github",
  "grok-cli": "xai",
  "grok cli": "xai",
  "grok-web": "xai",
});

function normalizeCallbackProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  return CALLBACK_PROVIDER_ALIASES[normalized] || normalized;
}

function loadCallbackProviderIcon(provider) {
  const fileName = CALLBACK_PROVIDER_ICON_FILES[normalizeCallbackProvider(provider)];
  if (!fileName) return null;
  try {
    const assetPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../dashboard/public/providers",
      fileName
    );
    const svg = fs.readFileSync(assetPath, "utf8").trim();
    if (!svg.startsWith("<svg") || !svg.endsWith("</svg>")) return null;

    return svg.replace(/<svg\b/i, '<svg class="provider-mark"');
  } catch {

    return null;
  }
}

function renderCodexResultPage(success, message, provider = "codex") {
  const safeMessage = escapeHtml(message);
  const title = success ? "Connected successfully" : "Connection could not be completed";
  const eyebrow = success ? "Sway Router" : "Sway Router OAuth";
  const accent = success ? "#22c55e" : "#ef4444";
  const fallbackIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`;
  const providerIcon = success ? loadCallbackProviderIcon(provider) : null;
  const icon = providerIcon || (success
    ? fallbackIcon
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.8 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/></svg>`);
  const iconClass = providerIcon ? "icon provider-icon" : "icon";
  const brandLogo = `<svg class="brand-logo" viewBox="0 0 500 500" aria-hidden="true"><rect width="500" height="500" rx="100" fill="#0077FF"/><path d="M408.8 346c-2.6 9.3-6.5 17.5-11.4 24.7-11.7 17.3-28.3 28.2-49.9 35.1-10.9 3.5-20.9 5.2-30.3 5.2H117.9c-9.1 0-17.2-4.1-22.6-10.5 1.7.4 3.5.7 5.2.7h106.6c11.3 0 20.5-9.2 20.5-20.5s-9.2-20.5-20.5-20.5H100.5c-1.3 0-2.5.1-3.7.3 5.4-5.5 12.9-8.8 21.1-8.8h199.2c10.1 0 18.2-2.6 24.3-7.7h67.4ZM155.9 211.6c6.2 5.5 14.5 8.2 24.8 8.2h136.9c6.4.2 13.2 1.1 20.3 2.8 21.6 4.6 38.9 14.6 51.5 29.9 8.1 9.8 14.5 21.3 19.3 34.5h-68.5c-2.4-1.9-5.1-3.5-8.2-4.7-4.4-1.8-9.3-2.7-14.8-2.7H180.7c-9.6 0-20-1.7-31-5-20.5-6.2-37.5-17.2-51.1-33-8.1-9.4-14.7-20.1-19.8-32h67.1Zm197-125.6c8.4 0 16 3.5 21.4 9.1H269.4c-11.3 0-20.5 9.2-20.5 20.5s9.2 20.5 20.5 20.5h105.1c-5.4 5.7-13 9.2-21.5 9.2H180.7c-9.4 0-17.1 2.4-23.1 7.2H89.2c1.5-5.3 3.3-10.2 5.7-14.7 7.6-14.7 18.8-24.7 33.7-32.1 15.1-7.5 32.4-9.7 52-9.7h172.3Z" fill="white"/></svg>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Sway Router</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#121214;color:#f4f4f5;--background:#121214;--foreground:#f4f4f5;--card:#1a1a1e;--muted:#242428;--muted-foreground:#a1a1aa;--border:#2e2e34;--primary:#006fff}
*{box-sizing:border-box}body{min-width:320px;min-height:100vh;margin:0;display:grid;place-items:center;background:var(--background);color:var(--foreground);padding:16px;-webkit-font-smoothing:antialiased}
.card{width:min(100%,420px);border:1px solid var(--border);border-radius:16px;background:var(--card);padding:24px;text-align:center}
.brand{display:inline-flex;align-items:center;gap:9px;color:var(--muted-foreground);font-size:13px;font-weight:600;letter-spacing:.01em}.brand-logo{display:block;width:32px;height:32px;border-radius:8px}
.icon{display:grid;place-items:center;width:56px;height:56px;margin:24px auto 18px;border-radius:16px;background:${accent}1a;color:${accent};border:1px solid ${accent}55}.icon.provider-icon{background:#fff;border-color:rgba(255,255,255,.3);outline:1px solid rgba(255,255,255,.15);outline-offset:2px;color:#121214}.icon svg{width:28px;height:28px}.icon svg:not(.provider-mark){fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}.icon .provider-mark{display:block;width:30px;height:30px}.icon.provider-icon .provider-mark{filter:invert(1)}
h1{margin:0;color:var(--foreground);font-size:21px;line-height:1.25;letter-spacing:-.02em}p{margin:10px 0 0;color:var(--muted-foreground);font-size:14px;line-height:1.55;overflow-wrap:anywhere}.status{display:inline-flex;align-items:center;gap:7px;margin-top:20px;border:1px solid var(--border);border-radius:999px;background:var(--muted);padding:6px 10px;color:var(--foreground);font-size:11px}.dot{width:6px;height:6px;border-radius:50%;background:${accent}}
#message{margin-top:16px;color:#71717a;font-size:12px}#countdown{color:var(--foreground);font-variant-numeric:tabular-nums;font-weight:600}
</style></head><body><main class="card" role="status" aria-live="polite"><div class="brand">${brandLogo}<span>${eyebrow}</span></div><div class="${iconClass}">${icon}</div><h1>${title}</h1><p>${safeMessage}</p><div class="status"><span class="dot"></span><span>OAuth flow finished</span></div><p id="message">This window will close in <span id="countdown">3</span> seconds.</p></main>
<script>let count=3;const countdown=document.getElementById("countdown"),message=document.getElementById("message");const timer=setInterval(()=>{count-=1;countdown.textContent=String(count);if(count<=0){clearInterval(timer);window.close();setTimeout(()=>{message.textContent="You can close this window manually."},500)}},1000);</script></body></html>`;
}

const SAFE_CALLBACK_ERROR = "OAuth sign-in failed. Return to the app and try again.";

function callbackError(error) {
  console.error("[OAuth callback]", error);
  return SAFE_CALLBACK_ERROR;
}

export function startCodexProxy(appPort) {
  return new Promise((resolve) => {
    if (codexProxyServer) {
      resolve({ success: true });
      return;
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const existingSession = state ? pendingExchanges.get(state) : null;
      const session = state ? claimSession(pendingExchanges, state) : null;

      if (existingSession && !session) {
        res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "This OAuth callback has already been processed.", "codex"));
        return;
      }

      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers.js");
          const { createProviderConnection } = await import("@/models");

          const tokenData = await exchangeTokens(
            "codex",
            code,
            session.redirectUri,
            session.codeVerifier,
            state
          );
          const connection = await createProviderConnection({
            provider: "codex",
            authType: "oauth",
            ...tokenData,
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          });

          markSessionFinished(session, "done");
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(true, "You can close this window.", "codex"));
        } catch (err) {
          markSessionFinished(session, "error", err.message);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(false, callbackError(err), "codex"));
        } finally {
          stopCodexProxy();
        }
        return;
      }

      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopCodexProxy();
    });

    server.listen(CODEX_PORT, "127.0.0.1", () => {
      codexProxyServer = server;
      codexProxyTimeout = setTimeout(() => stopCodexProxy(), CODEX_PROXY_TIMEOUT_MS);
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

export function stopCodexProxy() {
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyServer) {
    codexProxyServer.close();
    codexProxyServer = null;
  }
}

let xaiProxyServer = null;
let xaiProxyTimeout = null;
const XAI_PROXY_TIMEOUT_MS = 300000;
const XAI_PROXY_PORT = 56121;
const xaiPendingExchanges = new Map();

export function registerXaiSession({ state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  clearMapSession(xaiPendingExchanges, state);
  const session = {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  };
  xaiPendingExchanges.set(state, session);
  scheduleSessionExpiry(xaiPendingExchanges, state, session);
  return true;
}

export function getXaiSessionStatus(state) {
  return xaiPendingExchanges.get(state) || null;
}

export function clearXaiSession(state) {
  clearMapSession(xaiPendingExchanges, state);
}

function renderXaiResultPage(success, message) {
  return renderCodexResultPage(success, message, "xai");
}

export function startXaiProxy(appPort) {
  return new Promise((resolve) => {
    if (xaiProxyServer) {
      resolve({ success: true });
      return;
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const existingSession = state ? xaiPendingExchanges.get(state) : null;
      const session = state ? claimSession(xaiPendingExchanges, state) : null;

      if (existingSession && !session) {
        res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderXaiResultPage(false, "This OAuth callback has already been processed."));
        return;
      }

      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers.js");
          const { createProviderConnection } = await import("@/models");

          const tokenData = await exchangeTokens(
            "xai",
            code,
            session.redirectUri,
            session.codeVerifier,
            state
          );
          const connection = await createProviderConnection({
            provider: "xai",
            authType: "oauth",
            ...tokenData,
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          });

          markSessionFinished(session, "done");
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(true, "You can close this window."));
        } catch (err) {
          markSessionFinished(session, "error", err.message);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(false, callbackError(err)));
        } finally {
          stopXaiProxy();
        }
        return;
      }

      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopXaiProxy();
    });

    server.listen(XAI_PROXY_PORT, "127.0.0.1", () => {
      xaiProxyServer = server;
      xaiProxyTimeout = setTimeout(() => stopXaiProxy(), XAI_PROXY_TIMEOUT_MS);
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

export function stopXaiProxy() {
  if (xaiProxyTimeout) {
    clearTimeout(xaiProxyTimeout);
    xaiProxyTimeout = null;
  }
  if (xaiProxyServer) {
    xaiProxyServer.close();
    xaiProxyServer = null;
  }
}

let traeProxyServer = null;
let traeProxyTimeout = null;
let traeProxyPort = null;
let traeSession = null;

export function registerTraeSession({ state }) {
  if (!state) return false;
  if (traeSession) clearSessionTimer(traeSession);
  traeSession = { state, status: "pending", createdAt: Date.now() };
  traeSession.expiryTimer = setTimeout(() => {
    if (traeSession?.state === state) traeSession = null;
  }, OAUTH_SESSION_TTL_MS);
  return true;
}
export function getTraeSessionStatus(state) {
  if (!traeSession) return null;
  if (Date.now() - traeSession.createdAt >= OAUTH_SESSION_TTL_MS) {
    clearTraeSession(state);
    return null;
  }
  if (state && traeSession.state !== state) return null;
  return traeSession;
}
export function clearTraeSession(state) {
  if (!state || (traeSession && traeSession.state === state)) {
    clearSessionTimer(traeSession);
    traeSession = null;
  }
}

function claimSingletonSession(session, state) {
  if (!session || session.state !== state || session.status !== "pending") return null;
  session.status = "processing";
  clearSessionTimer(session);
  return session;
}

function finishSingletonSession(session, status, error = null) {
  session.status = status;
  session.error = error;
  session.finishedAt = Date.now();
}

export function startTraeProxy() {
  return new Promise((resolve) => {
    if (traeProxyServer) {
      resolve({ success: true, port: traeProxyPort, callbackUrl: `http://127.0.0.1:${traeProxyPort}${TRAE_CONFIG.callbackPath}` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const renderResult = (success, message) => renderCodexResultPage(success, message, "trae");
      if (url.pathname !== TRAE_CONFIG.callbackPath && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const pendingSession = traeSession;
      const cbState = url.searchParams.get("state");
      if (!pendingSession) {
        res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "This OAuth callback is missing, expired, or already processed."));
        return;
      }
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "Cross-origin callback rejected"));
        return;
      }
      if (!cbState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "Trae callback state is required"));
        return;
      }
      if (cbState !== pendingSession.state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "Trae callback state mismatch"));
        return;
      }
      const session = claimSingletonSession(pendingSession, cbState);
      if (!session) {
        res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "This OAuth callback has already been processed."));
        return;
      }

      const rawCallback = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("trae", rawCallback);
        const connection = await createProviderConnection({
          provider: "trae",
          authType: "oauth",
          ...tokenData,
          expiresAt: tokenData.expiresIn
            ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
            : null,
          testStatus: "active",
        });
        finishSingletonSession(session, "done");
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(true, "You can close this window."));
      } catch (err) {
        finishSingletonSession(session, "error", err.message);
        console.error("[OAuth][TraeCallback]", err);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "OAuth sign-in failed. Return to the app and try again."));
      } finally {
        stopTraeProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      traeProxyServer = server;
      traeProxyPort = server.address().port;
      traeProxyTimeout = setTimeout(() => {
        clearTraeSession();
        stopTraeProxy();
      }, TRAE_CONFIG.oauthTimeoutMs);
      resolve({ success: true, port: traeProxyPort, callbackUrl: `http://127.0.0.1:${traeProxyPort}${TRAE_CONFIG.callbackPath}` });
    });
    server.on("error", (err) => resolve({ success: false, reason: err.message }));
  });
}

export function stopTraeProxy() {
  if (traeProxyTimeout) { clearTimeout(traeProxyTimeout); traeProxyTimeout = null; }
  if (traeProxyServer) { traeProxyServer.close(); traeProxyServer = null; }
  traeProxyPort = null;
}

let windsurfProxyServer = null;
let windsurfProxyTimeout = null;
let windsurfProxyPort = null;
let windsurfSession = null;

export function registerWindsurfSession({ state }) {
  if (!state) return false;
  if (windsurfSession) clearSessionTimer(windsurfSession);
  windsurfSession = { state, status: "pending", createdAt: Date.now() };
  windsurfSession.expiryTimer = setTimeout(() => {
    if (windsurfSession?.state === state) windsurfSession = null;
  }, OAUTH_SESSION_TTL_MS);
  return true;
}
export function getWindsurfSessionStatus(state) {
  if (!windsurfSession) return null;
  if (Date.now() - windsurfSession.createdAt >= OAUTH_SESSION_TTL_MS) {
    clearWindsurfSession(state);
    return null;
  }
  if (state && windsurfSession.state !== state) return null;
  return windsurfSession;
}
export function clearWindsurfSession(state) {
  if (!state || (windsurfSession && windsurfSession.state === state)) {
    clearSessionTimer(windsurfSession);
    windsurfSession = null;
  }
}

function claimWindsurfSession(state) {
  if (!windsurfSession || windsurfSession.state !== state || windsurfSession.status !== "pending") return null;
  windsurfSession.status = "processing";
  clearSessionTimer(windsurfSession);
  return windsurfSession;
}

function finishWindsurfSession(session, status, error = null) {
  session.status = status;
  session.error = error;
  session.finishedAt = Date.now();
}

export function startWindsurfProxy() {
  return new Promise((resolve) => {
    if (windsurfProxyServer) {
      resolve({ success: true, port: windsurfProxyPort, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${WINDSURF_CONFIG.callbackPath}` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const renderResult = (success, message) => renderCodexResultPage(success, message, "windsurf");
      if (url.pathname !== WINDSURF_CONFIG.callbackPath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const pendingSession = windsurfSession;
      if (!pendingSession) {
        res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "This OAuth callback is missing, expired, or already processed."));
        return;
      }

      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "Cross-origin callback rejected"));
        return;
      }
      const cbState = url.searchParams.get("state");
      if (!cbState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "Windsurf callback state is required"));
        return;
      }
      if (cbState !== pendingSession.state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "Windsurf callback state mismatch"));
        return;
      }
      const session = claimWindsurfSession(cbState);
      if (!session) {
        res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "This OAuth callback has already been processed."));
        return;
      }
      const rawCallback = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("windsurf", rawCallback, null, null, session.state);
        const connection = await createProviderConnection({
          provider: "windsurf",
          authType: "api_key",
          ...tokenData,
          testStatus: "active",
        });
        finishSingletonSession(session, "done");
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(true, "You can close this window."));
      } catch (err) {
        finishSingletonSession(session, "error", err.message);
        console.error("[OAuth][WindsurfCallback]", err);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResult(false, "OAuth sign-in failed. Return to the app and try again."));
      } finally {
        stopWindsurfProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      windsurfProxyServer = server;
      windsurfProxyPort = server.address().port;
      windsurfProxyTimeout = setTimeout(() => {
        clearWindsurfSession();
        stopWindsurfProxy();
      }, WINDSURF_CONFIG.oauthTimeoutMs);
      resolve({ success: true, port: windsurfProxyPort, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${WINDSURF_CONFIG.callbackPath}` });
    });
    server.on("error", (err) => resolve({ success: false, reason: err.message }));
  });
}

export function stopWindsurfProxy() {
  if (windsurfProxyTimeout) { clearTimeout(windsurfProxyTimeout); windsurfProxyTimeout = null; }
  if (windsurfProxyServer) { windsurfProxyServer.close(); windsurfProxyServer = null; }
  windsurfProxyPort = null;
}
