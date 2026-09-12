import { NextResponse } from "next/server";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const MODEL_TEST_ERROR = publicError("provider", "Provider model test failed");
import { getCustomModels, getProviderConnectionById } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { RUNTIME_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/routes/api/models/test/ping";

function normalizedProviderAlias(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCustomModelId(value, alias, acceptedAliases) {
  const rawId = String(value || "").trim();
  if (!rawId) return "";

  const rawLower = rawId.toLowerCase();
  const prefix = [...acceptedAliases]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => rawLower.startsWith(`${candidate}/`));
  if (!prefix) return rawId;
  return `${alias}/${rawId.slice(prefix.length + 1)}`;
}

export function mergeCustomModels(models, customModels, acceptedAliases, alias, routeModel) {
  const merged = [...models];
  const seen = new Set(
    merged
      .map((model) => normalizedProviderAlias(routeModel(model?.id)))
      .filter(Boolean),
  );

  for (const customModel of Array.isArray(customModels) ? customModels : []) {
    const providerAlias = normalizedProviderAlias(customModel?.providerAlias);
    const type = normalizedProviderAlias(customModel?.type || "llm");
    if (!acceptedAliases.has(providerAlias) || type !== "llm") continue;

    const id = normalizeCustomModelId(customModel?.id, alias, acceptedAliases);
    const routedId = normalizedProviderAlias(routeModel(id));
    if (!id || !routedId || seen.has(routedId)) continue;

    seen.add(routedId);
    merged.push({
      ...customModel,
      id,
      name: customModel.name || id,
      type: "llm",
    });
  }

  return merged;
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    let requestBody = {};
    try {
      requestBody = await request.json();
    } catch {

    }
    const requestedModel = String(
      requestBody?.model || new URL(request.url).searchParams.get("model") || ""
    ).trim();
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.isActive === false) {
      return NextResponse.json({
        error: "Connection is inactive",
        message: "Enable this connection before testing its models.",
      }, { status: 409 });
    }

    const providerId = connection.provider;
    const isCompatible = providerId === "agentrouter"
      || isOpenAICompatibleProvider(providerId)
      || isAnthropicCompatibleProvider(providerId);
    const isCodeBuddy = providerId === "codebuddy-cn" || providerId === "codebuddy-intl";
    const usesDynamicCatalog = isCompatible || isCodeBuddy;
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const acceptedAliases = new Set(
      [
        providerId,
        alias,
        connection.providerAlias,
        connection.providerSpecificData?.providerAlias,
        connection.providerSpecificData?.prefix,
      ]
        .map(normalizedProviderAlias)
        .filter(Boolean),
    );

    let models = getProviderModels(alias);

    const baseUrl = `http://127.0.0.1:${process.env.PORT || RUNTIME_CONFIG.appPort}`;

    if (usesDynamicCatalog && models.length === 0) {
      try {
        const modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models?refresh=1`);
        if (modelsRes.ok) {
          const data = await modelsRes.json();
          models = (data.models || []).map((m) => ({ id: m.id || m.name, name: m.name || m.id }));
        }
      } catch {                         }
    }

    if (models.length === 0 && usesDynamicCatalog && requestedModel) {
      models = [{ id: requestedModel, name: requestedModel, kind: "llm" }];
    }

    const routeModel = (modelId) => {
      const value = String(modelId || "");

      if (providerId === "clinepass" || providerId === "cline-pass") {
        const slug = value.replace(/^cline-pass\//, "").replace(/^clinepass\//, "");
        return `${alias}/${slug}`;
      }
      return value.startsWith(`${alias}/`) ? value : `${alias}/${value}`;
    };

    let customModels = [];
    try {
      customModels = await getCustomModels();
    } catch {
      customModels = [];
    }
    models = mergeCustomModels(models, customModels, acceptedAliases, alias, routeModel);

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    const isClinePass = providerId === "clinepass" || providerId === "cline-pass";
    const pingOptions = {
      connectionId: id,

      stream: isClinePass,

      timeoutMs: isClinePass ? 60_000 : undefined,

      signal: request.signal,
    };
    const selected = requestedModel
      ? models.filter((model) => {
        const candidate = String(model.id || "");
        return candidate === requestedModel
          || routeModel(candidate) === requestedModel
          || requestedModel.endsWith(`/${candidate}`)
          || candidate.endsWith(`/${requestedModel.split("/").pop()}`);
      })
      : models;

    if (requestedModel && selected.length === 0) {
      return NextResponse.json({
        provider: providerId,
        connectionId: id,
        results: [{ modelId: requestedModel, name: requestedModel, ok: false, error: "Model not found" }],
      }, { status: 404 });
    }

    const results = new Array(selected.length);
    let nextIndex = 0;
    const concurrency = requestedModel ? 1 : Math.min(4, selected.length);
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= selected.length) return;
        if (request.signal.aborted) return;
        const model = selected[index];
        try {
          const result = await pingModelByKind(
            routeModel(model.id),
            model.kind || model.type || "llm",
            baseUrl,
            pingOptions
          );
          results[index] = { modelId: model.id, name: model.name || model.id, ...result };
        } catch (error) {
          if (request.signal.aborted) return;
          logRouteError("ProviderModelTest", error);
          results[index] = {
            modelId: model.id,
            name: model.name || model.id,
            ok: false,
            latencyMs: 0,
            status: 502,
            error: MODEL_TEST_ERROR,
          };
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (request.signal.aborted) return new Response(null, { status: 499 });

    return NextResponse.json({
      provider: providerId,
      connectionId: id,
      requestedModel: requestedModel || null,
      results,
    });
  } catch (error) {
    logRouteError("ProviderModelsTest", error);
    return NextResponse.json({ error: MODEL_TEST_ERROR }, { status: 500 });
  }
}
