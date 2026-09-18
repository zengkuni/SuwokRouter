import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { applyOpenCodeFingerprint, buildOpenCodeHeaders } from "../utils/opencode.js";

const RESPONSES_MODELS = new Set([
  "muse-spark-1.3-contributor-free",
  "muse-spark-1.2-contributor-free",
]);

const MESSAGES_MODELS = new Set(["claude-opus-5", "qwen3.7-max", "minimax-m3"]);
const modelId = (model) => typeof model === "string" ? model.split("/").pop() : model;

export class OpenCodeExecutor extends BaseExecutor {
  constructor(provider = "opencode") {
    super(provider, PROVIDERS[provider]);
  }

  resolveTargetFormat(model, currentFormat) {
    const id = modelId(model);
    if (RESPONSES_MODELS.has(id)) return "openai-responses";
    if (MESSAGES_MODELS.has(id)) return "claude";
    return currentFormat;
  }

  getModelFormat(model) {
    const id = modelId(model);
    if (RESPONSES_MODELS.has(id)) return "responses";
    if (MESSAGES_MODELS.has(id)) return "claude";
    return "openai";
  }

  transformRequest(model, body) {
    const format = this.getModelFormat(model);
    const fingerprinted = applyOpenCodeFingerprint({ ...body }, format, { forceStream: true });
    return injectReasoningContent({ provider: this.provider, model, body: fingerprinted });
  }

  buildUrl(model) {
    const id = modelId(model);
    const base = this.config.baseUrl;
    if (RESPONSES_MODELS.has(id)) return `${base}/zen/v1/responses`;
    return MESSAGES_MODELS.has(id)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true, _url, model) {
    return buildOpenCodeHeaders(credentials, stream, {
      authorization: "public",
      format: this.getModelFormat(model),
    });
  }
}
