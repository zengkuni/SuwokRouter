import { describe, expect, it } from "bun:test";
import { convertGrokSsoToBuild } from "./grokSsoBuild.js";

describe("convertGrokSsoToBuild input guard", () => {
  it("rejects an empty cookie before any network work", async () => {
    expect(await convertGrokSsoToBuild("")).toEqual({
      ok: false,
      error: "Grok SSO cookie is empty",
      status: 400,
    });
  });

  it("rejects a whitespace-only cookie before any network work", async () => {
    const result = await convertGrokSsoToBuild("   \n ");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Grok SSO cookie is empty");
  });
});
