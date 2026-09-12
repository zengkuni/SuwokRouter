import "../../open-sse-index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { extractCacheKey } from "../../services/accountFallback.js";
import { getSettings, getProviderConnectionById } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "../../handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "../../utils/error.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "../../services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "../../services/capacityAdapter.js";
import { handleBypassRequest } from "../../utils/bypassHandler.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { detectFormatByEndpoint } from "../../translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "../../services/projectId.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { isCallerCancellation } from "../services/requestCancellation.js";
import { env } from "@/lib/env";

const INTERNAL_CLI_TOKEN_HEADER = "x-swayrouter-cli-token";
const INTERNAL_CONNECTION_HEADER = "x-swayrouter-connection-id";
const INTERNAL_CLI_TOKEN_SALT = "swayrouter-cli-auth";

function attachAccountLease(response, release) {
  if (!response || typeof release !== "function") return response;

  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  const contentType = response.headers?.get("content-type") || "";
  if (!response.body || !contentType.toLowerCase().includes("text/event-stream")) {
    releaseOnce();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          releaseOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        releaseOnce();
        try { controller.error(error); } catch {                         }
      }
    },
    cancel(reason) {
      releaseOnce();
      return reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

async function getPreferredConnectionId(request) {
  const connectionId = request?.headers?.get(INTERNAL_CONNECTION_HEADER) || "";
  if (!connectionId || !/^[a-zA-Z0-9_-]{8,128}$/.test(connectionId)) return null;

  const presentedToken = request.headers.get(INTERNAL_CLI_TOKEN_HEADER) || "";
  if (!presentedToken) return null;
  try {
    const expectedToken = await getConsistentMachineId(INTERNAL_CLI_TOKEN_SALT);
    if (!expectedToken || presentedToken !== expectedToken) return null;
    const connection = await getProviderConnectionById(connectionId);
    return connection?.isActive === true ? connectionId : null;
  } catch {
    return null;
  }
}

function validateChatBody(body, pathname) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }
  if (typeof body.model !== "string" || !body.model.trim()) {
    return "Missing model";
  }

  const path = String(pathname || "").replace(/\/$/, "");
  const requiresMessages = path.endsWith("/chat/completions") || path.endsWith("/messages");
  if (requiresMessages && !Array.isArray(body.messages)) {
    return "messages must be a non-empty array";
  }
  if (Array.isArray(body.messages)) {
    if (body.messages.length === 0 && requiresMessages) return "messages must be a non-empty array";
    for (const message of body.messages) {
      if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.role !== "string" || !message.role.trim()) {
        return "Each message must be an object with a non-empty role";
      }
    }
  }
  return null;
}

export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const validationError = validateChatBody(body, new URL(request.url).pathname);
  if (validationError) {
    log.warn("CHAT", validationError);
    return errorResponse(HTTP_STATUS.BAD_REQUEST, validationError);
  }

  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  const modelStr = body.model.trim();
  body.model = modelStr;
  const preferredConnectionId = await getPreferredConnectionId(request);
  const isTrustedInternalRequest = Boolean(preferredConnectionId);

  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  const settings = await getSettings();

  if (settings.requireApiKey || env.nodeEnv === "production") {
    if (!isTrustedInternalRequest && !apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    if (!isTrustedInternalRequest && !(await isValidApiKey(apiKey))) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  const comboModels = await getComboModels(modelStr);
  if (comboModels) {

    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel, panelSignal) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, preferredConnectionId, isPanel ? panelSignal : request?.signal);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
        signal: request?.signal,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, preferredConnectionId, request?.signal),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  const soloAugmented = augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, preferredConnectionId, request?.signal),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, preferredConnectionId, request?.signal);
}

async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, preferredConnectionId = null, requestSignal = null) {
  requestSignal ||= request?.signal || null;
  if (requestSignal?.aborted) return errorResponse(499, "Request aborted");
  const incomingClient = clientRawRequest?.headers
    ? Object.fromEntries(clientRawRequest.headers.entries?.() || [])
    : {};
  const settings = await getSettings();
  const { resolveCliModelMapping } = await import("../../services/cliModelMapping.js");
  const { detectClient } = await import("../../utils/clientDetector.js");
  const clientMeta = detectClient(incomingClient, body, { path: clientRawRequest?.endpoint || "" });
  const mappedModelStr = resolveCliModelMapping(clientMeta.id, modelStr, settings.cliModelMappings);
  const modelInfo = await getModelInfo(mappedModelStr);

  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();

      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel, panelSignal) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, preferredConnectionId, isPanel ? panelSignal : request?.signal);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
          signal: request?.signal,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, preferredConnectionId, request?.signal),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  const userAgent = request?.headers?.get("user-agent") || "";

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  const cacheKey = extractCacheKey(body);
  let retryCount = 0;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
      cacheKey,
      preferredConnectionId,
      signal: requestSignal,
    });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        const retryMessage = "All provider accounts are temporarily unavailable";
        log.warn("CHAT", `[${provider}/${model}] ${lastError || credentials.lastError || "Unavailable"} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, retryMessage, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, "No active credentials available");
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, "All provider accounts are unavailable");
    }

    if (credentials.allBusy) {
      if (credentials.reason === "aborted" || requestSignal?.aborted) {
        return errorResponse(499, "Request aborted");
      }
      return unavailableResponse(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        "Provider account pool is busy",
        credentials.retryAfter,
        credentials.retryAfterHuman || "retry shortly",
      );
    }

    const releaseAccountSlot = credentials.releaseAccountSlot;
    let result;
    try {
      const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

      if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
        const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
        if (pid) {
          refreshedCredentials.projectId = pid;

          updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
        }
      }

      const chatSettings = await getSettings();
      const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
      result = await handleChatCore({
        body: { ...body, model: `${provider}/${model}` },
        modelInfo: { provider, model, modelCapabilities: modelInfo.modelCapabilities },
        credentials: refreshedCredentials,
        log,
        clientRawRequest,
        connectionId: credentials.connectionId,
        userAgent,
        apiKey,
        ccFilterNaming: !!chatSettings.ccFilterNaming,
        rtkEnabled: !!chatSettings.rtkEnabled,
        cavemanEnabled: !!chatSettings.cavemanEnabled,
        cavemanLevel: chatSettings.cavemanLevel || "full",
        ponytailEnabled: !!chatSettings.ponytailEnabled,
        ponytailLevel: chatSettings.ponytailLevel || "full",
        providerThinking,
        requestSignal,

        sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
        onCredentialsRefreshed: async (newCreds) => {
          await updateProviderCredentials(credentials.connectionId, {
            ...newCreds,
            existingProviderSpecificData: credentials.providerSpecificData,
            testStatus: "active"
          });
        },
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model);
        }
      });
    } catch (error) {

      releaseAccountSlot?.();
      throw error;
    }

    if (result.success) return attachAccountLease(result.response, releaseAccountSlot);

    releaseAccountSlot?.();

    if (isCallerCancellation({ requestSignal, status: result.status })) {
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs, { retryCount });

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      retryCount += 1;
      continue;
    }

    return result.response;
  }
}
