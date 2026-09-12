import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { v4 as uuidv4 } from "uuid";
import { applyKiroSessionReplay } from "../../utils/kiroSessionReplay.js";
import { resolveContinuationId, resolveSessionIdentity } from "../../utils/sessionManager.js";
import {
  resolveKiroModelIntent,
  applyKiroThinkingOverride,
  resolveDefaultProfileArn,
  buildKiroAdditionalModelRequestFieldsForModel
} from "../../config/kiroConstants.js";
import { parseDataUri } from "../concerns/image.js";
import { DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import {
  canonicalizeKiroConversation,
  normalizeKiroToolSpecs,
} from "../concerns/kiroConversation.js";

function safeJSONParse(str, fallback) {
  if (typeof str !== "string") return str ?? fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function convertMessages(messages, model) {
  let history = [];
  let currentMessage = null;
  const systemParts = [];

  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let currentRole = null;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n");
      const userMsg = {
        userInputMessage: {
          content: content,
          modelId: ""
        }
      };

      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = pendingImages;
      }

      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: pendingToolResults
        };
      }

      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
    } else if (currentRole === "assistant") {
      const content = pendingAssistantContent.join("\n\n");
      const assistantMsg = {
        assistantResponseMessage: {
          content: content
        }
      };
      history.push(assistantMsg);
      pendingAssistantContent = [];
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let role = msg.role;

    if (role === ROLE.SYSTEM || role === ROLE.DEVELOPER) {
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((part) => part?.text || "").filter(Boolean).join("\n")
          : "";
      if (content) systemParts.push(content);
      continue;
    }

    if (role === ROLE.TOOL) {
      role = ROLE.USER;
    }

    if (role !== currentRole && currentRole !== null) {
      flushPending();
    }
    currentRole = role;

    if (role === ROLE.USER) {

      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts = [];
        for (const c of msg.content) {
          if (c.type === OPENAI_BLOCK.TEXT || c.text) {
            textParts.push(c.text || "");
          } else if (c.type === OPENAI_BLOCK.IMAGE_URL) {

            const url = c.image_url?.url || "";
            const parsed = parseDataUri(url);
            if (parsed) {
              const format = parsed.mimeType.split("/")[1] || parsed.mimeType;
              pendingImages.push({ format, source: { bytes: parsed.base64 } });
            } else if (url.startsWith("http://") || url.startsWith("https://")) {

              textParts.push(`[Image: ${url}]`);
            }
          } else if (c.type === CLAUDE_BLOCK.IMAGE) {

            if (c.source?.type === "base64" && c.source?.data) {
              const mediaType = c.source.media_type || DEFAULT_IMAGE_MIME;
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: c.source.data } });
            }
          }
        }
        content = textParts.join("\n");

        const toolResultBlocks = msg.content.filter(c => c.type === CLAUDE_BLOCK.TOOL_RESULT);
        if (toolResultBlocks.length > 0) {
          toolResultBlocks.forEach(block => {
            const text = Array.isArray(block.content)
              ? block.content.map(c => c.text || "").join("\n")
              : (typeof block.content === "string" ? block.content : "");

            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: block.is_error ? "error" : "success",
              content: [{ text: text }]
            });
          });
        }
      }

      if (msg.role === ROLE.TOOL) {
        const toolContent = typeof msg.content === "string" ? msg.content : "";
        pendingToolResults.push({
          toolUseId: msg.tool_call_id,
          status: msg.is_error || msg.status === "error" ? "error" : "success",
          content: [{ text: toolContent }]
        });
      } else if (content) {
        pendingUserContent.push(content);
      }
    } else if (role === ROLE.ASSISTANT) {

      let textContent = "";
      let toolUses = [];

      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter(c => c.type === OPENAI_BLOCK.TEXT);
        textContent = textBlocks.map(b => b.text).join("\n").trim();

        const toolUseBlocks = msg.content.filter(c => c.type === CLAUDE_BLOCK.TOOL_USE);
        toolUses = toolUseBlocks;
      } else if (typeof msg.content === "string") {
        textContent = msg.content.trim();
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolUses = msg.tool_calls;
      }

      if (textContent) {
        pendingAssistantContent.push(textContent);
      }

      if (toolUses.length > 0) {

        flushPending();

        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map(tc => {
            if (tc.function) {
              return {
                toolUseId: tc.id || uuidv4(),
                name: tc.function.name,
                input: safeJSONParse(tc.function.arguments, {})
              };
            } else {
              return {
                toolUseId: tc.id || uuidv4(),
                name: tc.name,
                input: tc.input || {}
              };
            }
          });
        }

        currentRole = null;
      }
    }
  }

  if (currentRole !== null) {
    flushPending();
  }

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  history.forEach(item => {
    if (item.userInputMessage?.userInputMessageContext &&
        Object.keys(item.userInputMessage.userInputMessageContext).length === 0) {
      delete item.userInputMessage.userInputMessageContext;
    }
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  });

  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;

      const prevCtx = prev.userInputMessage.userInputMessageContext;
      const curCtx = current.userInputMessage.userInputMessageContext;
      if (curCtx) {
        if (!prevCtx) {
          prev.userInputMessage.userInputMessageContext = curCtx;
        } else {
          if (curCtx.toolResults?.length > 0) {
            prevCtx.toolResults = [...(prevCtx.toolResults || []), ...curCtx.toolResults];
          }
          if (curCtx.tools?.length > 0) {
            prevCtx.tools = [...(prevCtx.tools || []), ...curCtx.tools];
          }
        }
      }
    } else {
      mergedHistory.push(current);
    }
  }

  if (!currentMessage) {
    currentMessage = {
      userInputMessage: {
        content: "",
        modelId: model,
      }
    };
  }

  return { history: mergedHistory, currentMessage, systemPrompt: systemParts.join("\n\n") };
}

