import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { safeParseJSON } from "../concerns/json.js";
import { parseDataUri } from "../concerns/image.js";
import { extractTextContent } from "../formats/gemini.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";

export function openaiToClaudeRequest(model, body, stream) {

  const modelCeiling = getCapabilitiesForModel(null, model).maxOutput || undefined;
  const result = {
    model: model,
    max_tokens: adjustMaxTokens(body, modelCeiling),
    stream: stream
  };

  if (body.temperature !== undefined) {
    result.temperature = body.temperature;
  }

  result.messages = [];
  const systemParts = [];

  if (body.messages && Array.isArray(body.messages)) {

    for (const msg of body.messages) {
      if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
        systemParts.push(typeof msg.content === "string" ? msg.content : extractTextContent(msg.content, "\n"));
      }
    }

    const nonSystemMessages = body.messages.filter(m => m.role !== ROLE.SYSTEM && m.role !== ROLE.DEVELOPER);

    let currentRole = undefined;
    let currentParts = [];

    const flushCurrentMessage = () => {
      if (currentRole && currentParts.length > 0) {
        result.messages.push({ role: currentRole, content: currentParts });
        currentParts = [];
      }
    };

    for (const msg of nonSystemMessages) {
      const newRole = (msg.role === ROLE.USER || msg.role === ROLE.TOOL) ? ROLE.USER : ROLE.ASSISTANT;
      const blocks = getContentBlocksFromMessage(msg);
      const hasToolUse = blocks.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      const hasToolResult = blocks.some(b => b.type === CLAUDE_BLOCK.TOOL_RESULT);

      if (hasToolResult) {
        const toolResultBlocks = blocks.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT);
        const otherBlocks = blocks.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT);

        flushCurrentMessage();

        if (toolResultBlocks.length > 0) {
          result.messages.push({ role: ROLE.USER, content: toolResultBlocks });
        }

        if (otherBlocks.length > 0) {
          currentRole = newRole;
          currentParts.push(...otherBlocks);
        }
        continue;
      }

      if (currentRole !== newRole) {
        flushCurrentMessage();
        currentRole = newRole;
      }

      currentParts.push(...blocks);

      if (hasToolUse) {
        flushCurrentMessage();
      }
    }

    flushCurrentMessage();

    for (let i = result.messages.length - 1; i >= 0; i--) {
      const message = result.messages[i];
      if (message.role === ROLE.ASSISTANT && Array.isArray(message.content) && message.content.length > 0) {

        const validBlockTypes = [CLAUDE_BLOCK.TEXT, CLAUDE_BLOCK.TOOL_USE, CLAUDE_BLOCK.TOOL_RESULT, CLAUDE_BLOCK.IMAGE];
        for (let j = message.content.length - 1; j >= 0; j--) {
          const block = message.content[j];
          if (validBlockTypes.includes(block.type)) {
            block.cache_control = { type: "ephemeral" };
            break;
          }
        }
        break;
      }
    }
  }

  if (systemParts.length > 0) {
    const systemText = systemParts.join("\n\n");
    result.system = [
      { type: CLAUDE_BLOCK.TEXT, text: systemText, cache_control: { type: "ephemeral", ttl: "1h" } }
    ];
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {

      const toolType = tool.type;
      if (toolType && toolType !== OPENAI_BLOCK.FUNCTION) {
        result.tools.push(tool);
        continue;
      }

      const toolData = tool.function ?? tool;
      result.tools.push({
        name: toolData.name,
        description: toolData.description || "",
        input_schema: toolData.parameters || toolData.input_schema || { type: "object", properties: {}, required: [] }
      });
    }

    if (result.tools.length > 0) {
      result.tools[result.tools.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };
    }
  }

  if (body.tool_choice) {
    result.tool_choice = convertOpenAIToolChoice(body.tool_choice);
  }

  return result;
}

