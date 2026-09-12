import { describe, expect, test } from "bun:test";
import { isGracefulNetworkClose } from "./streamHandler.js";

describe("stream transport error classification", () => {
  test("recognizes undici socket errors and peer-close messages", () => {
    expect(isGracefulNetworkClose({ code: "UND_ERR_SOCKET" })).toBe(true);
    expect(isGracefulNetworkClose({ message: "other side closed" })).toBe(true);
    expect(isGracefulNetworkClose({ message: "Fetch failed", cause: { code: "ECONNRESET" } })).toBe(true);
  });

  test("recognizes common stream transport failures case-insensitively", () => {
    expect(isGracefulNetworkClose({ message: "socket hang up" })).toBe(true);
    expect(isGracefulNetworkClose({ code: "ERR_STREAM_PREMATURE_CLOSE" })).toBe(true);
    expect(isGracefulNetworkClose({ message: "ETIMEDOUT while reading" })).toBe(true);
  });

  test("does not classify unrelated transform failures as network closes", () => {
    expect(isGracefulNetworkClose(new Error("invalid SSE payload"))).toBe(false);
  });

  test("recognizes AbortError as a graceful cancellation", () => {
    expect(isGracefulNetworkClose(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
  });
});
