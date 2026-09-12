import { describe, expect, test } from "bun:test";
import {
  createOAuthCallbackMessage,
  getOAuthCallbackTargetOrigins,
  parseOAuthCallbackInput,
  parseOAuthCallbackMessage,
  parseOAuthCallbackSearch,
  parseOAuthCallbackStorageValue,
  validateOAuthCallbackMessage,
} from "./oauth-callback";

describe("OAuth callback transport", () => {
  test("accepts a bare authorization code for the active session", () => {
    expect(parseOAuthCallbackInput("  callback-code  ", "state-1")).toEqual({
      code: "callback-code",
      state: "state-1",
    });
  });

  test("extracts and validates a full loopback callback URL", () => {
    expect(
      parseOAuthCallbackInput(
        "http://127.0.0.1:14045/callback?state=state-1&code=callback-code&scope=email",
        "state-1",
      ),
    ).toEqual({ code: "callback-code", state: "state-1" });
  });

  test("rejects stale, incomplete, and failed callback URLs", () => {
    expect(() =>
      parseOAuthCallbackInput(
        "http://localhost:14045/callback?state=stale&code=callback-code",
        "state-1",
      ),
    ).toThrow("different OAuth session");
    expect(() =>
      parseOAuthCallbackInput(
        "http://localhost:14045/callback?state=state-1",
        "state-1",
      ),
    ).toThrow("does not contain an authorization code");
    expect(() =>
      parseOAuthCallbackInput(
        "http://localhost:14045/callback?state=state-1&error=access_denied&error_description=Denied",
        "state-1",
      ),
    ).toThrow("Denied");
  });

  test("targets both exact loopback aliases without using a wildcard", () => {
    expect(getOAuthCallbackTargetOrigins("http://localhost:14045")).toEqual([
      "http://localhost:14045",
      "http://127.0.0.1:14045",
    ]);
    expect(getOAuthCallbackTargetOrigins("https://router.example.com")).toEqual([
      "https://router.example.com",
    ]);
    expect(getOAuthCallbackTargetOrigins("not-an-origin")).toEqual([]);
  });

  test("parses only callback fields from the query string", () => {
    const result = parseOAuthCallbackSearch(
      "?code=callback-code&state=state-1&error_description=ignored%20description&unused=1",
    );
    expect(result).toEqual({
      code: "callback-code",
      state: "state-1",
      errorDescription: "ignored description",
    });
    expect(result).not.toHaveProperty("unused");
  });

  test("supports the current and nested callback message shape", () => {
    const message = createOAuthCallbackMessage({
      code: "callback-code",
      state: "state-1",
      provider: "antigravity",
    });
    expect(parseOAuthCallbackMessage(message)).toEqual({
      code: "callback-code",
      state: "state-1",
      provider: "antigravity",
    });
    expect(
      parseOAuthCallbackMessage({
        source: "sway-oauth",
        type: "oauth_callback",
        data: { code: "nested-code", state: "state-2" },
      }),
    ).toEqual({ code: "nested-code", state: "state-2" });
  });

  test("parses the opener-less same-origin storage fallback", () => {
    const storedAt = 10_000;
    const value = JSON.stringify({
      payload: { code: "stored-code", state: "state-1" },
      storedAt,
    });

    expect(parseOAuthCallbackStorageValue(value, storedAt + 1_000)).toEqual({
      code: "stored-code",
      state: "state-1",
    });
    expect(parseOAuthCallbackStorageValue(value, storedAt + 10 * 60 * 1000 + 1)).toBeNull();
    expect(parseOAuthCallbackStorageValue("not-json", storedAt)).toBeNull();
  });

  test("rejects wrong source, origin, popup, provider, and state", () => {
    const message = createOAuthCallbackMessage({
      code: "callback-code",
      state: "state-1",
      provider: "antigravity",
    });
    const popup = {};
    const options = {
      origin: "http://localhost:14045",
      eventOrigin: "http://localhost:14045",
      expectedState: "state-1",
      expectedProvider: "antigravity",
      eventSource: popup,
      expectedSource: popup,
    };
    expect(validateOAuthCallbackMessage(message, options)).toMatchObject({
      code: "callback-code",
    });
    expect(
      validateOAuthCallbackMessage(message, { ...options, eventOrigin: "https://evil.test" }),
    ).toBeNull();
    expect(
      validateOAuthCallbackMessage(message, { ...options, eventSource: {} }),
    ).toBeNull();
    expect(
      validateOAuthCallbackMessage(message, { ...options, expectedProvider: "claude" }),
    ).toBeNull();
    expect(
      validateOAuthCallbackMessage(message, { ...options, expectedState: "stale" }),
    ).toBeNull();
    expect(
      validateOAuthCallbackMessage({ ...message, source: "other" }, options),
    ).toBeNull();
  });

  test("requires state for provider errors and accepts matching errors", () => {
    const message = createOAuthCallbackMessage({
      error: "access_denied",
      errorDescription: "Authorization was denied",
      state: "state-1",
    });
    const options = {
      origin: "http://localhost:14045",
      eventOrigin: "http://localhost:14045",
      expectedState: "state-1",
    };
    expect(validateOAuthCallbackMessage(message, options)).toMatchObject({
      error: "access_denied",
    });
    expect(
      validateOAuthCallbackMessage(
        createOAuthCallbackMessage({ error: "access_denied" }),
        options,
      ),
    ).toBeNull();
  });
});
