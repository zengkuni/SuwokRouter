import { describe, expect, test, beforeEach } from "bun:test";
import {
  applyRejectedParam,
  isOptionalProjectionPath,
  removeCompatibilityProjection,
  rememberRejectedParam,
  stripKnownRejected,
  __resetCompatFallbackForTests,
  _peekRejected,
} from "./compatFallback.js";
import { classifyUnsupportedParameter } from "../../utils/error.js";

beforeEach(() => __resetCompatFallbackForTests());

describe("A4.4 classifyUnsupportedParameter (error.js classifier)", () => {
  test("regex extraction — 'unsupported parameter: X'", () => {
    expect(classifyUnsupportedParameter('{"error":{"message":"Unsupported parameter: reasoning_effort"}}', { status: 400 }))
      .toBe("reasoning_effort");
  });
  test("regex extraction — quoted field 'unknown field: \"prompt_cache_options\"'", () => {
    expect(classifyUnsupportedParameter('unknown field: "prompt_cache_options" not supported', { status: 400 }))
      .toBe("prompt_cache_options");
  });
  test("allowlist scan fallback — body mentions reasoning.effort without regex hit", () => {
    expect(classifyUnsupportedParameter("the field reasoning.effort is not acceptable here", { status: 400 }))
      .toBe("reasoning.effort");
  });
  test("status gate — 401 is NOT a param rejection", () => {
    expect(classifyUnsupportedParameter("Unsupported parameter: reasoning_effort", { status: 401 })).toBeNull();
  });
  test("status gate — 500 is NOT a param rejection", () => {
    expect(classifyUnsupportedParameter("Unsupported parameter: reasoning_effort", { status: 500 })).toBeNull();
  });
  test("422 (Unprocessable) passes the status gate — treated as a param rejection", () => {
    expect(classifyUnsupportedParameter("unsupported parameter: tool_choice", { status: 422 }))
      .toBe("tool_choice");
  });
  test("regex path returns the captured field even when not in the optional allowlist (allowlist enforced at strip step, not classifier)", () => {

    expect(classifyUnsupportedParameter("Unrecognized request argument: prediction", { status: 422 }))
      .toBe("prediction");
  });
  test("null/empty bodyText → null", () => {
    expect(classifyUnsupportedParameter(null)).toBeNull();
    expect(classifyUnsupportedParameter("")).toBeNull();
  });
  test("no meaningful param mentioned → null", () => {
    expect(classifyUnsupportedParameter("Internal server error", { status: 400 })).toBeNull();
  });
});

describe("A4.4 isOptionalProjectionPath (allowlist guard)", () => {
  test("allowed optional paths", () => {
    expect(isOptionalProjectionPath("prompt_cache_options")).toBe(true);
    expect(isOptionalProjectionPath("prompt_cache_options.ttl")).toBe(true);
    expect(isOptionalProjectionPath("reasoning")).toBe(true);
    expect(isOptionalProjectionPath("reasoning.effort")).toBe(true);
    expect(isOptionalProjectionPath("reasoning.max_tokens")).toBe(true);
    expect(isOptionalProjectionPath("reasoning_effort")).toBe(true);
    expect(isOptionalProjectionPath("thinking")).toBe(true);
    expect(isOptionalProjectionPath("output_config")).toBe(true);
    expect(isOptionalProjectionPath("output_config.effort")).toBe(true);
    expect(isOptionalProjectionPath("response_format")).toBe(true);
    expect(isOptionalProjectionPath("parallel_tool_calls")).toBe(true);
    expect(isOptionalProjectionPath("tool_choice")).toBe(true);
    expect(isOptionalProjectionPath("stream_options")).toBe(true);
    expect(isOptionalProjectionPath("prompt_cache_breakpoint")).toBe(true);
  });
  test("SEMANTIC fields are never optional (guard)", () => {
    expect(isOptionalProjectionPath("messages")).toBe(false);
    expect(isOptionalProjectionPath("model")).toBe(false);
    expect(isOptionalProjectionPath("stream")).toBe(false);
    expect(isOptionalProjectionPath("temperature")).toBe(false);
    expect(isOptionalProjectionPath("")).toBe(false);
    expect(isOptionalProjectionPath(null as never)).toBe(false);
  });
});

