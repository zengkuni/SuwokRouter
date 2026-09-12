import { NextResponse } from "next/server";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias, resolveProviderId } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

function publicModelId(provider, model) {
  const value = String(model || "").trim();
  if (provider === "clinepass" || provider === "cline-pass") {
    return value.replace(/^(?:clinepass|cline-pass)\//, "");
  }
  return value;
}

export async function GET() {
  try {
    const disabled = await getDisabledModels();

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const publicModel = publicModelId(m.provider, m.model);
        const fullModel = `${m.provider}/${publicModel}`;
        const providerAlias = getProviderAlias(m.provider) || m.provider;
        const routedModel = `${providerAlias}/${publicModel}`;
        const providerId = resolveProviderId(m.provider);
        const c = getCapabilitiesForModel(providerId, m.model);
        const thinkingLevels = getThinkingLevels(providerId, m.model);
        return {
          ...m,
          fullModel,
          routedModel,
          name: m.name || publicModel,
          thinkingLevels,
          caps: {
            vision: c.vision,
            pdf: c.pdf,
            audioInput: c.audioInput,
            videoInput: c.videoInput,
            imageOutput: c.imageOutput,
            audioOutput: c.audioOutput,
            search: c.search,
            tools: c.tools,
            reasoning: c.reasoning,
            thinkingFormat: c.thinkingFormat,
            thinkingCanDisable: c.thinkingCanDisable,
            thinkingRange: c.thinkingRange,
            contextWindow: c.contextWindow,
            maxOutput: c.maxOutput,
          },
        };
      });

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
