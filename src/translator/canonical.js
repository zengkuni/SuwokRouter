import { FORMATS } from "./formats.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { detectClientFormat } from "./detection.js";

const FEATURE_KEYS = ["tools", "reasoning", "images", "audio", "video", "cache", "usage"];

function clone(value) {
  if (value == null || typeof value !== "object") return value;
  return structuredClone(value);
}

function hasImages(body) {
  return Array.isArray(body?.messages) && body.messages.some((message) =>
    Array.isArray(message?.content) && message.content.some((part) =>
      part?.type === "image_url" || part?.type === "image" || part?.source?.type === "base64",
    ),
  );
}

function hasAudio(body) {
  return Array.isArray(body?.messages) && body.messages.some((message) =>
    Array.isArray(message?.content) && message.content.some((part) =>
      part?.type === "audio" || part?.type === "input_audio" || part?.type === "audio_url",
    ),
  );
}

function hasVideo(body) {
  return Array.isArray(body?.messages) && body.messages.some((message) =>
    Array.isArray(message?.content) && message.content.some((part) => part?.type === "video"),
  );
}

export function inferFeatureIntent(body = {}) {
  return {
    tools: Array.isArray(body.tools) && body.tools.length > 0,
    reasoning: body.reasoning !== undefined || body.reasoning_effort !== undefined || body.thinking !== undefined,
    images: hasImages(body),
    audio: hasAudio(body),
    video: hasVideo(body),
    cache: Boolean(body.prompt_cache_options || body.prompt_cache_breakpoint || body.cache_control),
    usage: body.stream_options?.include_usage === true,
  };
}

export function normalizeTranslationRequest({ body = {}, sourceFormat = FORMATS.OPENAI, model = "", provider = "", headers = {}, path = "" } = {}) {
  const detected = detectClientFormat(headers, body, { path });
  const features = inferFeatureIntent(body);
  return {
    body: clone(body),
    sourceFormat,
    model,
    provider,
    client: detected.id,
    clientFormat: detected.format,
    features,
    metadata: { path, detectedSignals: detected.signals, detectionConfidence: detected.confidence },
  };
}

export function resolveTranslationSurface({ provider = "", model = "", clientFormat = FORMATS.OPENAI, targetFormat = null, capabilityOverride = null } = {}) {
  const caps = getCapabilitiesForModel(provider, model, capabilityOverride);
  const wireFormat = targetFormat || provider || FORMATS.OPENAI;
  const surface = wireFormat === FORMATS.CLAUDE ? FORMATS.CLAUDE
    : wireFormat === FORMATS.GEMINI || wireFormat === FORMATS.VERTEX ? FORMATS.GEMINI
      : wireFormat === FORMATS.OPENAI_RESPONSES ? FORMATS.OPENAI_RESPONSES
        : FORMATS.OPENAI;
  return { clientFormat, wireFormat: surface, capabilities: caps };
}

export function unsupportedFeatures(features = {}, capabilities = {}) {
  return FEATURE_KEYS.filter((key) => {
    if (!features[key]) return false;
    if (key === "images") return capabilities.vision !== true;
    if (key === "audio") return capabilities.audioInput !== true;
    if (key === "video") return capabilities.videoInput !== true;
    if (key === "reasoning") return capabilities.reasoning !== true;
    if (key === "tools") return capabilities.tools === false;
    return false;
  });
}