function getContentBlocksFromMessage(msg) {
  const blocks = [];

  if (msg.role === ROLE.TOOL) {
    blocks.push({
      type: CLAUDE_BLOCK.TOOL_RESULT,
      tool_use_id: msg.tool_call_id,
      content: msg.content
    });
  } else if (msg.role === ROLE.USER) {
    if (typeof msg.content === "string") {
      if (msg.content) {
        blocks.push({ type: CLAUDE_BLOCK.TEXT, text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === OPENAI_BLOCK.TEXT && part.text) {
          blocks.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
        } else if (part.type === CLAUDE_BLOCK.TOOL_RESULT) {
          blocks.push({
            type: CLAUDE_BLOCK.TOOL_RESULT,
            tool_use_id: part.tool_use_id,
            content: part.content,
            ...(part.is_error && { is_error: part.is_error })
          });
        } else if (part.type === OPENAI_BLOCK.IMAGE_URL) {
          const url = part.image_url.url;
          const parsed = parseDataUri(url);
          if (parsed) {
            blocks.push({
              type: CLAUDE_BLOCK.IMAGE,
              source: { type: "base64", media_type: parsed.mimeType, data: parsed.base64 }
            });
          } else if (url.startsWith("http://") || url.startsWith("https://")) {
            blocks.push({
              type: CLAUDE_BLOCK.IMAGE,
              source: { type: "url", url }
            });
          }
        } else if (part.type === OPENAI_BLOCK.IMAGE && part.source) {
          blocks.push({ type: CLAUDE_BLOCK.IMAGE, source: part.source });
        } else if (part.type === OPENAI_BLOCK.FILE && part.file) {

          const fileData = part.file.file_data;
          const parsed = parseDataUri(fileData);
          if (parsed && parsed.mimeType === "application/pdf") {
            blocks.push({
              type: CLAUDE_BLOCK.DOCUMENT,
              source: { type: "base64", media_type: parsed.mimeType, data: parsed.base64 }
            });
          }
        }
      }
    }
  } else if (msg.role === ROLE.ASSISTANT) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === OPENAI_BLOCK.TEXT && part.text) {
          blocks.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
        } else if (part.type === CLAUDE_BLOCK.TOOL_USE) {

          blocks.push({ type: CLAUDE_BLOCK.TOOL_USE, id: part.id, name: part.name, input: part.input });
        } else if (part.type === CLAUDE_BLOCK.THINKING) {

          const { cache_control, ...thinkingBlock } = part;
          blocks.push(thinkingBlock);
        }
      }
    } else if (msg.content) {
      const text = typeof msg.content === "string" ? msg.content : extractTextContent(msg.content, "\n");
      if (text) {
        blocks.push({ type: CLAUDE_BLOCK.TEXT, text });
      }
    }

    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.type === OPENAI_BLOCK.FUNCTION) {

          blocks.push({
            type: CLAUDE_BLOCK.TOOL_USE,
            id: tc.id,
            name: tc.function.name,
            input: safeParseJSON(tc.function.arguments, tc.function.arguments)
          });
        }
      }
    }
  }

  return blocks;
}

const CLAUDE_TOOL_CHOICE_TYPES = new Set(["auto", "any", "tool", "none"]);

function convertOpenAIToolChoice(choice) {
  if (!choice) return { type: "auto" };

  if (typeof choice === "string") {
    if (choice === "required") return { type: "any" };
    return { type: "auto" };
  }

  if (typeof choice === "object") {

    if (choice.function?.name) {
      return { type: "tool", name: choice.function.name };
    }

    if (CLAUDE_TOOL_CHOICE_TYPES.has(choice.type)) {
      return choice;
    }
  }

  return { type: "auto" };
}

function openaiToClaudeRequestForAntigravity(model, body, stream) {
  return openaiToClaudeRequest(model, body, stream);
}

export { openaiToClaudeRequestForAntigravity };

register(FORMATS.OPENAI, FORMATS.CLAUDE, openaiToClaudeRequest, null);
