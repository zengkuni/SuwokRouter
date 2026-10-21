import { randomUUID } from "node:crypto";
import { DefaultExecutor } from "./default.js";

const CODEBUDDY_SYSTEM_PROMPT = "You are CodeBuddy Code.";
const CHANNEL_MARKER_REGEX = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|OhMyOpenCode/gi;

function sanitizeChannelMarkers(text) {
  if (typeof text !== "string" || !text) return text;
  return text
    .replace("x-anthropic-billing-header", "[external-client-identity]")
    .replace("Main branch (you will usually use this for PRs):", "[external-client-identity]")
    .replace(CHANNEL_MARKER_REGEX, "[external-client-identity]");
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (
    typeof block === "string" ? block : block && typeof block.text === "string" ? block.text : ""
  )).join("\n");
}

export class CodeBuddyExecutor extends DefaultExecutor {
  constructor(provider = "codebuddy-cn") {
    super(provider);
  }
  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, true);
    delete headers["x-requested-with"];
    delete headers["x-codebuddy-request"];
    const requestId = randomUUID().replaceAll("-", "");
    const domain = credentials?.providerSpecificData?.domain
      || (this.provider === "codebuddy-cn" ? "copilot.tencent.com" : "www.codebuddy.ai");

    Object.assign(headers, {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
      "X-Product": "SaaS",
      "X-App": "cli",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": "2.108.1",
      "X-Private-Data": "false",
      "X-Requested-With": "XMLHttpRequest",
      "X-CodeBuddy-Request": "1",
      "X-Domain": domain,
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": process.version,
      "X-Stainless-Lang": "js",
      "X-Stainless-Arch": "x64",
      "X-Stainless-Os": "Windows",
      "X-Stainless-Package-Version": "6.25.0",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Request-ID": requestId,
      "X-Conversation-ID": randomUUID(),
      "X-Conversation-Request-ID": randomUUID().replaceAll("-", ""),
      "X-Conversation-Message-ID": requestId,
      "X-Agent-Intent": "craft",
      "X-Agent-Purpose": "conversation",
    });
    if (!stream) delete headers.Accept;
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;
    const effort = transformed.reasoning_effort;
    if (effort === "none" || effort === "off") delete transformed.reasoning_effort;
    else if (effort) transformed.reasoning_summary = "auto";

    const systemParts = [CODEBUDDY_SYSTEM_PROMPT];
    const otherMessages = [];
    for (const message of Array.isArray(transformed.messages) ? transformed.messages : []) {
      if (!message || typeof message !== "object") continue;
      if (message.role === "system" || message.role === "developer") {
        const cleaned = sanitizeChannelMarkers(messageText(message.content)).trim();
        if (cleaned && cleaned !== CODEBUDDY_SYSTEM_PROMPT) systemParts.push(cleaned);
      } else if (message.role === "user" && typeof message.content === "string") {
        otherMessages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else if (message.role === "assistant") {
        const next = { ...message };
        if (typeof next.content === "string") next.content = sanitizeChannelMarkers(next.content);
        else if (Array.isArray(next.content)) next.content = next.content.map((block) => (
          block && typeof block === "object" && typeof block.text === "string"
            ? { ...block, text: sanitizeChannelMarkers(block.text) }
            : block
        ));
        otherMessages.push(next);
      } else {
        otherMessages.push({ ...message });
      }
    }
    transformed.messages = [{ role: "system", content: systemParts.join("\n\n") }, ...otherMessages];
    return transformed;
  }
}

export default CodeBuddyExecutor;
