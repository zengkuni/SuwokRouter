import REGISTRY from "../providers/registry/index.js";

const ALIAS_TO_PROVIDER_ID = {};
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

const BUILTIN_MODEL_ALIASES = {
  "grok-build": "gcli/grok-build",
};

export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

function resolveBuiltinModelAlias(alias) {
  const resolved = BUILTIN_MODEL_ALIASES[alias];
  if (!resolved) return null;

  const firstSlash = resolved.indexOf("/");
  return {
    provider: resolveProviderAlias(resolved.slice(0, firstSlash)),
    model: resolved.slice(firstSlash + 1),
  };
}

export async function getModelInfoCore(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  const resolved = resolveBuiltinModelAlias(parsed.model);
  if (resolved) {
    return resolved;
  }

  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
}

const MODEL_PREFIX_PROVIDERS = [
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "openrouter"],
];

function inferProviderFromModelName(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}
