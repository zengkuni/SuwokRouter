import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { isCustomOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { resolveOllamaLocalHost, resolveXiaomiTokenplanBaseUrl, PROVIDERS } from "open-sse/config/providers.js";
import { openaiToCommandCodeRequest } from "open-sse/translator/request/openai-to-commandcode.js";
import { resolveQoderCredentials, resolveQoderModels } from "open-sse/services/qoderModels.js";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { logRouteError } from "@/lib/errors/publicError";
import { KiroService } from "@/lib/oauth/services/kiro";
import { AGENTROUTER_MODELS_URL, AGENTROUTER_OPENAI_HEADERS } from "open-sse/providers/shared.js";
import { resolveCodeBuddyModels } from "@/services/codebuddyModels.js";

const VALIDATION_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, options = {}, timeoutMs = VALIDATION_TIMEOUT_MS) {
  if (options.signal) return fetch(url, options);
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function validationErrorMessage(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return `Validation timed out (>${Math.round(VALIDATION_TIMEOUT_MS / 1000)}s) — retry`;
  }
  return "Validation failed — check credentials and provider settings";
}

function codeBuddyTokenKind(token) {
  if (typeof token !== "string") return "access";
  const part = token.split(".")[1];
  if (!part) return "access";
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const type = String(payload?.typ || payload?.type || "");
    return /offline|refresh/i.test(type) ? "refresh" : "access";
  } catch {
    return "access";
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, providerSpecificData } = body;
    const credentialToken = typeof body.credentialToken === "string"
      ? body.credentialToken.trim()
      : "";
    const isCodeBuddy = provider === "codebuddy-cn" || provider === "codebuddy-intl";

    if (isCodeBuddy) {
      if (!credentialToken && !body.accessToken && !body.refreshToken) {
        return NextResponse.json(
          { valid: false, error: "An access token or refresh token is required" },
          { status: 400 },
        );
      }

      let accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
      let refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
      if (credentialToken) {
        if (codeBuddyTokenKind(credentialToken) === "refresh") refreshToken = credentialToken;
        else accessToken = credentialToken;
      }

      try {
        const result = await resolveCodeBuddyModels(
          { provider, accessToken, refreshToken },
          { signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS) },
        );
        if (result?.status === 401 || result?.status === 403) {
          return NextResponse.json({
            valid: false,
            error: "Access token or refresh token is invalid or expired",
          });
        }
        if (result?.models?.length) {
          return NextResponse.json({ valid: true, error: null });
        }
        return NextResponse.json({
          valid: false,
          error: "CodeBuddy token could not be validated. Check the token and try again.",
        });
      } catch {
        return NextResponse.json({ valid: false, error: "Token validation failed. Try again." });
      }
    }

    const isNoAuth = AI_PROVIDERS[provider]?.noAuth === true;
    if (!provider || (!apiKey && provider !== "ollama-local" && !isNoAuth)) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    let isValid = false;
    let error = null;

    try {
      if (isCustomOpenAICompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
        }
        const modelsUrl = `${node.baseUrl?.replace(/\/$/, "")}/models`;
        const res = await fetchWithTimeout(modelsUrl, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (isCustomEmbeddingProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
        }
        const baseUrl = node.baseUrl?.replace(/\/$/, "");
        const modelsRes = await fetchWithTimeout(`${baseUrl}/models`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        if (modelsRes.ok) {
          return NextResponse.json({ valid: true });
        }

        if (modelsRes.status === 401 || modelsRes.status === 403) {
          return NextResponse.json({ valid: false, error: "Invalid API key" });
        }

        const embedRes = await fetchWithTimeout(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "test", input: "ping" }),
        });

        isValid = embedRes.status !== 401 && embedRes.status !== 403;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (isAnthropicCompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
        }

        let normalizedBase = node.baseUrl?.trim().replace(/\/$/, "") || "";
        if (normalizedBase.endsWith("/messages")) {
          normalizedBase = normalizedBase.slice(0, -9);
        }

        const messagesUrl = `${normalizedBase}/v1/messages`;
        const model = node.defaultModel || "claude-3-haiku-20240307";

        const res = await fetchWithTimeout(messagesUrl, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });

        isValid = res.status !== 401 && res.status !== 403;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (provider === "cloudflare-ai") {
        const { providerSpecificData } = body;
        const accountId = providerSpecificData?.accountId;
        if (!accountId) {
          return NextResponse.json({ valid: false, error: "Missing Account ID" });
        }
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
        const cfRes = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: getDefaultModel("cloudflare-ai"),
            messages: [{ role: "user", content: "test" }],
            max_tokens: 1,
          }),
        });
        isValid = cfRes.status !== 401 && cfRes.status !== 403 && cfRes.status !== 404;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API token or Account ID",
        });
      }

      if (provider === "azure") {
        const { providerSpecificData } = body;
        const endpoint = (providerSpecificData?.azureEndpoint || "").replace(/\/$/, "");
        const deployment = providerSpecificData?.deployment || "gpt-4";
        const apiVersion = providerSpecificData?.apiVersion || "2024-10-01-preview";
        const organization = providerSpecificData?.organization;

        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
        const headers = {
          "api-key": apiKey,
          "Content-Type": "application/json",
        };
        if (organization) headers["OpenAI-Organization"] = organization;

        const azureRes = await fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            messages: [{ role: "user", content: "test" }],
            max_tokens: 1,
          }),
        });
        isValid = azureRes.status !== 401 && azureRes.status !== 403;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key or Azure configuration",
        });
      }

      if (provider === "kiro") {
        const kiroService = new KiroService();
        await kiroService.validateApiKey(apiKey, providerSpecificData?.region || "us-east-1");
        return NextResponse.json({ valid: true, error: null });
      }

      switch (provider) {
        case "openai":
          const openaiRes = await fetchWithTimeout("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openaiRes.ok;
          break;

        case "vercel-ai-gateway":
          const vercelAiGatewayRes = await fetchWithTimeout("https://ai-gateway.vercel.sh/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = vercelAiGatewayRes.ok;
          break;

        case "agentrouter": {
          const agentRouterRes = await fetchWithTimeout(AGENTROUTER_MODELS_URL, {
            headers: {
              ...AGENTROUTER_OPENAI_HEADERS,
              "Authorization": `Bearer ${apiKey}`,
            },
          });
          isValid = agentRouterRes.ok;
          break;
        }

        case "anthropic":
          const anthropicRes = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = anthropicRes.status !== 401;
          break;

        case "gemini":
          const geminiRes = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
          isValid = geminiRes.ok;
          break;

        case "openrouter":
          const openrouterRes = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openrouterRes.ok;
          break;

        case "meta":

          const metaRes = await fetchWithTimeout("https://api.meta.ai/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = metaRes.ok;
          break;

        case "glm":
        case "glm-cn":
        case "kimi":
        case "minimax":
        case "minimax-cn":
        case "alicode-intl":
        case "alims-intl":
        case "alicode": {

          const cfg = PROVIDERS[provider];
          const isOpenAiFormat = provider === "glm-cn" || provider === "alicode" || provider === "alicode-intl" || provider === "alims-intl";

          if (isOpenAiFormat) {
            const testModel = getDefaultModel(provider);
            const res = await fetchWithTimeout(cfg.baseUrl, {
              method: "POST",
              headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
              body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
            });
            isValid = res.status !== 401 && res.status !== 403;
          } else {
            const testModel = getDefaultModel(provider) || "claude-sonnet-4-20250514";
            const res = await fetchWithTimeout(cfg.baseUrl, {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                ...(cfg.headers || {}),
              },
              body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
            });

            isValid = res.status !== 401 && res.status !== 403;
          }
          break;
        }
        case "byteplus": {
          const res = await fetchWithTimeout(PROVIDERS[provider]?.baseUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: getDefaultModel(provider),
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "deepseek":
        case "groq":
        case "xai":
        case "mistral":
        case "perplexity":
        case "together":
        case "fireworks":
        case "cerebras":
        case "nebius":
        case "ollama":
        case "ollama-local":
        case "chutes":
        case "xiaomi-mimo":
        case "xiaomi-tokenplan":
        case "nvidia": {
          const endpoints = {
            ...Object.fromEntries(
              Object.entries(PROVIDERS).filter(([, t]) => t.validateUrl).map(([id, t]) => [id, t.validateUrl])
            ),

            "ollama-local": `${resolveOllamaLocalHost({ providerSpecificData })}/api/tags`,
            "xiaomi-tokenplan": `${resolveXiaomiTokenplanBaseUrl({ providerSpecificData })}/models`,
          };
          const headers = {};
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
          const res = await fetchWithTimeout(endpoints[provider], { headers, signal: AbortSignal.timeout(8000) });

          if (provider === "xai") {
            isValid = res.status === 200 || res.status === 403;
          } else if (provider === "xiaomi-tokenplan") {

            isValid = res.status !== 401;
          } else {
            isValid = res.ok;
          }
          break;
        }

        case "opencode-go": {
          const res = await fetchWithTimeout("https://opencode.ai/zen/go/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: getDefaultModel("opencode-go"),
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              stream: false,
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "commandcode": {
          const cfg = PROVIDERS.commandcode;
          const model = getDefaultModel("commandcode");
          const payload = openaiToCommandCodeRequest(model, {
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
          }, false);
          const res = await fetchWithTimeout(cfg.baseUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(cfg.headers || {}),
              "x-session-id": crypto.randomUUID(),
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "blackbox": {
          const res = await fetchWithTimeout("https://api.blackbox.ai/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "user", content: "test" }],
              max_tokens: 10,
            }),
          });

          isValid = res.status === 200 || res.status === 400;
          break;
        }

        case "vertex": {

          const saJson = (() => { try { const p = JSON.parse(apiKey); return p.type === "service_account" ? p : null; } catch { return null; } })();
          if (saJson) {

            isValid = !!(saJson.client_email && saJson.private_key && saJson.project_id);
          } else {

            const probeRes = await fetchWithTimeout(
              `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
            );
            isValid = probeRes.status !== 401 && probeRes.status !== 403;
          }
          break;
        }

        case "vertex-partner": {
          const saJson = (() => { try { const p = JSON.parse(apiKey); return p.type === "service_account" ? p : null; } catch { return null; } })();
          if (saJson) {
            isValid = !!(saJson.client_email && saJson.private_key && saJson.project_id);
          } else {
            const probeRes = await fetchWithTimeout(
              `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
            );
            isValid = probeRes.status !== 401 && probeRes.status !== 403;
          }
          break;
        }

        case "grok-web": {
          const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;

          const randomHex = (n) => {
            const a = new Uint8Array(n);
            crypto.getRandomValues(a);
            return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
          };
          const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
          const traceId = randomHex(16);
          const spanId = randomHex(8);
          const res = await fetchWithTimeout("https://grok.com/rest/app-chat/conversations/new", {
            method: "POST",
            headers: {
              Accept: "*/*",
              "Accept-Encoding": "gzip, deflate, br, zstd",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
              "Content-Type": "application/json",
              Cookie: `sso=${token}`,
              Origin: "https://grok.com",
              Pragma: "no-cache",
              Referer: "https://grok.com/",
              "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
              "Sec-Ch-Ua-Mobile": "?0",
              "Sec-Ch-Ua-Platform": '"macOS"',
              "Sec-Fetch-Dest": "empty",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Site": "same-origin",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
              "x-statsig-id": statsigId,
              "x-xai-request-id": crypto.randomUUID(),
              traceparent: `00-${traceId}-${spanId}-00`,
            },
            body: JSON.stringify({
              temporary: true, modelName: "grok-4", modelMode: "MODEL_MODE_GROK_4", message: "ping",
              fileAttachments: [], imageAttachments: [],
              disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
              returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
              forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
              isReasoning: false, disableTextFollowUps: true, disableMemory: true,
              forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
            }),
          });

          if (res.status === 401 || res.status === 403) {
            isValid = false;
            error = "Invalid SSO cookie — re-paste from grok.com DevTools → Cookies → sso";
          } else {
            isValid = true;
          }
          break;
        }


        case "clinepass": {
          const headers = {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          };
          const modelsRes = await fetchWithTimeout(
            "https://api.cline.bot/api/v1/models",
            { method: "GET", headers }
          );
          if (modelsRes.ok) {
            isValid = true;
            break;
          }

          const chatRes = await fetchWithTimeout(
            "https://api.cline.bot/api/v1/chat/completions",
            {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "cline-pass/glm-5.2",
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1,
                stream: false,
              }),
            }
          );
          isValid = chatRes.status !== 401 && chatRes.status !== 403;
          break;
        }

        case "qoder": {

          try {
            const resolved = await resolveQoderCredentials({ apiKey, providerSpecificData }, null, AbortSignal.timeout(8000));
            const result = await resolveQoderModels(resolved, { forceRefresh: true });
            isValid = !!result?.models?.length;
          } catch (err) {
            logRouteError("ProviderValidation][Qoder", err);
            isValid = false;
            error = "Provider credentials could not be validated";
          }
          break;
        }

        default: {

          const cfg = PROVIDERS[provider];
          if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
            return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
          }
          if (cfg.noAuth) {
            isValid = true;
            break;
          }

          const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
          if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
          else headers["Authorization"] = `Bearer ${apiKey}`;

          const modelsUrl = cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
          let probeOk = null;
          try {
            const probeRes = await fetchWithTimeout(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
            if (probeRes.status === 401 || probeRes.status === 403) probeOk = false;
            else if (probeRes.ok) probeOk = true;
          } catch {                        }
          if (probeOk !== null) {
            isValid = probeOk;
            break;
          }

          const defaultModel = getDefaultModel(provider) || "test";
          const chatRes = await fetchWithTimeout(cfg.baseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
            signal: AbortSignal.timeout(10000),
          });
          isValid = chatRes.status !== 401 && chatRes.status !== 403;
          break;
        }
      }
    } catch (err) {
      error = validationErrorMessage(err);
      isValid = false;
    }

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : (error || "Invalid API key"),
    });
  } catch (error) {
    console.log("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
