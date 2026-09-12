import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const FETCH_TIMEOUT_MS = 5000;

function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return buildClineHeaders(token, { Accept: "application/json" });
}

export async function resolveClinepassModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CLINEPASS_MODELS_ENDPOINT, {
      method: "GET",
      headers: buildModelListHeaders(token, isApiKey),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const json = await response.json();
    const rawList = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
          ? json.models
          : Array.isArray(json?.data?.models)
            ? json.data.models
            : [];
    if (!rawList.length) return null;

    const models = rawList
      .filter((model) => typeof model?.id === "string" && model.id.length > 0)
      .filter((model) => !model.id.includes("/free/"))
      .map((model) => ({
        ...model,
        id: model.id,
        name: model.name || model.id,
        capabilities: model.capabilities || model.caps,
      }));

    return models.length ? { models } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
