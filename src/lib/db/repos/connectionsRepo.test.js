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
      expect(first.name).toBe("swayrouter-account");

      const second = await createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "test-secret-2",
        autoName: true,
      });
      createdIds.push(second.id);
      expect(second.name).toBe("swayrouter-account1");

      const bulkFirst = await createProviderConnection({
        provider,
        authType: "apikey",
        apiKey: "test-secret-3",
        name: "swayrouter-account1",
        autoName: true,
      });
      createdIds.push(bulkFirst.id);
      expect(bulkFirst.name).toBe("swayrouter-account2");

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
