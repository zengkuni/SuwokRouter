import { describe, expect, test } from "bun:test";
import { createProviderNode, deleteProviderNode, getProviderNodeById, updateProviderNode } from "./nodesRepo.js";

describe("custom provider identity", () => {
  test("rejects duplicate names and prefixes case-insensitively", async () => {
    const suffix = crypto.randomUUID();
    const firstId = `repo-test-node-${suffix}`;
    const prefix = `repo-test-prefix-${suffix}`;

    try {
      const first = await createProviderNode({
        id: firstId,
        type: "openai-compatible",
        name: `Provider ${suffix}`,
        prefix,
        apiType: "chat",
        baseUrl: "https://example.test/v1",
      });

      await expect(createProviderNode({
        id: `repo-test-node-name-${suffix}`,
        type: "openai-compatible",
        name: ` provider ${suffix} `,
        prefix: `other-prefix-${suffix}`,
        apiType: "chat",
        baseUrl: "https://example.test/v1",
      })).rejects.toMatchObject({ code: "DUPLICATE_PROVIDER_NODE" });

      await expect(createProviderNode({
        id: `repo-test-node-prefix-${suffix}`,
        type: "anthropic-compatible",
        name: `Other ${suffix}`,
        prefix: prefix.toUpperCase(),
        baseUrl: "https://example.test/v1",
      })).rejects.toMatchObject({ code: "DUPLICATE_PROVIDER_NODE" });

      await deleteProviderNode(first.id);
    } finally {
      await deleteProviderNode(firstId);
      await deleteProviderNode(`repo-test-node-name-${suffix}`);
      await deleteProviderNode(`repo-test-node-prefix-${suffix}`);
    }
  });
});

describe("custom provider icon", () => {
  test("stores an Icon URL and clears it when omitted", async () => {
    const suffix = crypto.randomUUID();
    const id = `repo-test-icon-${suffix}`;

    try {
      await createProviderNode({
        id,
        type: "openai-compatible",
        name: `Icon ${suffix}`,
        prefix: `repo-test-icon-${suffix}`,
        apiType: "chat",
        baseUrl: "https://example.test/v1",
        iconUrl: "  https://cdn.example.test/logo.png  ",
      });

      expect((await getProviderNodeById(id))?.iconUrl).toBe("https://cdn.example.test/logo.png");

      await updateProviderNode(id, { iconUrl: undefined });

      expect((await getProviderNodeById(id))?.iconUrl).toBeUndefined();
    } finally {
      await deleteProviderNode(id);
    }
  });
});
