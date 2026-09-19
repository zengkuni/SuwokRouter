import { describe, expect, test } from "bun:test";
import { KiroExecutor } from "./kiro.js";

describe("Kiro headers", () => {
  test("uses API key auth without sending it as an SSO bearer", () => {
    const headers = new KiroExecutor().buildHeaders({
      accessToken: "redacted-api-key",
      providerSpecificData: { authMethod: "api_key" },
    }, true, "https://q.us-east-1.amazonaws.com/generateAssistantResponse");

    expect(headers.Authorization).toBe("Bearer redacted-api-key");
    expect(headers.TokenType).toBe("API_KEY");
    expect(headers["x-amz-sso-bearer"]).toBeUndefined();
    expect(headers["x-amzn-kiro-agent-mode"]).toBe("vibe");
    expect(headers["x-amzn-codewhisperer-machine-id"]).toBe("kiro-desktop");
  });

  test("adds the SSO bearer for OAuth credentials", () => {
    const headers = new KiroExecutor().buildHeaders({
      accessToken: "redacted-access-token",
      providerSpecificData: { authMethod: "builder-id" },
    }, true, "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse");

    expect(headers.Authorization).toBe("Bearer redacted-access-token");
    expect(headers["x-amz-sso-bearer"]).toBe("redacted-access-token");
    expect(headers["X-Amz-Target"]).toBe(
      "AmazonCodeWhispererStreamingService.GenerateAssistantResponse"
    );
  });
});
