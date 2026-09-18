import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { applyOpenCodeFingerprint, buildOpenCodeHeaders } from "../utils/opencode.js";

const MESSAGES_FORMAT_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "qwen3.7-max",
  "claude-opus-5",
]);
const RESPONSES_FORMAT_MODELS = new Set(["grok-4.5"]);
const modelId = (model) => typeof model === "string" ? model.split("/").pop() : model;

const BASE = "https://opencode.ai/zen/go/v1";

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  resolveTargetFormat(model, currentFormat) {
    const id = modelId(model);
    if (RESPONSES_FORMAT_MODELS.has(id)) return "openai-responses";
    return MESSAGES_FORMAT_MODELS.has(id) ? "claude" : currentFormat;
  }

  buildUrl(model) {
    return MESSAGES_FORMAT_MODELS.has(modelId(model))
      ? `${BASE}/messages`
      : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true, _url, model) {
    const id = modelId(model);
    const format = RESPONSES_FORMAT_MODELS.has(id)
      ? "responses"
      : MESSAGES_FORMAT_MODELS.has(id)
        ? "claude"
        : "openai";
    return buildOpenCodeHeaders(credentials, stream, { authorization: "", format });
  }

  transformRequest(model, body) {
    const id = modelId(model);
    const format = RESPONSES_FORMAT_MODELS.has(id)
      ? "responses"
      : MESSAGES_FORMAT_MODELS.has(id)
        ? "claude"
        : "openai";
    const fingerprinted = applyOpenCodeFingerprint({ ...body }, format);
    return injectReasoningContent({ provider: this.provider, model, body: fingerprinted });
  }
}
