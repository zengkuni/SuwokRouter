import { DefaultExecutor } from "./default.js";
import { withLeadingSystemMessage } from "./codebuddy-messages.js";

export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = withLeadingSystemMessage(source);
    for (const message of transformed.messages) {
      if (message.role === "user" && typeof message.content === "string") {
        message.content = [{ type: "text", text: message.content }];
      }
    }

    return transformed;
  }

  parseError(response, bodyText) {
    const fallback = super.parseError(response, bodyText);
    if (!bodyText) return fallback;
    try {
      const payload = JSON.parse(bodyText);
      const code = payload?.code ?? payload?.error?.code;
      const nested = payload?.error;
      const message = typeof nested === "object"
        ? nested?.message || payload?.msg || payload?.message
        : nested || payload?.msg || payload?.message;
      if (typeof message !== "string" && code == null) return fallback;
      const text = typeof message === "string" && message.trim()
        ? message.trim()
        : "Provider request failed";
      return {
        status: response.status,
        message: code == null ? text : `CodeBuddy ${code}: ${text}`,
      };
    } catch {
      return fallback;
    }
  }
}

export default CodeBuddyIntlExecutor;
