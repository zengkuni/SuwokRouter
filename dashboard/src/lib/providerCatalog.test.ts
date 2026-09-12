import { describe, expect, test } from "bun:test";
import { compactErrorReason } from "@/pages/Provider";

describe("provider catalog error labels", () => {
  test("extracts a useful reason from JSON errors", () => {
    expect(compactErrorReason('{"error":{"message":"Unauthorized"}}')).toBe("Unauthorized");
  });

  test("removes transport prefixes and truncates long reasons", () => {
    expect(compactErrorReason("status 401: Error: invalid credentials.")).toBe("Error: invalid credentials");
    expect(compactErrorReason("x".repeat(60), 12)).toBe("xxxxxxxxxxx…");
  });
});
