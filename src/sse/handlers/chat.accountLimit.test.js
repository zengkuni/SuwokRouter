import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  settings: {
    requireApiKey: false,
    comboStrategy: "fallback",
    comboStickyRoundRobinLimit: 1,
    comboStrategies: { "combo-limit": { maxAccountAttempts: 2 } },
  },
  accounts: {},
  attempts: [],
  coreCalls: [],
};

mock.module("../services/auth.js", () => ({
  getProviderCredentials: async (_provider, excludeConnectionIds, model) => {
    const pool = state.accounts[model] || [];
    const account = pool.find((id) => !excludeConnectionIds.has(id));
    if (!account) return null;
    state.attempts.push(`${model}:${account}`);
    return { connectionId: account, connectionName: account, apiKey: "test-key" };
  },
  markAccountUnavailable: async () => ({ shouldFallback: true }),
  clearAccountError: async () => {},
  extractApiKey: () => "test-key",
  isValidApiKey: async () => true,
}));

mock.module("../../lib/localDb.js", () => ({
  getSettings: async () => state.settings,
  getProviderConnectionById: async () => null,
}));

mock.module("../services/model.js", () => ({
  getModelInfo: (model) => ({ provider: "testp", model }),
  getComboModels: async (name) => (name === "combo-limit" ? ["m1", "m2"] : null),
}));

mock.module("../services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_provider, credentials) => credentials,
  updateProviderCredentials: async () => {},
}));

mock.module("../../services/projectId.js", () => ({
  getProjectIdForConnection: async () => null,
}));

mock.module("../../handlers/chatCore.js", () => ({
  isTokenExpiringSoon: () => false,
  handleChatCore: async ({ modelInfo }) => {
    state.coreCalls.push(`${modelInfo.provider}/${modelInfo.model}`);
    if (modelInfo.model === "m1") {
      return {
        success: false,
        status: 500,
        error: "upstream exploded",
        response: new Response(JSON.stringify({ error: "upstream exploded" }), { status: 500 }),
      };
    }
    return {
      success: true,
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "m2 wins" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    };
  },
}));

const { handleChat } = await import("./chat.js");

function chatRequest() {
  return new Request("http://local.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer test-key" },
    body: JSON.stringify({ model: "combo-limit", messages: [{ role: "user", content: "hi" }] }),
  });
}

beforeEach(() => {
  state.attempts = [];
  state.coreCalls = [];
  state.accounts = {
    m1: ["a1", "a2", "a3", "a4"],
    m2: ["b1"],
  };
  state.settings.comboStrategies = { "combo-limit": { maxAccountAttempts: 2 } };
});

describe("combo account attempt limit", () => {
  test("maxAccountAttempts = 2 stops m1 after two failed accounts and moves to m2", async () => {
    const response = await handleChat(chatRequest());

    expect(response.status).toBe(200);
    expect(state.attempts.filter((entry) => entry.startsWith("m1:"))).toEqual(["m1:a1", "m1:a2"]);
    expect(state.attempts.filter((entry) => entry.startsWith("m2:"))).toEqual(["m2:b1"]);
    expect(state.coreCalls).toEqual(["testp/m1", "testp/m1", "testp/m2"]);
    expect(await response.text()).toContain("m2 wins");
  });

  test("maxAccountAttempts = 0 tries every account before moving on", async () => {
    state.settings.comboStrategies = { "combo-limit": { maxAccountAttempts: 0 } };

    const response = await handleChat(chatRequest());

    expect(response.status).toBe(200);
    expect(state.attempts.filter((entry) => entry.startsWith("m1:"))).toEqual([
      "m1:a1",
      "m1:a2",
      "m1:a3",
      "m1:a4",
    ]);
  });
});
