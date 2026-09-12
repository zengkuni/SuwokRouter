import { describe, expect, test } from "bun:test";
import { appendStreamPreview, MAX_STREAM_COMPLETION_PREVIEW_CHARS } from "./stream.js";

describe("stream completion preview", () => {
  test("keeps the preview bounded while preserving the beginning", () => {
    const preview = appendStreamPreview("", "a".repeat(MAX_STREAM_COMPLETION_PREVIEW_CHARS + 4096));
    expect(preview.length).toBe(MAX_STREAM_COMPLETION_PREVIEW_CHARS);
    expect(preview).toBe("a".repeat(MAX_STREAM_COMPLETION_PREVIEW_CHARS));
    expect(appendStreamPreview(preview, "tail")).toBe(preview);
  });

  test("appends incremental chunks until the cap", () => {
    expect(appendStreamPreview("hello", " world", 11)).toBe("hello world");
    expect(appendStreamPreview("hello world", "!", 11)).toBe("hello world");
  });
});
