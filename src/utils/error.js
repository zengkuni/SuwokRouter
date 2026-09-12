import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";

export function buildErrorBody(statusCode, message) {
  const errorInfo = ERROR_TYPES[statusCode] ||
    (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

export function errorResponse(statusCode, message) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export async function writeStreamError(writer, statusCode, message) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        return {
          statusCode: parsed.status || response.status,
          message: executor?.provider === "codebuddy-intl" && parsed.message
            ? parsed.message
            : DEFAULT_ERROR_MESSAGES[response.status] || "Upstream provider request failed",
          resetsAtMs: parsed.resetsAtMs,
        };
      }
    } catch {                                       }
  }

  return {
    statusCode: response.status,
    message: DEFAULT_ERROR_MESSAGES[response.status] || "Upstream provider request failed",
  };
}

export function classifyUnsupportedParameter(bodyText, ctx = {}) {
  if (bodyText == null) return null;

  if (ctx.status != null && ctx.status !== 400 && ctx.status !== 422) return null;
  const message = String(bodyText).toLowerCase();
  if (!message) return null;

  const m = message.match(
    /(?:unsupported parameter|parameter unsupported|unknown parameter|invalid parameter|unsupported field|unknown field|unrecognized (?:request argument|parameter))[:\s]+["'`]?([a-z][a-z0-9_.-]*)/i,
  );
  if (m?.[1] !== undefined) return _normalizeFieldPath(m[1]);

  const KNOWN = [
    "prompt_cache_options", "prompt_cache_breakpoint",
    "reasoning.max_tokens", "reasoning.effort", "reasoning",
    "reasoning_effort", "thinking",
    "output_config", "output_config.effort",
    "response_format", "parallel_tool_calls", "tool_choice", "stream_options",
  ];
  return KNOWN.find((field) => message.includes(field)) ?? null;
}

function _normalizeFieldPath(value) {
  return String(value).trim().toLowerCase().replace(/^["'`]|["'`]$/g, "");
}

export function createErrorResult(statusCode, message, resetsAtMs) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message)
  };
}

export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec)
      }
    }
  );
}

export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  if (code === 401 || code === 403) return DEFAULT_ERROR_MESSAGES[code] || "Authentication failed";
  if (code === 429) return DEFAULT_ERROR_MESSAGES[code] || "Rate limit exceeded";
  if (code >= 500) return DEFAULT_ERROR_MESSAGES[code] || "Upstream provider request failed";
  return DEFAULT_ERROR_MESSAGES[code] || "Provider request failed";
}
