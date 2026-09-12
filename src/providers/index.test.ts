import { describe, expect, test } from "bun:test";
import REGISTRY from "./registry/index.js";
import {
  AI_PROVIDERS,
  APIKEY_PROVIDERS,
  NO_AUTH_PROVIDERS,
  OAUTH_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  getProviderByAlias,
  getProviderAlias,
  resolveProviderId,
  ALIAS_TO_ID,
  ID_TO_ALIAS,
} from "./display";

const EXPECTED_TOTAL = 65;

describe("registry", () => {
  test("total entries = 65", () => {
    expect(REGISTRY.length, `registry length`).toBe(EXPECTED_TOTAL);
  });

  test("Agent Router is registered with OpenAI and Claude transports", () => {
    const agentRouter = REGISTRY.find((entry) => entry.id === "agentrouter") as {
      display?: { name?: string };
      category?: string;
      transports?: Array<{ format?: string; baseUrl?: string }>;
      passthroughModels?: boolean;
    } | undefined;
    expect(agentRouter?.display?.name).toBe("Agent Router");
    expect(agentRouter?.category).toBe("apikey");
    expect(agentRouter?.passthroughModels).toBe(true);
    expect(agentRouter?.transports?.map((transport) => transport.format)).toEqual(["openai", "claude"]);
    expect(agentRouter?.transports?.find((transport) => transport.format === "openai")?.baseUrl)
      .toBe("https://agentrouter.org/v1/chat/completions");
    expect(agentRouter?.transports?.find((transport) => transport.format === "claude")?.baseUrl)
      .toBe("https://agentrouter.org/v1/messages");
  });

  test("Perplexity AI uses the Router API with one visible provider", () => {
    const perplexity = REGISTRY.find((entry) => entry.id === "perplexity") as {
      display?: { name?: string };
      category?: string;
      authType?: string;
      passthroughModels?: boolean;
      transport?: { baseUrl?: string; validateUrl?: string };
      transports?: Array<{ format?: string; baseUrl?: string }>;
    } | undefined;
    expect(perplexity?.display?.name).toBe("Perplexity AI");
    expect(perplexity?.category).toBe("apikey");
    expect(perplexity?.authType).toBe("apikey");
    expect(perplexity?.passthroughModels).toBe(true);
    expect(perplexity?.transport?.baseUrl).toBe("https://api.perplexity.ai/router/v1/chat/completions");
    expect(perplexity?.transport?.validateUrl).toBe("https://api.perplexity.ai/router/v1/models");
    expect(perplexity?.transports?.map((transport) => transport.format)).toEqual([
      "openai",
      "openai-responses",
      "claude",
    ]);
  });

  test("Meta AI terdaftar sebagai provider OpenAI-compatible passthrough", () => {
    const meta = REGISTRY.find((entry) => entry.id === "meta") as {
      display?: { name?: string };
      alias?: string;
      category?: string;
      transport?: { baseUrl?: string; openaiCompatible?: boolean };
      passthroughModels?: boolean;
      models?: unknown[];
    } | undefined;
    expect(meta?.display?.name).toBe("Meta AI");
    expect(meta?.alias).toBe("meta");
    expect(meta?.category).toBe("apikey");
    expect(meta?.transport?.baseUrl).toBe("https://api.meta.ai/v1/chat/completions");
    expect(meta?.transport?.openaiCompatible).toBe(true);
    expect(meta?.passthroughModels).toBe(true);
    expect(meta?.models).toEqual([]);
  });

  test("SumoPod terdaftar sebagai provider OpenAI-compatible", () => {
    const sumopod = REGISTRY.find((entry) => entry.id === "sumopod") as {
      display?: { name?: string; icon?: string };
      alias?: string;
      category?: string;
      transport?: { baseUrl?: string; validateUrl?: string; format?: string; openaiCompatible?: boolean };
      models?: Array<{ id?: string }>;
      passthroughModels?: boolean;
    } | undefined;
    expect(sumopod?.display?.name).toBe("SumoPod");
    expect(sumopod?.display?.icon).toBe("sumopod");
    expect(sumopod?.alias).toBe("sumopod");
    expect(sumopod?.category).toBe("apikey");
    expect(sumopod?.transport?.baseUrl).toBe("https://ai.sumopod.com/v1/chat/completions");
    expect(sumopod?.transport?.validateUrl).toBe("https://ai.sumopod.com/v1/models");
    expect(sumopod?.transport?.format).toBe("openai");
    expect(sumopod?.transport?.openaiCompatible).toBe(true);
    expect(sumopod?.passthroughModels).toBe(true);
    expect(sumopod?.models?.map((model) => model.id)).toContain("gpt-5.6-sol");
    expect(sumopod?.models?.map((model) => model.id)).toContain("text-embedding-3-large");
  });

  test("ids unik (nol duplikat)", () => {
    const ids = REGISTRY.map((r) => r.id);
    expect(new Set(ids).size, `unique ids`).toBe(ids.length);
  });

  test("trae/windsurf ikut ter-adopt (devin-cli/iflow/zed/sambanova/bluesminds/mmf dihapus)", () => {
    const ids = REGISTRY.map((r) => r.id);
    for (const id of ["trae", "windsurf"]) {
      expect(ids, `contains ${id}`).toContain(id);
    }
    for (const id of ["devin-cli", "iflow", "zed", "sambanova", "bluesminds", "mmf", "llm7", "tokenrouter"]) {
      expect(ids, `removed ${id}`).not.toContain(id);
    }
  });

  test("semua entry punya id, display, category (alias di-layer build)", () => {
    for (const r of REGISTRY) {
      expect(typeof r.id, `id ${r.id}`).toBe("string");
      expect(r.display?.name, `display name ${r.id}`).toBeTruthy();
      expect(
        ["apikey", "oauth", "webCookie", "none"],
        `category ${r.id}`,
      ).toContain(r.category);
    }
  });

  test("tiap kategori totalnya sesuai registry (apikey/oauth/webCookie/none)", () => {
    expect(Object.keys(APIKEY_PROVIDERS).length, `apikey count`).toBe(44);
    expect(Object.keys(OAUTH_PROVIDERS).length, `oauth count`).toBe(19);
    expect(Object.keys(WEB_COOKIE_PROVIDERS).length, `webCookie count`).toBe(1);
    expect(Object.keys(NO_AUTH_PROVIDERS).length, `none count`).toBe(1);
  });
});

