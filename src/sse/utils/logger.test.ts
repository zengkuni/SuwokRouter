import { describe, expect, test } from "bun:test";
import { formatLine } from "./logger.js";

describe("console logger formatting", () => {
  test("uses stable text labels and request correlation", () => {
    const line = formatLine("R3", "RESPONSE", "CLINEPASS 200 · 1264ms");
    expect(line).toContain("R3 RESPONSE CLINEPASS 200 · 1264ms");
    expect(line).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
