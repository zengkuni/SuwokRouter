import { describe, expect, it } from "bun:test";
import { formatCliConfig, maskConfigSecret } from "./cli-config";

describe("cli config formatter", () => {
  it("masks secrets by default and normalizes OpenCode models", () => {
    const result = formatCliConfig({
      toolId: "opencode",
      baseUrl: "http://127.0.0.1:14045",
      apiKey: "sk-secret-value",
      models: ["clinepass/glm-5.2", "openai/gpt-5"],
      primaryModel: "openai/gpt-5",
      subagentModel: "clinepass/glm-5.2",
    });

    const parsed = JSON.parse(result.content) as Record<string, any>;
    expect(result.fileName).toBe("opencode.json");
    expect(result.modelCount).toBe(2);
    expect(parsed.provider.swayrouter.options.baseURL).toBe("http://127.0.0.1:14045/v1");
    expect(parsed.provider.swayrouter.models["clinepass/glm-5.2"]).toBeTruthy();
    expect(parsed.model).toBe("swayrouter/openai/gpt-5");
    expect(parsed.agent.explorer.model).toBe("swayrouter/clinepass/glm-5.2");
    expect(result.content).not.toContain("sk-secret-value");
  });

  it("reveals the key only when requested", () => {
    const result = formatCliConfig({
      toolId: "claude",
      baseUrl: "http://localhost:14045/v1",
      apiKey: "sk-secret-value",
      models: ["claude/sonnet"],
      primaryModel: "claude/sonnet",
    }, true);

    expect(result.content).toContain('ANTHROPIC_AUTH_TOKEN="sk-secret-value"');
    expect(result.content).toContain('ANTHROPIC_BASE_URL="http://localhost:14045"');
  });

  it("allows endpoint config without inventing a model", () => {
    const result = formatCliConfig({
      toolId: "codex",
      baseUrl: "http://localhost:14045/v1",
      apiKey: "sk-key",
    });

    expect(result.complete).toBe(true);
    expect(result.content).toContain('model_provider = "swayrouter"');
    expect(result.content).not.toContain('model = ""');
  });

  it("uses OMP discovery and preserves selected model entries", () => {
    const result = formatCliConfig({
      toolId: "omp",
      baseUrl: "http://localhost:14045",
      apiKey: "sk-key",
      models: ["clinepass/glm-5.2", "openai/gpt-5"],
    });
    expect(result.complete).toBe(true);
    expect(result.modelCount).toBe(2);
    expect(result.content).toContain("openai-models-list");
    expect(result.content).toContain('id: "clinepass/glm-5.2"');
    expect(result.content).toContain('name: "openai/gpt-5"');
    expect(result.content).not.toContain("\nmodel:");
  });

  it("writes a masked OMP apiKey when a gateway key is configured", () => {
    const result = formatCliConfig({
      toolId: "omp",
      baseUrl: "http://localhost:14045/v1",
      apiKey: "sk-secret-value",
    });
    expect(result.content).toContain("apiKey: \"sk-s•••••••••••\"");
    expect(result.content).not.toContain("sk-secret-value");
  });

  it("keeps OMP keyless when no gateway key is available", () => {
    const result = formatCliConfig({
      toolId: "omp",
      baseUrl: "http://localhost:14045/v1",
      apiKey: "",
    });
    expect(result.content).toContain("auth: none");
  });

  it("masks short and long keys deterministically", () => {
    expect(maskConfigSecret("abc")).toBe("•••");
    expect(maskConfigSecret("sk-123456789")).toBe("sk-1••••••••");
  });
});
