import { PROVIDERS } from "./providers.js";
import REGISTRY from "../providers/registry/index.js";

import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat, normalizeModelId } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX } from "../providers/models/helpers.js";
export { PROVIDER_MODELS };

export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

const DOT_VERSION_PROVIDERS = new Set(["kr", "kiro"]);

function findModel(models, modelId, aliasOrId) {
  if (!models) return undefined;

  const candidates = typeof modelId === "string"
    ? [
        modelId,
        modelId.replace(/^clinepass\//, "cline-pass/"),
        modelId.replace(/^cline-pass\//, "clinepass/"),
        modelId.replace(/^(?:clinepass|cline-pass)\//, ""),
        ...(aliasOrId === "clinepass" && !/^(?:clinepass|cline-pass)\//.test(modelId)
          ? [`cline-pass/${modelId}`, `clinepass/${modelId}`]
          : []),
      ]
    : [modelId];
  const found = models.find((m) => candidates.includes(m.id));
  if (found) return found;

  if (!DOT_VERSION_PROVIDERS.has(aliasOrId)) return undefined;
  const normalizedCandidates = candidates.map((candidate) => normalizeModelId(candidate));
  return models.find((m) => normalizedCandidates.includes(m.id));
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return !!findModel(models, modelId, aliasOrId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = findModel(models, modelId, aliasOrId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  return modelTargetFormat(findModel(models, modelId, aliasOrId));
}

export function getModelType(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  return found?.kind || found?.type || null;
}

export function getModelUpstreamId(aliasOrId, modelId) {

  const sufMatch = typeof modelId === "string" ? modelId.match(/\([^()]+\)\s*$/) : null;
  const suffix = sufMatch ? sufMatch[0] : "";
  const baseId = suffix ? modelId.slice(0, sufMatch.index).trim() : modelId;
  const models = PROVIDER_MODELS[aliasOrId];
  const found = findModel(models, baseId, aliasOrId);
  const resolvedId = found?.upstreamModelId || found?.id;
  if (resolvedId) {
    const presetMatch = resolvedId.match(/\([^()]+\)\s*$/);
    const presetSuffix = presetMatch?.[0] || "";
    const resolvedBase = presetSuffix ? resolvedId.slice(0, presetMatch.index).trim() : resolvedId;
    return resolvedBase + (suffix || presetSuffix);
  }
  if (aliasOrId === "cx" && typeof baseId === "string" && baseId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return baseId.slice(0, -CODEX_REVIEW_SUFFIX.length) + suffix;
  }
  return baseId + suffix;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return modelQuotaFamily(findModel(models, modelId, aliasOrId));
}

export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

export function getModelStrip(alias, modelId) {
  return modelStrip(findModel(PROVIDER_MODELS[alias], modelId, alias));
}
