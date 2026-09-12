import { afterEach, describe, expect, test } from "bun:test";
import { api } from "./api";
import { connectCliTool, fetchCliModelMappings, resetCliTool, saveCliModelMappings } from "./cli-tools-api";

const originalGet = api.get.bind(api);
const originalPut = api.put.bind(api);
const originalPost = api.post.bind(api);
const originalDelete = api.delete.bind(api);

describe("CLI model mapping API", () => {
  test("normalizes fetched snapshots", async () => {
    api.get = (async () => ({
      data: {
        mappings: {
          claude: {
            enabled: true,
            entries: [
              { sourceModel: "  sonnet ", targetModel: " openai/gpt-5 ", enabled: false },
              { sourceModel: "", targetModel: "ignored" },
            ],
          },
        },
      },
    })) as typeof api.get;

    await expect(fetchCliModelMappings()).resolves.toEqual({
      claude: {
        enabled: true,
        entries: [{ sourceModel: "sonnet", targetModel: "openai/gpt-5", enabled: false }],
      },
    });
  });

  test("sends mappings and returns server snapshot", async () => {
    let requestBody: unknown;
    api.put = (async (_url, body) => {
      requestBody = body;
      return { data: { mappings: { codex: { enabled: false, entries: [] } } } };
    }) as typeof api.put;

    const result = await saveCliModelMappings({
      codex: { enabled: true, entries: [{ sourceModel: "gpt-5", targetModel: "openai/gpt-5", enabled: true }] },
    });
    expect(requestBody).toEqual({ mappings: {
      codex: { enabled: true, entries: [{ sourceModel: "gpt-5", targetModel: "openai/gpt-5", enabled: true }] },
    } });
    expect(result).toEqual({ codex: { enabled: false, entries: [] } });
  });

  test("passes the Claude Exa MCP toggle instead of forcing it on", async () => {
    let requestBody: unknown;
    api.post = (async (_url, body) => {
      requestBody = body;
      return { data: { success: true } };
    }) as typeof api.post;

    await connectCliTool("claude", {
      baseUrl: "http://localhost:14045",
      apiKey: "sk-test",
      sonnetModel: "openai/gpt-5",
      exaMcpEnabled: false,
    });

    expect(requestBody).toMatchObject({ exaMcpEnabled: false });

    await connectCliTool("claude", {
      baseUrl: "http://localhost:14045",
      apiKey: "sk-test",
      sonnetModel: "openai/gpt-5",
    });

    expect(requestBody).toMatchObject({ exaMcpEnabled: true });
  });

  test("resets a CLI tool through its settings endpoint", async () => {
    let requestUrl = "";
    api.delete = (async (url) => {
      requestUrl = url;
      return { data: { success: true, message: "Settings reset successfully" } };
    }) as typeof api.delete;

    await expect(resetCliTool("codex")).resolves.toMatchObject({
      id: "codex",
      connected: false,
      detail: "Settings reset successfully",
    });
    expect(requestUrl).toBe("/cli-tools/codex-settings");
  });
});

afterEach(() => {
  api.get = originalGet;
  api.put = originalPut;
  api.post = originalPost;
  api.delete = originalDelete;
});