export function openaiToKiroRequest(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const modelIntent = resolveKiroModelIntent(model);
  const { upstream: upstreamModel } = modelIntent;
  const thinkingBody = applyKiroThinkingOverride(body, modelIntent.thinkingOverride);
  const additionalModelRequestFields = buildKiroAdditionalModelRequestFieldsForModel(thinkingBody, upstreamModel);

  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage, systemPrompt } = convertMessages(messages, upstreamModel);

  const authMethod = credentials?.providerSpecificData?.authMethod;
  const accountBoundAuth =
    authMethod === "api_key" || authMethod === "idc" || authMethod === "external_idp";
  const profileArn = accountBoundAuth
    ? (credentials?.providerSpecificData?.profileArn || "")
    : (credentials?.providerSpecificData?.profileArn || resolveDefaultProfileArn(authMethod));

  const sessionIdentity = resolveSessionIdentity({ headers: credentials?.rawHeaders, body, connectionId: credentials?.connectionId, scope: "kiro" });
  const conversationId = sessionIdentity.sessionId;
  const continuationId = resolveContinuationId({
    sessionId: conversationId,
    connectionId: credentials?.connectionId,
    scope: "kiro",
    ephemeral: sessionIdentity.ephemeral,
  });
  const replay = applyKiroSessionReplay({
    conversationId,
    connectionId: credentials?.connectionId,
    modelId: upstreamModel,
    systemPrompt,
    history,
    currentMessage,
  });
  const canonical = canonicalizeKiroConversation({
    history: replay.history,
    currentMessage: replay.currentMessage,
    modelId: upstreamModel,
    toolSpecs,
    nameMap,
  });
  const replayCurrent = canonical.currentMessage.userInputMessage;

  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      agentContinuationId: continuationId,
      agentTaskType: "vibe",
      currentMessage: {
        userInputMessage: {
          content: replayCurrent.content || "",
          modelId: upstreamModel,
          origin: "AI_EDITOR",
          ...(replayCurrent.images?.length > 0 && {
            images: replayCurrent.images
          }),
          ...(replayCurrent.userInputMessageContext && {
            userInputMessageContext: replayCurrent.userInputMessageContext
          })
        }
      },
      history: canonical.history
    },
    agentMode: "vibe",
  };

  if (profileArn) {
    payload.profileArn = profileArn;
  }
  if (systemPrompt) payload.systemPrompt = systemPrompt;
  if (additionalModelRequestFields) {
    payload.additionalModelRequestFields = additionalModelRequestFields;
  }

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (maxTokens) payload.inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }

  Object.defineProperty(payload, "_kiroUpstreamModel", {
    value: upstreamModel,
    enumerable: false
  });

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, openaiToKiroRequest, null);
