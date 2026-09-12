import { afterEach, describe, expect, it } from "bun:test";
import {
  buildCodeBuddyModelHeaders,
  decodeCodeBuddyJwtPayload,
  parseCodeBuddyConfig,
  resolveCodeBuddyModels,
} from "./codebuddyModels.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function tokenFor(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

describe("CodeBuddy model discovery", () => {
  it("loads chat models from the root catalog and carries remote capabilities", () => {
    const models = parseCodeBuddyConfig({
      data: {
        models: [
          {
            id: "gpt-5.6-sol",
            name: "GPT 5.6 Sol",
            supportsReasoning: true,
            reasoning: { supportedEfforts: ["low", "high"], canDisableThinking: false },
            maxInputTokens: 100000,
            maxOutputTokens: 20000,
          },
          { id: "image-only", name: "Image only", tags: ["text-to-image"] },
          { id: "root-chat-model", name: "Root chat model" },
        ],
      },
    });

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      id: "gpt-5.6-sol",
      name: "GPT 5.6 Sol",
      thinkingLevels: ["low", "high"],
      capabilities: {
        reasoning: true,
        thinkingCanDisable: false,
        contextWindow: 100000,
        maxOutput: 20000,
      },
    });
    expect(models[1].id).toBe("root-chat-model");
  });

  it("uses the token subject for the identity header without exposing the token", () => {
    const token = tokenFor({ sub: "user-123" });
    expect(decodeCodeBuddyJwtPayload(token)).toMatchObject({ sub: "user-123" });
    const headers = buildCodeBuddyModelHeaders("codebuddy-intl", token);

    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(headers["X-User-Id"]).toBe("user-123");
    expect(headers["X-Agent-Intent"]).toBe("cli");
  });

  it("loads the CodeBuddy catalog from /v3/config", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return Response.json({
        code: 0,
        data: {
          models: [{ id: "gpt-5.6-sol", name: "GPT 5.6 Sol" }],
          agents: [{ name: "cli", models: ["gpt-5.6-sol"] }],
        },
      });
    };

    const result = await resolveCodeBuddyModels({
      provider: "codebuddy-intl",
      accessToken: "access-token",
    });

    expect(requestedUrl).toBe("https://www.codebuddy.ai/v3/config");
    expect(result.models.map((model) => model.id)).toEqual(["gpt-5.6-sol"]);
  });
});
