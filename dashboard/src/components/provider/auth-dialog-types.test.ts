import { describe, expect, test } from "bun:test";
import { parseCodeBuddyTokenLines } from "./auth-dialog-types";

describe("CodeBuddy token line parser", () => {
  test("accepts single tokens and access/refresh pairs", () => {
    expect(parseCodeBuddyTokenLines("access-token\nrefresh-token\naccess|refresh")).toEqual([
      { credentialToken: "access-token", valid: null },
      { credentialToken: "refresh-token", valid: null },
      { accessToken: "access", refreshToken: "refresh", valid: null },
    ]);
  });

  test("trims values and rejects incomplete or multi-part rows", () => {
    expect(parseCodeBuddyTokenLines("  access | refresh  \naccess|\na|b|c")).toEqual([
      { accessToken: "access", refreshToken: "refresh", valid: null },
      { valid: false, msg: "Use one token or accessToken|refreshToken" },
      { valid: false, msg: "Use one token or accessToken|refreshToken" },
    ]);
  });
});
