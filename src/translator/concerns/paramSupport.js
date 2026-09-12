import { getCapabilitiesForModel } from "../../providers/capabilities.js";

const STRIP_RULES = [

  { match: /claude/i, drop: ["temperature"] },

  { provider: "github", match: /gpt-5\.4/i, drop: ["temperature"] },

  { provider: "github", match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m), drop: ["thinking", "reasoning_effort"] },

  { provider: "cloudflare-ai", flattenContent: true },
];

const MAX_TOKEN_FIELDS = ["max_tokens", "max_completion_tokens", "max_output_tokens"];

const MODEL_OUTPUT_DEFAULTS = [
  { minOutput: 300000, fallback: 65536 },
  { minOutput: 120000, fallback: 32768 },
  { minOutput: 0, fallback: 16384 },
];

function matches(rule, model) {
  if (!rule.match) return true;
  return typeof rule.match === "function" ? rule.match(model) : rule.match.test(model);
}

function clampNumber(body, key, ceiling) {
  if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > ceiling) {
    body[key] = ceiling;
  }
}

export function defaultMaxTokensForModel(provider, model) {
  const modelOutput = getCapabilitiesForModel(provider, model).maxOutput;
  const row = MODEL_OUTPUT_DEFAULTS.find(({ minOutput }) => modelOutput >= minOutput);
  return Math.min(row?.fallback || 16384, modelOutput || 16384);
}

export function applyModelAwareParameterPolicy(provider, model, body, config = null) {
  if (!body || typeof body !== "object") return body;

  const caps = getCapabilitiesForModel(provider, model);
  const ceiling = Number.isFinite(caps.maxOutput) && caps.maxOutput > 0
    ? caps.maxOutput
    : null;

  if (ceiling) {
    for (const key of MAX_TOKEN_FIELDS) clampNumber(body, key, ceiling);
  }

  const hasOutputLimit = MAX_TOKEN_FIELDS.some((key) =>
    typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > 0,
  );
  if (config?.openaiCompatible === true && !hasOutputLimit) {
    body.max_tokens = defaultMaxTokensForModel(provider, model);
  }

  return body;
}

export function stripUnsupportedParams(provider, model, body) {
  if (!model || !body || typeof body !== "object") return body;
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }

    if (rule.flattenContent && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content
            .map(b => (b?.type === "text" && typeof b.text === "string") ? b.text : "")
            .join("");
        }
      }
    }
    if (rule.clampToModelMaxOutput || Number.isFinite(rule.maxOutputCap)) {
      const modelCeiling = getCapabilitiesForModel(provider, model).maxOutput;
      const candidates = [];
      if (rule.clampToModelMaxOutput && Number.isFinite(modelCeiling) && modelCeiling > 0) {
        candidates.push(modelCeiling);
      }
      if (Number.isFinite(rule.maxOutputCap) && rule.maxOutputCap > 0) {
        candidates.push(rule.maxOutputCap);
      }
      if (candidates.length > 0) {
        const ceiling = Math.min(...candidates);
        clampNumber(body, "max_tokens", ceiling);
        clampNumber(body, "max_completion_tokens", ceiling);
        clampNumber(body, "max_output_tokens", ceiling);
      }
    }
  }
  return body;
}
