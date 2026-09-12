import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import { collapseTextParts } from "../concerns/message.js";

export function claudeToOpenAIRequest(model, body, stream) {
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  if (body.max_tokens) {
    result.max_tokens = adjustMaxTokens(body);
  }

  if (body.temperature !== undefined) {
    result.temperature = body.temperature;
  }

  if (body.system) {
    const systemContent = Array.isArray(body.system)
      ? body.system.map(s => typeof s === "string" ? s : s?.text || "").filter(Boolean).join("\n\n")
      : body.system;

    if (systemContent) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemContent
      });
    }
  }

  if (body.messages && Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const converted = convertClaudeMessage(msg);
      if (converted) {

        if (Array.isArray(converted)) {
          result.messages.push(...converted);
        } else {
          result.messages.push(converted);
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.map(tool => ({
      type: OPENAI_BLOCK.FUNCTION,
      function: {
        name: tool.name,
        description: String(tool.description || ""),
        parameters: tool.input_schema || { type: "object", properties: {} }
      }
    }));
  }

  if (body.tool_choice) {
    result.tool_choice = convertToolChoice(body.tool_choice);
  }

  if (body.reasoning_effort !== undefined) {
    result.reasoning_effort = body.reasoning_effort;
  } else if (body.reasoning?.effort !== undefined) {
    result.reasoning_effort = body.reasoning.effort;
  }

  if (body.reasoning !== undefined) {
    result.reasoning = body.reasoning;
  }

  return result;
}

function systemMessageText(content) {
  const parts = Array.isArray(content)
    ? content.filter(c => c?.type === CLAUDE_BLOCK.TEXT).map(c => c.text || "")
    : [typeof content === "string" ? content : ""];
  const text = parts.filter(Boolean).join("\n");
  if (!text.trim()) return "";
  return text;
}

function convertClaudeMessage(msg) {

  if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
    const text = systemMessageText(msg.content);
    return text ? { role: ROLE.SYSTEM, content: text } : null;
  }

  const role = msg.role === ROLE.USER || msg.role === ROLE.TOOL ? ROLE.USER : ROLE.ASSISTANT;

  if (typeof msg.content === "string") {
    return { role, content: msg.content };
  }

  if (Array.isArray(msg.content)) {
    const parts = [];
    const toolCalls = [];
    const toolResults = [];

    for (const block of msg.content) {
      switch (block.type) {
        case CLAUDE_BLOCK.TEXT:
          parts.push({ type: OPENAI_BLOCK.TEXT, text: block.text });
          break;

        case CLAUDE_BLOCK.IMAGE:
          if (block.source?.type === "base64") {
            parts.push({
              type: OPENAI_BLOCK.IMAGE_URL,
              image_url: {
                url: encodeDataUri(block.source.media_type, block.source.data)
              }
            });
          }
          break;

        case CLAUDE_BLOCK.TOOL_USE:
          toolCalls.push({
            id: block.id,
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          });
          break;

        case CLAUDE_BLOCK.TOOL_RESULT:
          let resultContent = "";
          if (typeof block.content === "string") {
            resultContent = block.content;
          } else if (Array.isArray(block.content)) {
            resultContent = block.content
              .filter(c => c.type === CLAUDE_BLOCK.TEXT)
              .map(c => c.text)
              .join("\n") || JSON.stringify(block.content);
          } else if (block.content) {
            resultContent = JSON.stringify(block.content);
          }

          toolResults.push({
            role: ROLE.TOOL,
            tool_call_id: block.tool_use_id,
            content: resultContent
          });
          break;
      }
    }

    if (toolResults.length > 0) {
      if (parts.length > 0) {
        return [...toolResults, { role: ROLE.USER, content: collapseTextParts(parts) }];
      }
      return toolResults;
    }

    if (toolCalls.length > 0) {
      const result = { role: ROLE.ASSISTANT };
      if (parts.length > 0) {
        result.content = collapseTextParts(parts);
      }
      result.tool_calls = toolCalls;
      return result;
    }

    if (parts.length > 0) {
      return {
        role,
        content: collapseTextParts(parts)
      };
    }

    if (msg.content.length === 0) {
      return { role, content: "" };
    }
  }

  return null;
}

function convertToolChoice(choice) {
  if (!choice) return "auto";
  if (typeof choice === "string") return choice;

  switch (choice.type) {
    case "auto": return "auto";
    case "any": return "required";
    case "tool": return { type: OPENAI_BLOCK.FUNCTION, function: { name: choice.name } };
    default: return "auto";
  }
}

register(FORMATS.CLAUDE, FORMATS.OPENAI, claudeToOpenAIRequest, null);
