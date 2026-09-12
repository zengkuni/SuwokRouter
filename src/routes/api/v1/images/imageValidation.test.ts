import { describe, expect, test } from "bun:test";
import { bodyBytesExceeded, isImageType, normalizeOutput, parseAllowlist, validateGenerationBody, validateOutput } from "./imageValidation.js";

describe("image validation", () => {
  test("normalizes array and string media allowlists", () => {
    expect([...parseAllowlist(["OpenAI", " foo "])]).toEqual(["openai", "foo"]);
    expect([...parseAllowlist("OpenAI, foo")]).toEqual(["openai", "foo"]);
  });

  test("validates generation fields", () => {
    expect(validateGenerationBody({ prompt: "draw", n: 2 }).value.n).toBe(2);
    expect(validateGenerationBody({ prompt: "draw", n: 5 }).error).toContain("between 1 and 4");
    expect(validateGenerationBody({ prompt: "draw", size: "bad" }).error).toContain("size");
    expect(validateGenerationBody({ prompt: "draw", response_format: "xml" }).error).toContain("response_format");
  });

  test("rejects malformed and oversized output", () => {
    expect(normalizeOutput({ b64_json: "abc" })).toEqual({ b64_json: "abc" });
    expect(normalizeOutput({ url: "https://example.test/image.png" })).toEqual({ url: "https://example.test/image.png" });
    expect(normalizeOutput({ url: "javascript:alert(1)" })).toBeNull();
    expect(validateOutput([])).toBe(false);
    expect(validateOutput([{ url: "https://example.test/image.png" }])).toBe(true);
  });

  test("validates image MIME and content length", () => {
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("image/gif")).toBe(true);
    expect(isImageType("application/pdf")).toBe(false);
    expect(bodyBytesExceeded(new Request("http://localhost", { headers: { "content-length": "100" } }), 99)).toBe(true);
  });
});
