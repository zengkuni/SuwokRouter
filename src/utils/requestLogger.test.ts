import { describe, expect, test } from "bun:test";

const previous = process.env.ENABLE_REQUEST_LOGS;
process.env.ENABLE_REQUEST_LOGS = "false";
const { createRequestLogger } = await import("./requestLogger.js");

if (previous === undefined) delete process.env.ENABLE_REQUEST_LOGS;
else process.env.ENABLE_REQUEST_LOGS = previous;

describe("request logger", () => {
  test("is disabled by default and exposes a no-op logger", async () => {
    const logger = await createRequestLogger("openai", "openai", "test-model") as any;
    expect(logger.sessionPath).toBeNull();
    expect(() => logger.logTargetRequest("https://example.test", {
      authorization: "Bearer should-not-be-written",
      cookie: "session=secret",
    }, { apiKey: "secret" })).not.toThrow();
  });
});
