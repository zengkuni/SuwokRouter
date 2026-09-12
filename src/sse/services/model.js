import { getComboByName, getCustomModels, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, getModelInfoCore } from "../../services/model.js";
import REGISTRY from "../../providers/registry/index.js";

const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

function normalizeModelKey(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:clinepass|cline-pass)\//i, "")
    .toLowerCase();
}

async function getCustomModelCapabilities(providerAlias, provider, model) {
  try {
    const aliases = new Set(
      [providerAlias, provider]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase()),
    );
    if (aliases.size === 0) return null;

    const customModels = await getCustomModels();
    const match = customModels.find((entry) => (
      aliases.has(String(entry?.providerAlias || "").trim().toLowerCase()) &&
      normalizeModelKey(entry?.id) === normalizeModelKey(model)
    ));
    return match?.capabilities && typeof match.capabilities === "object"
      ? match.capabilities
      : null;
  } catch {
    return null;
  }
}

async function buildModelInfo({ providerAlias, provider, model }) {
  const capabilities = await getCustomModelCapabilities(providerAlias, provider, model);
  return {
    provider,
    model,
    ...(capabilities ? { modelCapabilities: capabilities } : {}),
  };
}

export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {

    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return buildModelInfo({
          providerAlias: parsed.providerAlias,
          provider: matchedOpenAI.id,
          model: parsed.model,
        });
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return buildModelInfo({
          providerAlias: parsed.providerAlias,
          provider: matchedAnthropic.id,
          model: parsed.model,
        });
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return buildModelInfo({
          providerAlias: parsed.providerAlias,
          provider: matchedEmbedding.id,
          model: parsed.model,
        });
      }
    }
    return buildModelInfo({
      providerAlias: parsed.providerAlias,
      provider: parsed.provider,
      model: parsed.model,
    });
  }

  const combo = await getComboByName(parsed.model);
  if (combo) {

    return { provider: null, model: parsed.model };
  }

  const info = await getModelInfoCore(modelStr);
  return buildModelInfo({
    providerAlias: parsed.providerAlias || info.provider,
    provider: info.provider,
    model: info.model,
  });
}

export async function getComboModels(modelStr) {

  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
