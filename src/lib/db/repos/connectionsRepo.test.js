import { describe, expect, test } from "bun:test";
import { createProviderConnection, deleteProviderConnection, updateProviderConnection } from "./connectionsRepo.js";

describe("provider connection identity", () => {
  test("allocates unnamed accounts and rejects duplicate keys", async () => {
    const provider = `repo-test-${crypto.randomUUID()}`;
    const createdIds = [];

    try {
      const first = await createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "  test-secret-1  ",
        autoName: true,
      });
      createdIds.push(first.id);
      expect(first.name).toBe("suwokrouter-account");

      const second = await createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "test-secret-2",
        autoName: true,
      });
      createdIds.push(second.id);
      expect(second.name).toBe("suwokrouter-account1");

      const bulkFirst = await createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "test-secret-3",
        name: "suwokrouter-account1",
        autoName: true,
      });
      createdIds.push(bulkFirst.id);
      expect(bulkFirst.name).toBe("suwokrouter-account2");

      await expect(createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "test-secret-1",
        name: "another-name",
      })).rejects.toMatchObject({ code: "DUPLICATE_API_KEY" });
    } finally {
      for (const id of createdIds) await deleteProviderConnection(id);
    }
  });

  test("labels CodeBuddy accounts with the collected email, then codebuddy-N", async () => {
    const provider = "codebuddy-cn";
    const createdIds = [];

    try {
      const withEmail = await createProviderConnection({
        provider,
        authType: "oauth",
        accessToken: `codebuddy-access-${crypto.randomUUID()}`,
        email: "budi@example.com",
        displayName: "Budi",
        providerSpecificData: { authMethod: "device" },
      });
      createdIds.push(withEmail.id);
      expect(withEmail.name).toBe("budi@example.com");

      const withNameOnly = await createProviderConnection({
        provider,
        authType: "oauth",
        accessToken: `codebuddy-access-${crypto.randomUUID()}`,
        displayName: "Siti",
        providerSpecificData: { authMethod: "device" },
      });
      createdIds.push(withNameOnly.id);
      expect(withNameOnly.name).toBe("Siti");

      const firstAnonymous = await createProviderConnection({
        provider,
        authType: "oauth",
        accessToken: `codebuddy-access-${crypto.randomUUID()}`,
        providerSpecificData: { authMethod: "device" },
      });
      createdIds.push(firstAnonymous.id);
      expect(firstAnonymous.name).toMatch(/^CodeBuddy-\d+$/);

      const secondAnonymous = await createProviderConnection({
        provider,
        authType: "oauth",
        accessToken: `codebuddy-access-${crypto.randomUUID()}`,
        providerSpecificData: { authMethod: "device" },
      });
      createdIds.push(secondAnonymous.id);
      expect(secondAnonymous.name).toMatch(/^CodeBuddy-\d+$/);
      expect(secondAnonymous.name).not.toBe(firstAnonymous.name);

      const namedByOperator = await createProviderConnection({
        provider,
        authType: "oauth",
        accessToken: `codebuddy-access-${crypto.randomUUID()}`,
        name: "Pool A",
        email: "other@example.com",
        providerSpecificData: { authMethod: "device" },
      });
      createdIds.push(namedByOperator.id);
      expect(namedByOperator.name).toBe("Pool A");
    } finally {
      for (const id of createdIds) await deleteProviderConnection(id);
    }
  });

  test("does not overwrite a connection with a duplicate account name", async () => {
    const provider = `repo-test-${crypto.randomUUID()}`;
    const createdIds = [];

    try {
      const first = await createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "test-name-secret-1",
        name: "Backend A",
      });
      createdIds.push(first.id);

      await expect(createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "test-name-secret-2",
        name: " backend a ",
      })).rejects.toMatchObject({ code: "DUPLICATE_CONNECTION_NAME" });

      await expect(updateProviderConnection(first.id, {
        apiKey: "test-name-secret-2",
      })).resolves.toMatchObject({ id: first.id });
    } finally {
      for (const id of createdIds) await deleteProviderConnection(id);
    }
  });
});
