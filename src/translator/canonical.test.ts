import { describe, expect, test } from "bun:test";
import {
  inferFeatureIntent,
  normalizeTranslationRequest,
  resolveTranslationSurface,
  unsupportedFeatures,
} from "./canonical.js";

describe("canonical translation layer", () => {
  test("extracts feature intent without changing the request", () => {
    const body = {
      model: "gpt-5",
      tools: [{ type: "function" }],
      reasoning_effort: "high",
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "x" } }] }],
    };
    expect(inferFeatureIntent(body)).toEqual({
      tools: true,
      reasoning: true,
      images: true,
      audio: false,
      video: false,
      cache: false,
      usage: true,
    });
    const normalized = normalizeTranslationRequest({ body, sourceFormat: "openai", model: "gpt-5", provider: "openai" });
    expect(normalized.body).toEqual(body);
    expect(normalized.features.images).toBe(true);
  });

  test("resolves provider capabilities and reports unsupported optional features", () => {
    const surface = resolveTranslationSurface({ provider: "openai", model: "gpt-5", clientFormat: "openai" });
    expect((surface.capabilities as { reasoning?: boolean }).reasoning).toBe(true);
    expect(unsupportedFeatures({ images: true, reasoning: true, tools: true }, surface.capabilities)).toEqual([]);
    expect(unsupportedFeatures({ images: true, audio: true }, { vision: false, audioInput: false })).toEqual(["images", "audio"]);
  });
});
