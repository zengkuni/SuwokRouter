import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { applyThinking, extractThinking, stripThinkingSuffix } from "../translator/concerns/thinkingUnified.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, TOKEN_SAVER_HEADER } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { supportsGrokCliReasoningEffort } from "../config/grokCli.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { detectClientTool, detectClient, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { classifyUnsupportedParameter } from "../utils/error.js";
import { stripKnownRejected, applyRejectedParam, rememberRejectedParam } from "../translator/concerns/compatFallback.js";
import { compatFallbackStripsTotal } from "../observability/metrics.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { previewSSEPrefix, isAuthError } from "../sse/recovery.js";
import { forceRefreshOAuth } from "../sse/oauthLease.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { normalizeTranslationRequest, resolveTranslationSurface, unsupportedFeatures } from "../translator/canonical.js";

export function stripContinuityFields(body) {
  if (!body || !Array.isArray(body.messages)) return body;
  for (const msg of body.messages) {
    if (msg && typeof msg === "object") {
      delete msg.encrypted_content;
      delete msg.reasoning_encrypted_content;
    }
  }
  return body;
}

export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, sourceFormatOverride, providerThinking, requestSignal }) {
  const { provider, model, modelCapabilities } = modelInfo;
  const requestStartTime = Date.now();
  let failureRecorded = false;
  let streamCompleted = false;
  const recordFailure = (message, statusCode = HTTP_STATUS.BAD_GATEWAY) => {

    if (failureRecorded || streamCompleted) return statusCode;
    failureRecorded = true;
    saveUsageStats({
      provider, model, connectionId, apiKey,
      tokens: {}, endpoint: clientRawRequest?.endpoint,
      latencyMs: Date.now() - requestStartTime,
      status: "error", error: message, silent: true, allowEmpty: true,
    });
    return statusCode;
  };

  let reportStreamFailure = recordFailure;

  const sessionSeed = (() => {
    try {
      return resolveSessionId({ headers: clientRawRequest?.headers, body, connectionId, scope: provider });
    } catch {
      return connectionId || "";
    }
  })();
  const reqTag = log?.tagForSession ? log.tagForSession(sessionSeed) : (log?.nextTag ? log.nextTag() : "");

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);

  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const targetFormat = modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider, credentials);
  if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport;

  const canonicalRequest = normalizeTranslationRequest({
    body,
    sourceFormat,
    model,
    provider,
    headers: clientRawRequest?.headers || {},
    path: clientRawRequest?.endpoint || "",
  });
  const canonicalSurface = resolveTranslationSurface({
    provider,
    model,
    clientFormat: canonicalRequest.clientFormat,
    targetFormat,
    capabilityOverride: modelCapabilities,
  });
  const unsupportedOptionalFeatures = unsupportedFeatures(
    canonicalRequest.features,
    canonicalSurface.capabilities,
  );
  if (unsupportedOptionalFeatures.length > 0) {
    log?.debug?.(
      "TRANSLATION",
      `optional feature gaps: ${unsupportedOptionalFeatures.join(", ")} · ${provider}/${model}`,
    );
  } else {
    log?.debug?.("TRANSLATION", `${sourceFormat} → ${canonicalSurface.wireFormat} · capabilities ok`);
  }
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);

  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  const _rawHeaders = clientRawRequest?.headers || {};
  const clientMeta = detectClient(_rawHeaders, body, { path: clientRawRequest?.endpoint || "" });
  const clientTool = clientMeta.id;
  const passthrough = isNativePassthrough(clientTool, provider);
  if (clientMeta.conflicts.length > 0 && log?.debug) {
    log.debug(
      "CLIENT",
      `resolved=${clientMeta.id || "?"} · confidence=${clientMeta.confidence} · signals=${clientMeta.signals} · conflicts=[${clientMeta.conflicts.join(", ")}]`,
    );
  }

  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model, modelCapabilities);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
    }

    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: requestSignal });
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  let translatedBody;
  let toolNameMap;
  let customToolNames;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: stripThinkingSuffix(upstreamModel) };
    if (provider !== "codex" && (targetFormat === FORMATS.OPENAI || targetFormat === FORMATS.CLAUDE)) {
      applyThinking(targetFormat, upstreamModel, translatedBody, provider, undefined, modelCapabilities);
    }
    if (provider === "codex") {
      const suffixThinking = {};
      applyThinking(sourceFormat, upstreamModel, suffixThinking, provider, undefined, modelCapabilities);
      if (suffixThinking.reasoning_effort) {
        const reasoning = translatedBody.reasoning;
        translatedBody.reasoning = {
          ...(reasoning && typeof reasoning === "object" && !Array.isArray(reasoning) ? reasoning : {}),
          effort: suffixThinking.reasoning_effort,
        };
        delete translatedBody.reasoning_effort;
      }
    }

    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model);
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, upstreamModel, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool, modelCapabilities);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      recordFailure(`Failed to translate request for ${sourceFormat} → ${targetFormat}`, HTTP_STATUS.BAD_REQUEST);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    customToolNames = translatedBody._customToolNames;
    delete translatedBody._customToolNames;
    translatedBody.model = stripThinkingSuffix(upstreamModel);
    stripContinuityFields(translatedBody);
  }

  let strippedTrace = [];
  if (!passthrough) {
    const pre = stripKnownRejected(translatedBody, provider, model);
    if (pre.length > 0) {
      strippedTrace.push(...pre);
      if (log?.debug) log.debug("A4.4", `pre-stripped (cached) ${pre.length}: ${pre.join(", ")}`);
      for (const p of pre) compatFallbackStripsTotal.inc({ provider, model: model, action: "pre-strip" });
    }
  }

  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  const finalFormat = passthrough ? sourceFormat : targetFormat;

  if (log?.line) {
    const clientModel = clientRawRequest?.body?.model || `${provider}/${model}`;
    const msgN = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || body.messages?.length || body.input?.length || 0;
    const toolN = translatedBody.tools?.length || body.tools?.length || 0;
    const fmtStr = passthrough ? `FMT: ${sourceFormat} (passthrough)` : `FMT: ${sourceFormat}→${targetFormat}`;
    const showThinking = provider !== "grok-cli" || supportsGrokCliReasoningEffort(model);
    const think = showThinking ? log.fmtThink?.(extractThinking(translatedBody)) : null;
    const acc = credentials?.connectionName || credentials?.connectionId?.slice(0, 8) || "-";
    const parts = [
      `POST ${clientModel} → ${provider}/${model}`,
      fmtStr,
      stream ? "STREAM" : "JSON",
      `${msgN} MSG`,
    ];
    if (toolN) parts.push(`${toolN} TOOL`);
    if (think) parts.push(`THINK:${think}`);
    parts.push(`ACC:${acc}`);
    log.line(reqTag, "START", parts.join(" · "));
  }

  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  const rawHeaders = clientRawRequest?.headers || {};
  const tokenSaverOpt = rawHeaders[TOKEN_SAVER_HEADER];
  const tokenSaverEnabled = tokenSaverOpt?.toLowerCase() !== "off";

  const rtkStats = compressMessages(translatedBody, tokenSaverEnabled && rtkEnabled);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  const xf = [];

  if (tokenSaverEnabled && cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    xf.push(`CAVEMAN:${cavemanLevel}`);
  }

  if (tokenSaverEnabled && ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    xf.push(`PONYTAIL:${ponytailLevel}`);
  }

  if (xf.length && log?.line) log.line(reqTag, "DEBUG", `TRANSFORM · ${xf.join(" · ")}`);

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    strictProxy: credentials?.providerSpecificData?.strictProxy === true,
    proxyPoolUnavailable: credentials?.providerSpecificData?.proxyPoolUnavailable === true,
    proxyPoolError: credentials?.providerSpecificData?.proxyPoolError || "",
    relayUrl: credentials?.providerSpecificData?.relayUrl || "",
    relayToken: credentials?.providerSpecificData?.relayToken || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  const streamController = createStreamController({
    callerSignal: requestSignal,
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      const detail = typeof reason === "string" ? reason : reason?.reason || "client_closed";
      reportStreamFailure(`Client disconnected: ${detail}`, 499);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: (error) => {
      trackPendingRequest(model, provider, connectionId, false);
      const isAbort = error?.name === "AbortError" && requestSignal?.aborted;
      reportStreamFailure(isAbort ? "Request aborted" : error?.message || "Streaming request failed", isAbort ? 499 : HTTP_STATUS.BAD_GATEWAY);
    },
    log, provider, model, reqTag
  });

  const executor = getExecutor(provider);
  const executeOptions = {
    model, body: translatedBody, stream, credentials,
    signal: streamController.signal, log, proxyOptions,
    requestTag: reqTag,
    attemptReason: "initial",
  };
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  if (proxyOptions.relayUrl || proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | relay=${proxyOptions.relayUrl || proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {

    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  let providerResponse, providerUrl, providerHeaders, finalBody;

  let providerResponseFormat = targetFormat;
  try {
    const result = await executor.execute(executeOptions);
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    providerResponseFormat = result.responseFormat || targetFormat;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const failedStatus = recordFailure(error.message || String(error), error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      status: "error",
      client: { id: clientMeta.id, confidence: clientMeta.confidence, signals: clientMeta.signals, conflicts: clientMeta.conflicts }
    }), clientRawRequest).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    if (log?.errorLine) {
      log.errorLine(reqTag, "ERROR", `ERROR 502 · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${error.stack ? `\n    ${error.stack}` : ""}`);
    }
    return createErrorResult(failedStatus, errMsg);
  }

  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    try {

      const newCredentials = await refreshWithRetry(async () => {
        const result = await executor.refreshCredentials(credentials, log, proxyOptions);
        if (result?.refreshToken && result.refreshToken !== credentials.refreshToken) {
          if (result.accessToken) credentials.accessToken = result.accessToken;
          credentials.refreshToken = result.refreshToken;
        }
        return result;
      }, 3, log, requestSignal);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        if (log?.line) log.line(reqTag, "RETRY", `TOKEN REFRESHED · ${provider}/${model}`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          const retryResult = await executor.execute({ ...executeOptions, attemptReason: "oauth-refresh" });
          if (retryResult.response.ok) {
            providerResponse = retryResult.response;
            providerUrl = retryResult.url;
            providerResponseFormat = retryResult.responseFormat || targetFormat;
          }
        } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  if (!providerResponse.ok) {

    if (providerResponse.status === 400 || providerResponse.status === 422) {
      let upstreamErrText = "";
      try { upstreamErrText = await providerResponse.clone().text(); } catch { upstreamErrText = ""; }
      const rejectedField = classifyUnsupportedParameter(upstreamErrText, { status: providerResponse.status });
      if (rejectedField && passthrough === false && strippedTrace.length < 3) {
        let retryBody = finalBody || translatedBody || null;
        try {
          if (!retryBody || typeof retryBody !== "object") retryBody = JSON.parse(JSON.stringify(translatedBody || {}));
          else retryBody = JSON.parse(JSON.stringify(retryBody));
        } catch { retryBody = { ...translatedBody }; }

        const apply = applyRejectedParam(retryBody, provider, model, rejectedField);
        if (apply.retryable && apply.removed) {
          strippedTrace.push(rejectedField);
          compatFallbackStripsTotal.inc({ provider, model: model, action: "retry" });
          if (log?.line) log.line(reqTag, "RETRY", `A4.4 · without "${rejectedField}" · ${provider}/${model}`);
          try {
            const retryResp = await executor.execute({ ...executeOptions, body: retryBody, attemptReason: "compat-strip" });
            if (retryResp?.response?.ok) {

              providerResponse = retryResp.response;
              providerUrl = retryResp.url;
              providerHeaders = retryResp.headers;
              finalBody = retryResp.transformedBody ?? retryBody;
              providerResponseFormat = retryResp.responseFormat || targetFormat;
              reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
            }
          } catch (e) {
            if (log?.warn) log.warn("A4.4", `retry after strip "${rejectedField}" threw: ${e?.message || e}`);
          }
        } else if (apply.retryable && !apply.removed) {

          compatFallbackStripsTotal.inc({ provider, model: model, action: "miss-cache" });
          rememberRejectedParam(provider, model, rejectedField);
        }
      }
    }

    if (!providerResponse.ok) {
      trackPendingRequest(model, provider, connectionId, false, true);
      const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
      recordFailure(message, statusCode);
      appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
      saveRequestDetail(buildRequestDetail({
        provider, model, connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        response: { error: message, status: statusCode, thinking: null },
        status: "error",
        client: { id: clientMeta.id, confidence: clientMeta.confidence, signals: clientMeta.signals, conflicts: clientMeta.conflicts },
        strippedParams: strippedTrace.length ? strippedTrace : undefined,
        translation: { sourceFormat, targetFormat, wireFormat: canonicalSurface.wireFormat, features: canonicalRequest.features, unsupportedOptionalFeatures },
      }), clientRawRequest).catch(() => { });

      const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
      if (log?.errorLine) {
        const urlStr = providerUrl ? `\n    URL: ${providerUrl}` : "";
        log.errorLine(reqTag, "ERROR", `ERROR ${statusCode} · ${provider}/${model} · ${Date.now() - requestStartTime}ms${urlStr}\n    ${errMsg}`);
      }
      reqLogger.logError(new Error(message), finalBody || translatedBody);
      return createErrorResult(statusCode, errMsg, resetsAtMs);
    }
  }

  const providerContentType = providerResponse.headers?.get?.("content-type") || "";
  const providerLooksLikeSSE = providerContentType.toLowerCase().includes("text/event-stream")
    || (!providerContentType && providerResponseFormat === FORMATS.OPENAI_RESPONSES);
  if (stream && providerResponse.ok && providerLooksLikeSSE) {
    let preview;
    try {
      preview = await previewSSEPrefix(providerResponse, providerResponseFormat, {
        signal: requestSignal,
        maxEvents: 8,
        maxBytes: 16 * 1024,
        deadlineMs: 20000,
        log,
        reqTag,
      });
    } catch (e) {
      log?.warn?.("A4.3", `preview failed (non-fatal): ${e?.message || e}`);
      preview = null;
    }

    if (preview && preview.kind === "callerAbort") {
      recordFailure("Request aborted", 499);
      return createErrorResult(499, "Request aborted");
    }

    if (preview && preview.kind === "networkError" && !preview.committed) {
      if (requestSignal?.aborted) {
        recordFailure("Request aborted", 499);
        return createErrorResult(499, "Request aborted");
      }
      log?.line?.(reqTag, "RETRY", `A4.3 pre-content socket close · ${provider}/${model}`);
      try {
        const retryResp = await executor.execute({
          ...executeOptions,
          attemptReason: "stream-preview-network",
        });
        if (retryResp?.response?.ok) {
          providerResponse = retryResp.response;
          providerUrl = retryResp.url;
          providerHeaders = retryResp.headers;
          providerResponseFormat = retryResp.responseFormat || targetFormat;
          finalBody = retryResp.transformedBody;
          reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
          log?.debug?.("A4.3", `socket retry succeeded · ${provider}/${model}`);
        } else {
          const { statusCode, message } = await parseUpstreamError(
            retryResp?.response,
            executor,
          );
          recordFailure(message, statusCode || HTTP_STATUS.BAD_GATEWAY);
          return createErrorResult(
            statusCode || HTTP_STATUS.BAD_GATEWAY,
            formatProviderError(new Error(message), provider, model, statusCode || HTTP_STATUS.BAD_GATEWAY),
          );
        }
      } catch (error) {
        if (requestSignal?.aborted || error?.name === "AbortError") {
          recordFailure("Request aborted", 499);
          return createErrorResult(499, "Request aborted");
        }
        recordFailure(error?.message || String(error), HTTP_STATUS.BAD_GATEWAY);
        return createErrorResult(
          HTTP_STATUS.BAD_GATEWAY,
          formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY),
        );
      }
    }

    if (preview && preview.kind === "error" && !preview.committed) {

      const isAuth = preview.isAuthError;
      log?.line?.(reqTag, "RETRY", `A4.3 pre-content ${isAuth ? "auth-" : ""}error · ${provider}/${model}`);

      if (isAuth && !executor.noAuth && !requestSignal?.aborted) {
        try {
          const refreshed = await forceRefreshOAuth(provider, credentials, log, { signal: requestSignal, proxyOptions });
          if (refreshed?.accessToken) {
            Object.assign(credentials, refreshed);
            if (onCredentialsRefreshed) {
              try { await onCredentialsRefreshed(refreshed); } catch (e2) { log?.warn?.("A4.3", `onCredentialsRefreshed: ${e2.message}`); }
            }
            if (log?.line) log.line(reqTag, "RETRY", `A4.3 reactive refresh · ${provider}/${model}`);
          }
        } catch (e) {
          log?.warn?.("A4.3", `refresh failed: ${e?.message || e}`);
        }
      }

      try {
        if (requestSignal?.aborted) {
          recordFailure("Request aborted", 499);
          return createErrorResult(499, "Request aborted");
        }
        const retryResp = await executor.execute({
          ...executeOptions,
          attemptReason: "stream-preview",
        });
        if (retryResp?.response?.ok) {
          providerResponse = retryResp.response;
          providerUrl = retryResp.url;
          providerHeaders = retryResp.headers;
          providerResponseFormat = retryResp.responseFormat || targetFormat;
          finalBody = retryResp.transformedBody;
          reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
          log?.debug?.("A4.3", `retry succeeded · ${provider}/${model}`);
        } else {
          log?.debug?.("A4.3", `retry also failed (${retryResp?.response?.status}) — propagating original error`);

          if (!retryResp?.response?.ok) {
            const { statusCode, message } = await parseUpstreamError(retryResp.response, executor);
            const errMsg2 = formatProviderError(new Error(message), provider, model, statusCode);
            if (log?.errorLine) log.errorLine(reqTag, "ERROR", `A4.3 retry ERROR ${statusCode} · ${provider}/${model}\n    ${errMsg2}`);
            recordFailure(message, statusCode);
            return createErrorResult(statusCode, errMsg2);
          }
        }
      } catch (e) {
        log?.warn?.("A4.3", `retry threw: ${e?.message || e}`);

        recordFailure(e?.message || String(e), HTTP_STATUS.BAD_GATEWAY);
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, formatProviderError(e, provider, model, HTTP_STATUS.BAD_GATEWAY));
      }
    } else if (preview && (preview.kind === "committed" || preview.kind === "timeout" || preview.kind === "streamClosed")) {

      providerResponse = preview.splicedResponse;
    }
  }

  const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqTag, log, client: { id: clientMeta.id, confidence: clientMeta.confidence, signals: clientMeta.signals, conflicts: clientMeta.conflicts }, strippedParams: strippedTrace.length ? strippedTrace : undefined };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => { });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, customToolNames, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }

    if (!providerLooksLikeSSE) {
      const result = await handleNonStreamingResponse({ ...sharedCtx, stream: false, providerResponse, sourceFormat, targetFormat: providerResponseFormat, reqLogger, toolNameMap, customToolNames, trackDone, appendLog });
      streamController.handleComplete();
      return result;
    }
  }

  if (!stream) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, reqLogger, toolNameMap, customToolNames, trackDone, appendLog });
    streamController.handleComplete();
    return result;
  }

  const { onStreamComplete, onStreamFailure, streamDetailId } = buildOnStreamComplete({
    ...sharedCtx,
    onStreamFailure: recordFailure,
    onStreamCompleted: () => { streamCompleted = true; },
  });
  reportStreamFailure = (message, statusCode) => {
    const code = recordFailure(message, statusCode);
    onStreamFailure?.(message, statusCode);
    return code;
  };
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, userAgent, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, onStreamFailure: reportStreamFailure });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
