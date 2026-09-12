import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";
import { adjustMaxTokens } from "./maxTokens.js";
import { isValidClaudeSignature } from "../../utils/claudeSignature.js";
import { PROVIDERS } from "../../providers/index.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig.js";

export function hasValidContent(msg) {
  if (typeof msg.content === "string" && msg.content.trim()) return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some(block =>
      (block.type === CLAUDE_BLOCK.TEXT && block.text?.trim()) ||
      block.type === CLAUDE_BLOCK.TOOL_USE ||
      block.type === CLAUDE_BLOCK.TOOL_RESULT ||
      block.type === CLAUDE_BLOCK.IMAGE ||
      block.type === CLAUDE_BLOCK.DOCUMENT
    );
  }
  return false;
}

export function fixToolUseOrdering(messages) {
  if (messages.length <= 1) return messages;

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      if (hasToolUse) {

        const newContent = [];
        let foundToolUse = false;

        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
            newContent.push(block);
          } else if (!foundToolUse) {

            newContent.push(block);
          }

        }

        msg.content = newContent;
      }
    }
  }

  const merged = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];

    if (last && last.role === msg.role) {

      const lastContent = Array.isArray(last.content) ? last.content : [{ type: CLAUDE_BLOCK.TEXT, text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];

      const toolResults = [...lastContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT)];
      const otherContent = [...lastContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT)];

      last.content = [...toolResults, ...otherContent];
    } else {

      const content = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }

  return merged;
}

const ADAPTIVE_THINKING_UNSUPPORTED = /haiku/i;

function handlesThinkingBlocks(provider) {
  return provider === "claude" || provider?.startsWith("anthropic-compatible") || provider === "deepseek";
}

function buildThinkingPlaceholder(provider) {
  const block = {
    type: CLAUDE_BLOCK.THINKING,
    thinking: ".",
  };

  if (provider !== "deepseek") {
    block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
  }

  return block;
}

export function normalizeClaudePassthrough(body, model = "") {
  if (!body || typeof body !== "object") return body;

  if (body.thinking?.type === "adaptive" && ADAPTIVE_THINKING_UNSUPPORTED.test(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  if (ADAPTIVE_THINKING_UNSUPPORTED.test(model) && body.output_config?.effort != null) {
    delete body.output_config.effort;
    if (Object.keys(body.output_config).length === 0) delete body.output_config;
  }

  if (Array.isArray(body.messages)) {
    const systemBlocks = [];
    const messages = [];
    for (const msg of body.messages) {
      if (msg.role === ROLE.SYSTEM) {
        const text = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map(b => (typeof b === "string" ? b : b?.text || "")).join("\n")
            : "";
        if (text.trim()) systemBlocks.push({ type: CLAUDE_BLOCK.TEXT, text });
        continue;
      }
      messages.push(msg);
    }

    if (systemBlocks.length > 0) {
      const existing = Array.isArray(body.system)
        ? body.system
        : typeof body.system === "string" && body.system.trim()
          ? [{ type: "text", text: body.system }]
          : [];
      body.system = [...existing, ...systemBlocks];
      body.messages = messages;
    }
  }

  const thinkingEnabled = body.thinking?.type === "enabled";
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== ROLE.ASSISTANT || !Array.isArray(msg.content)) continue;
      let hasToolUse = false;
      let hasKeptThinking = false;
      const kept = [];
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
          if (isValidClaudeSignature(block.signature)) {
            hasKeptThinking = true;
            kept.push(block);
          }
          continue;
        }
        if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
        kept.push(block);
      }
      msg.content = kept;
      if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
        msg.content.unshift(buildThinkingPlaceholder("claude"));
      }
    }
  }

  return body;
}

export function prepareClaudeRequest(body, provider = null, apiKey = null, connectionId = null, rawHeaders = null, sessionId = null) {

  if (PROVIDERS[provider]?.quirks?.dropOutputConfig) {
    delete body.output_config;
  }

  if (body.max_tokens) {
    const ceiling = getCapabilitiesForModel(provider, body.model).maxOutput || DEFAULT_MAX_TOKENS;
    if (body.max_tokens > ceiling) body.max_tokens = ceiling;

    if (body.thinking?.type === "enabled" && body.thinking.budget_tokens && body.thinking.budget_tokens >= body.max_tokens) {
      body.max_tokens = Math.min(body.thinking.budget_tokens + 1024, ceiling);
      if (body.thinking.budget_tokens >= body.max_tokens) {
        body.thinking.budget_tokens = Math.max(1024, body.max_tokens - 1024);
      }
    }
  }

  if (body.system && Array.isArray(body.system)) {
    body.system = body.system.map((block, i) => {
      const { cache_control, ...rest } = block;
      if (i === body.system.length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });
  }

  if (body.messages && Array.isArray(body.messages)) {
    const len = body.messages.length;
    let filtered = [];

    for (let i = 0; i < len; i++) {
      const msg = body.messages[i];

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }

      const isFinalAssistant = i === len - 1 && msg.role === "assistant";
      if (isFinalAssistant || hasValidContent(msg)) {
        filtered.push(msg);
      }
    }

    filtered = fixToolUseOrdering(filtered);

    body.messages = filtered;

    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === "user";
    const thinkingEnabled = body.thinking?.type === "enabled" && lastMessageIsUser;

    {
      const finalIdx = filtered.length - 1;
      for (let i = 0; i < filtered.length; i++) {
        const msg = filtered[i];
        const isFinal = i === finalIdx;
        if (msg.role === "assistant" && Array.isArray(msg.content) && msg.content.length > 0 && !isFinal) {
          for (let j = 0; j < msg.content.length; j++) {
            const block = msg.content[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          break;
        }
      }
    }

    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];

      if (msg.role === "assistant" && Array.isArray(msg.content)) {

        if (!lastAssistantProcessed && msg.content.length > 0) {
          for (let j = msg.content.length - 1; j >= 0; j--) {
            const block = msg.content[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          lastAssistantProcessed = true;
        }

        if (handlesThinkingBlocks(provider)) {
          let hasToolUse = false;
          let hasKeptThinking = false;

          const isClaudeNative = provider === "claude";
          const isDeepSeek = provider === "deepseek";
          const kept = [];
          for (const block of msg.content) {
            const isThinking = block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING;
            if (isThinking) {
              if (isClaudeNative) {
                if (isValidClaudeSignature(block.signature)) {
                  hasKeptThinking = true;
                  kept.push(block);
                }
              } else if (isDeepSeek) {
                hasKeptThinking = true;
                kept.push(block);
              } else {
                block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
                hasKeptThinking = true;
                kept.push(block);
              }
              continue;
            }
            if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
            kept.push(block);
          }
          msg.content = kept;

          if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
            msg.content.unshift(buildThinkingPlaceholder(provider));
          }
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools)) {

    if (provider !== "claude") {
      body.tools = body.tools
        .filter(tool => !tool.type || tool.type === "function")
        .map(tool => {
          if (tool.function) {
            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters,
            };
          }
          const { type, ...rest } = tool;
          return rest;
        });
    }

    body.tools = body.tools.map((tool, i) => {
      const { cache_control, ...rest } = tool;
      if (i === body.tools.length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });

    if (body.tools.length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  return body;
}