describe("A4.4 removeCompatibilityProjection", () => {
  test("top-level reasoning_effort removed", () => {
    const p = { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high", model: "x" };
    expect(removeCompatibilityProjection(p, "reasoning_effort")).toBe(true);
    expect(p.reasoning_effort).toBeUndefined();
    expect(p.messages.length).toBe(1);
  });
  test("nested prompt_cache_options.ttl removed, parent kept", () => {
    const p = { prompt_cache_options: { ttl: "30m", enabled: true }, messages: [] };
    expect(removeCompatibilityProjection(p, "prompt_cache_options.ttl")).toBe(true);
    expect(p.prompt_cache_options as { enabled: boolean }).toEqual({ enabled: true });
  });
  test("whole prompt_cache_options + nested messages breakpoint both removed", () => {
    const p = {
      prompt_cache_options: { ttl: "30m" },
      messages: [{ role: "user", content: "hi", prompt_cache_breakpoint: true }],
    };
    expect(removeCompatibilityProjection(p, "prompt_cache_options")).toBe(true);
    expect(p.prompt_cache_options).toBeUndefined();
    expect(p.messages[0]!.prompt_cache_breakpoint).toBeUndefined();
  });
  test("non-allowlisted param NOT removed (returns false, body untouched)", () => {
    const p = { messages: [], temperature: 0.5 };
    expect(removeCompatibilityProjection(p, "temperature")).toBe(false);
    expect(p.temperature).toBe(0.5);
  });
});

describe("A4.4 per-provider cache (the spec improvement)", () => {
  test("applyRejectedParam records + strips → stripKnownRejected hits next call (no 400 paid)", () => {
    const provider = "openai-compatible", model = "gpt-x";

    const first = { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high", model };
    const r = applyRejectedParam(first, provider, model, "reasoning_effort");
    expect(r.retryable).toBe(true);
    expect(r.removed).toBe(true);
    expect(first.reasoning_effort).toBeUndefined();

    const next = { messages: [{ role: "user", content: "hi2" }], reasoning_effort: "high", model };
    const stripped = stripKnownRejected(next, provider, model);
    expect(stripped).toEqual(["reasoning_effort"]);
    expect(next.reasoning_effort).toBeUndefined();

    expect(_peekRejected(provider, model)?.has("reasoning_effort")).toBe(true);
  });
  test("cache is per-provider (gpt-x cache hit does NOT strip for gpt-y)", () => {
    const provider = "p";
    applyRejectedParam({ messages: [], reasoning_effort: "high", model: "gpt-x" }, provider, "gpt-x", "reasoning_effort");
    const other = { messages: [], reasoning_effort: "high", model: "gpt-y" };
    expect(stripKnownRejected(other, provider, "gpt-y")).toEqual([]);
    expect(other.reasoning_effort).toBe("high");
  });
  test("rememberRejectedParam alone (no strip) still seeds cache", () => {
    rememberRejectedParam("p", "m", "tool_choice");
    const next = { messages: [], tool_choice: "auto", model: "m" };
    expect(stripKnownRejected(next, "p", "m")).toEqual(["tool_choice"]);
  });
  test("re-recording the same param is idempotent (Set dedup, no duplication)", () => {

    rememberRejectedParam("p2", "m2", "reasoning");
    rememberRejectedParam("p2", "m2", "reasoning");
    rememberRejectedParam("p2", "m2", "reasoning_effort");
    const peek = _peekRejected("p2", "m2");
    expect(peek?.size).toBe(2);
    expect(peek?.has("reasoning")).toBe(true);
    expect(peek?.has("reasoning_effort")).toBe(true);
  });
  test("a stale (TTL-expired) entry is dropped on next access — stripKnownRejected treats it as a miss", () => {

    rememberRejectedParam("pexp", "mexp", "tool_choice");
    const key = "pexp:mexp";

    const store = (globalThis as Record<string, any>)._swayCompatFallback
      .rejected as Map<string, { paths: Set<string>; expireAt: number }>;
    store.get(key)!.expireAt = Date.now() - 1;
    const next = { messages: [], tool_choice: "auto", model: "mexp" };
    expect(stripKnownRejected(next, "pexp", "mexp")).toEqual([]);
    expect(next.tool_choice).toBe("auto");

    expect(_peekRejected("pexp", "mexp")).toBeUndefined();
  });
});

describe("A4.4 retry loop contract (3-strike guard + deep-clone semantics)", () => {
  test("stripping a field does NOT mutate the same object the caller still holds", () => {
    const provider = "p3", model = "m3";
    const original = { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high", model };

    const retryBody = JSON.parse(JSON.stringify(original));
    applyRejectedParam(retryBody, provider, model, "reasoning_effort");
    expect(retryBody.reasoning_effort).toBeUndefined();
    expect(original.reasoning_effort).toBe("high");
  });
  test("stripKnownRejected is a no-op when cache empty (no spurious trace_meta)", () => {
    const p = { messages: [], reasoning_effort: "high" };
    expect(stripKnownRejected(p, "never-seen", "never-seen")).toEqual([]);
    expect(p.reasoning_effort).toBe("high");
  });
});
