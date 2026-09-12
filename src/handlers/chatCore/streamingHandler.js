import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { saveRequestDetail } from "@/lib/usageDb.js";

const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};

export async function coerceOpenAIJsonToSSE(providerResponse, model, provider = null) {
  const contentType = providerResponse.headers?.get?.("content-type") || "";
  const lowerContentType = contentType.toLowerCase();
  const isJson = lowerContentType.includes("application/json");
  const isSingleShotSSE = lowerContentType.includes("text/event-stream");
  if (!isJson && !isSingleShotSSE) return providerResponse;

  let responseBody = null;
  try {
    if (isJson) {
      responseBody = await providerResponse.json();
    } else {
      const raw = await providerResponse.text();

      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:") || trimmed.slice(5).trim() === "[DONE]") continue;
        try {
          const parsed = JSON.parse(trimmed.slice(5).trim());
          if (parsed?.choices?.[0]?.message && !parsed?.choices?.[0]?.delta) {
            responseBody = parsed;
            break;
          }
        } catch {

        }
      }
      if (!responseBody) {
        return new Response(raw, {
          status: providerResponse.status,
          statusText: providerResponse.statusText,
          headers: new Headers(providerResponse.headers),
        });
      }
    }
  } catch {
    return providerResponse;
  }

  const choice = responseBody?.choices?.[0] || {};
  const message = choice.message || {};
  const delta = { role: message.role || "assistant" };
  if (typeof message.content === "string" && message.content.length > 0) delta.content = message.content;
  if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) delta.reasoning_content = message.reasoning_content;
  if (typeof message.refusal === "string" && message.refusal.length > 0) delta.refusal = message.refusal;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) delta.tool_calls = message.tool_calls;

  const base = {
    id: responseBody?.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: responseBody?.created || Math.floor(Date.now() / 1000),
    model: responseBody?.model || model || "unknown",
  };
  const chunks = [];
  if (Object.keys(delta).length > 0) {
    chunks.push({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
  }
  const finalChunk = {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || "stop" }],
  };
  if (responseBody?.usage && typeof responseBody.usage === "object") finalChunk.usage = responseBody.usage;
  chunks.push(finalChunk);

  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: providerResponse.status,
    statusText: providerResponse.statusText,
    headers: SSE_HEADERS,
  });
}

function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");

  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey);
}

export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, onStreamFailure, reqTag, log, client, strippedParams }) {
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  if (targetFormat === FORMATS.OPENAI) {
    providerResponse = await coerceOpenAIJsonToSSE(providerResponse, model, provider);
  }

  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);

    const status = providerResponse.status >= 400 ? providerResponse.status : 502;
    if (onStreamFailure) {
      onStreamFailure(`upstream non-SSE: ${status}`, status);
    } else {
      saveUsageStats({
        provider, model, connectionId, apiKey,
        tokens: {}, endpoint: clientRawRequest?.endpoint,
        latencyMs: Date.now() - requestStartTime,
        status: "error", error: `upstream non-SSE: ${status}`, silent: true, allowEmpty: true,
      });
    }
    if (log?.errorLine) log.errorLine(reqTag, "ERROR", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey });

  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs);

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    status: "success"
  }, { id: streamDetailId, client, strippedParams }), clientRawRequest).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, reqTag, log, client, strippedParams, onStreamCompleted, onStreamFailure: reportFailure }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const saveStreamFailureDetail = (message, statusCode = 502) => {
    const code = Number.isFinite(Number(statusCode)) ? Number(statusCode) : 502;
    const status = code === 499 ? "client_closed" : `provider_${code}`;
  saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: null,
      response: { content: String(message || "Streaming request failed").slice(0, 500), thinking: null, type: "error" },
      status,
    }, { id: streamDetailId, client, strippedParams }), clientRawRequest).catch(err => {
      console.error("[RequestDetail] Failed to save streaming error:", err.message);
    });
    return code;
  };

  const onStreamFailure = (message, statusCode = 502) => {
    saveStreamFailureDetail(message, statusCode);
    return statusCode;
  };

  const onStreamComplete = (contentObj, usage, ttftAt, terminalSeen = true) => {
    const hasDeliveredContent = Boolean(
      (typeof contentObj?.content === "string" && contentObj.content.trim())
      || (typeof contentObj?.thinking === "string" && contentObj.thinking.trim())
    );
    if (terminalSeen === false && !hasDeliveredContent) {
      const message = "Upstream stream ended before a terminal event";

      if (reportFailure) {
        reportFailure(message, 502);
        onStreamFailure(message, 502);
      } else onStreamFailure(message, 502);
      return;
    }
    if (terminalSeen === false) {

      log?.warn?.("STREAM", `${provider}/${model} ended without terminal marker after delivering content`);
    }
    onStreamCompleted?.();
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      status: "success"
    }, { id: streamDetailId, client, strippedParams }), clientRawRequest).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    saveUsageStats({ provider, model, tokens: usage || {}, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, latencyMs: latency.total, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "DONE", formatDoneLine({ usage, latency }));
  };

  return { onStreamComplete, onStreamFailure, streamDetailId };
}