describe("AI_PROVIDERS", () => {
  test("all ids map", () => {
    const ids = Object.keys(AI_PROVIDERS);
    expect(ids.length, `AI_PROVIDERS length`).toBe(EXPECTED_TOTAL);
    for (const r of REGISTRY) {
      expect(ids, `AI_PROVIDERS contains ${r.id}`).toContain(r.id);
    }
  });

  test("semua entry punya alias + service", () => {
    for (const p of Object.values(AI_PROVIDERS)) {
      expect(p.alias, `alias ${p.id}`).toBeTruthy();
      expect(
        ["llm", "search", "embeddings", "image", "audio"],
        `service ${p.id}`,
      ).toContain(p.service);
    }
  });

});

describe("helpers", () => {
  test("getProviderByAlias", () => {
    expect(getProviderByAlias("openai")?.id, `alias openai`).toBe("openai");
    expect(getProviderByAlias("nvidia")?.id, `alias nvidia`).toBe("nvidia");

    expect(getProviderByAlias("gitlab"), `alias gitlab dihapus`).toBeNull();
    expect(getProviderByAlias("tidak-ada"), `alias tidak ada`).toBeNull();
  });

  test("resolveProviderId", () => {
    expect(resolveProviderId("nvidia"), `resolve nvidia`).toBe("nvidia");
    expect(resolveProviderId("openai"), `resolve openai`).toBe("openai");
    expect(resolveProviderId("unknown"), `resolve unknown`).toBe("unknown");
  });

  test("getProviderAlias", () => {
    expect(getProviderAlias("nvidia"), `alias for nvidia`).toBe("nvidia");
    expect(getProviderAlias("openai"), `alias for openai`).toBe("openai");
    expect(getProviderAlias("unknown"), `alias for unknown`).toBe("unknown");
  });

  test("ALIAS_TO_ID / ID_TO_ALIAS saling konsisten", () => {
    expect(ALIAS_TO_ID["nvidia"], `ALIAS_TO_ID nvidia`).toBe("nvidia");
    expect(ID_TO_ALIAS["nvidia"], `ID_TO_ALIAS nvidia`).toBe("nvidia");
  });

});
