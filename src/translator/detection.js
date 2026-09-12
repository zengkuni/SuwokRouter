import { FORMATS } from "./formats.js";
import {
  detectClient,
  detectClientTool,
  isNativePassthrough,
  NATIVE_PAIRS,
} from "../utils/clientDetector.js";

export { detectClient, detectClientTool, isNativePassthrough, NATIVE_PAIRS };

export function clientToFormat(clientId) {
  switch (clientId) {
    case "claude":
      return FORMATS.CLAUDE;
    case "gemini-cli":
      return FORMATS.GEMINI_CLI;
    case "antigravity":
      return FORMATS.ANTIGRAVITY;
    case "codex":
      return FORMATS.CODEX;
    case "cursor":
      return FORMATS.CURSOR;
    case "kiro":
      return FORMATS.KIRO;

    case "github-copilot":
    case "cline":
    case "opencode":
    case "deepseek-tui":
    case "hermes":
    case "aider":
    case null:
    case undefined:
    default:
      return FORMATS.OPENAI;
  }
}

export function detectClientFormat(headers = {}, body = {}, ctx = {}) {
  const view = detectClient(headers, body, ctx);
  return { ...view, format: clientToFormat(view.id) };
}
