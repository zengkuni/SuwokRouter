import { describe, expect, test } from "bun:test";
import { createProviderNode, deleteProviderNode } from "./nodesRepo.js";

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
