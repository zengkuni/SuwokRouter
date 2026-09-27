const GROK_CHAT_API = "https://grok.com/rest/app-chat/conversations/new";
const GROK_SESSION_API = "https://grok.com/api/auth/session";
const GROK_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const GROK_STATSIG_ID = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildGrokSsoHeaders(token, statsigId) {
  return {
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    Cookie: `sso=${token}`,
    Origin: "https://grok.com",
    Pragma: "no-cache",
    Referer: "https://grok.com/",
    "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": GROK_USER_AGENT,
    "x-statsig-id": statsigId || GROK_STATSIG_ID,
    "x-xai-request-id": crypto.randomUUID(),
    traceparent: `00-${randomHex(16)}-${randomHex(8)}-00`,
  };
}

export const GROK_SSO_PROBE_BODY = JSON.stringify({
  temporary: true, modelName: "grok-4", modelMode: "MODEL_MODE_GROK_4", message: "ping",
  fileAttachments: [], imageAttachments: [],
  disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
  returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
  forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
  isReasoning: false, disableTextFollowUps: true, disableMemory: true,
  forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
});

export const GROK_SSO_INVALID_MESSAGE = "Invalid SSO cookie — re-paste from grok.com DevTools → Cookies → sso";

/**
 * grok.com wraps chat in an anti-bot layer that answers with a *stale page*
 * error (403, code 7) when the `x-statsig-id` header is not current, and with
 * "Bad credentials" (401) when the request never reached the session. Neither
 * means the sso cookie is wrong, so they must not be reported as such.
 */
export function isGrokAntiBotResponse(status, bodyText) {
  if (status !== 401 && status !== 403) return false;
  const text = String(bodyText || "").toLowerCase();
  return text.includes("out of date")
    || text.includes("bad credentials")
    || text.includes('"code":7')
    || text.includes('"code":16');
}

export const GROK_ANTI_BOT_MESSAGE = "grok.com blocked the request with its anti-bot check (x-statsig-id) — the SSO cookie is fine; retry from a fresh grok.com browser session";

export { GROK_CHAT_API, GROK_SESSION_API, GROK_USER_AGENT };
