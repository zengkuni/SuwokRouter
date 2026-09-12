import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import {
  fnv1a,
  decideWithPolicy,
  applyCaptureDecision,
  getCapturePolicy,
  __resetPayloadCaptureForTests,
} from "./payloadCapture.js";
import { initDb } from "@/lib/db/index.js";
import { getAdapter } from "@/lib/db/driver.js";
import { saveRequestDetail, getRequestDetailById } from "@/lib/db/repos/requestDetailsRepo.js";

const HEX = "0123456789abcdef0123456789abcdef";

beforeEach(async () => {
  __resetPayloadCaptureForTests();
  await initDb();
});
afterEach(() => {
  delete process.env.SWAY_PAYLOAD_CAPTURE;
  delete process.env.SWAY_PAYLOAD_SAMPLE_RATE;
  __resetPayloadCaptureForTests();
});
afterAll(async () => {

  const db = await getAdapter();
  db.run("DELETE FROM requestDetails WHERE id LIKE 'e2e-%'");
});

describe("payloadCapture: fnv1a deterministic + decideWithPolicy", () => {
  test("fnv1a deterministic + 32-bit unsigned + stable per input", () => {
    const a = fnv1a("abc");
    const b = fnv1a("abc");
    expect(a, `same input same hash`).toBe(b);
    expect(Number.isInteger(a), `integer`).toBe(true);
    expect(a, `unsigned 32-bit`).toBeGreaterThanOrEqual(0);
    expect(a, `≤ max u32`).toBeLessThanOrEqual(0xffffffff);
    expect(fnv1a("abc"), `≠ different input`).not.toBe(fnv1a("xyz"));
  });

  test("mode=none → drop always", () => {
    expect(decideWithPolicy({ mode: "none", sampleRate: 0.5 }, "success", HEX), `none success drop`).toBe("drop");
    expect(decideWithPolicy({ mode: "none", sampleRate: 0.5 }, "error", HEX), `none error drop`).toBe("drop");
    expect(decideWithPolicy({ mode: "none", sampleRate: 1 }, "success", null), `none null-trace drop`).toBe("drop");
  });

  test("mode=raw → raw always", () => {
    expect(decideWithPolicy({ mode: "raw", sampleRate: 0 }, "success", HEX), `raw success`).toBe("raw");
    expect(decideWithPolicy({ mode: "raw", sampleRate: 0 }, "error", null), `raw error`).toBe("raw");
  });

  test("mode=bounded → keep always", () => {
    expect(decideWithPolicy({ mode: "bounded", sampleRate: 0 }, "success", HEX), `bounded keep`).toBe("keep");
    expect(decideWithPolicy({ mode: "bounded", sampleRate: 0 }, "error", null), `bounded error keep`).toBe("keep");
  });

  test("mode=error → keep failure, drop success", () => {
    expect(decideWithPolicy({ mode: "error", sampleRate: 0.5 }, "error", HEX), `error status=error keep`).toBe("keep");
    expect(decideWithPolicy({ mode: "error", sampleRate: 0.5 }, "provider_500", HEX), `error 500 keep`).toBe("keep");
    expect(decideWithPolicy({ mode: "error", sampleRate: 0.5 }, "success", HEX), `error success drop`).toBe("drop");
  });

  test("mode=sample → deterministic stable per trace (same trace same decision)", () => {
    const rate = 0.5;
    const d = decideWithPolicy({ mode: "sample", sampleRate: rate }, "success", HEX);

    for (let i = 0; i < 10; i++) {
      expect(decideWithPolicy({ mode: "sample", sampleRate: rate }, "success", HEX), `stable call ${i}`).toBe(d);
    }

    expect(decideWithPolicy({ mode: "sample", sampleRate: 0 }, "success", HEX), `rate 0 drop`).toBe("drop");
    expect(decideWithPolicy({ mode: "sample", sampleRate: 1 }, "success", HEX), `rate 1 keep`).toBe("keep");
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      if (decideWithPolicy({ mode: "sample", sampleRate: 0.1 }, "success", `trace${i}`) === "keep") hits++;
    }

    expect(hits, `rate 0.1 some hits range`).toBeGreaterThan(50);
    expect(hits, `rate 0.1 not all`).toBeLessThan(600);
  });
});

describe("payloadCapture: applyCaptureDecision strips bodies", () => {
  test("keep and raw leave bodies intact", () => {
    const detail = { request: { body: "hi" }, response: { text: "ok" }, meta: 1 };
    const out = applyCaptureDecision(detail, "keep");
    expect(out.request, `keep request intact`).toEqual({ body: "hi" });
    expect(out.response, `keep response intact`).toEqual({ text: "ok" });
    const raw = applyCaptureDecision({ ...detail }, "raw");
    expect(raw.request).toEqual({ body: "hi" });
  });

  test("raw mode preserves sensitive and oversized payloads", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.SWAY_PAYLOAD_CAPTURE = "raw";
    process.env.OBSERVABILITY_MAX_JSON_SIZE = "1";
    __resetPayloadCaptureForTests();
    const id = `e2e-raw-${Date.now()}`;
    const prompt = "x".repeat(12_000);
    await saveRequestDetail({
      id,
      provider: "openai",
      model: "gpt-5",
      status: "success",
      request: { authorization: "Bearer secret", body: prompt },
    } as any);
    await new Promise((r) => setTimeout(r, 80));
    await saveRequestDetail({ id: `${id}-b`, provider: "openai", model: "gpt-5", status: "success", request: { body: "x" } } as any);
    await new Promise((r) => setTimeout(r, 80));
    const row = await getRequestDetailById(id);
    expect(row?.payload_capture).toBe("raw:raw");
    expect((row?.request as any)?.authorization).toBe("Bearer secret");
    expect((row?.request as any)?.body).toBe(prompt);
    delete process.env.ENABLE_REQUEST_LOGS;
    delete process.env.SWAY_PAYLOAD_CAPTURE;
    delete process.env.OBSERVABILITY_MAX_JSON_SIZE;
  });

  test("disabled setting resolves to none", async () => {
    process.env.SWAY_PAYLOAD_CAPTURE = "none";
    __resetPayloadCaptureForTests();
    expect((await getCapturePolicy()).mode).toBe("none");
    delete process.env.SWAY_PAYLOAD_CAPTURE;
  });

  test("drop replaces wire fields with redaction marker, keeps metadata", () => {
    const detail = { provider: "claude", model: "sonnet", request: { body: "secret" }, providerRequest: { x: 1 }, providerResponse: { y: 2 }, response: { ok: true }, status: "success" };
    const out = applyCaptureDecision(detail, "drop");
    expect(out.provider, `meta kept provider`).toBe("claude");
    expect(out.model, `meta kept model`).toBe("sonnet");
    expect(out.status, `meta kept status`).toBe("success");
    expect((out.request as any)._redacted, `request redacted marker`).toContain("payload_capture_mode");
    expect((out.providerRequest as any)._redacted, `providerRequest redacted marker`).toContain("payload_capture_mode");
    expect((out.providerResponse as any)._redacted, `providerResponse redacted marker`).toContain("payload_capture_mode");
    expect((out.response as any)._redacted, `response redacted marker`).toContain("payload_capture_mode");
    expect((out.request as any)._field, `request field name logged`).toBe("request");
  });
});

describe("payloadCapture: getCapturePolicy env + cache", () => {
  test("env SWAY_PAYLOAD_CAPTURE overrides; default none", async () => {
    const p = await getCapturePolicy();
    expect(p.mode, `default none`).toBe("none");
    process.env.SWAY_PAYLOAD_CAPTURE = "bounded";
    __resetPayloadCaptureForTests();
    const p2 = await getCapturePolicy();
    expect(p2.mode, `env override bounded`).toBe("bounded");
    delete process.env.SWAY_PAYLOAD_CAPTURE;
    __resetPayloadCaptureForTests();
  });

  test("env SWAY_PAYLOAD_SAMPLE_RATE overrides", async () => {
    process.env.SWAY_PAYLOAD_CAPTURE = "sample";
    process.env.SWAY_PAYLOAD_SAMPLE_RATE = "0.25";
    __resetPayloadCaptureForTests();
    const p = await getCapturePolicy();
    expect(p.mode, `sample mode`).toBe("sample");
    expect(p.sampleRate, `env rate 0.25`).toBe(0.25);
    delete process.env.SWAY_PAYLOAD_CAPTURE;
    delete process.env.SWAY_PAYLOAD_SAMPLE_RATE;
    __resetPayloadCaptureForTests();
  });

  test("invalid env mode falls back to default none", async () => {
    process.env.SWAY_PAYLOAD_CAPTURE = "garbage";
    __resetPayloadCaptureForTests();
    const p = await getCapturePolicy();
    expect(p.mode, `invalid → none`).toBe("none");
    delete process.env.SWAY_PAYLOAD_CAPTURE;
    __resetPayloadCaptureForTests();
  });
});

describe("payloadCapture: end-to-end via requestDetailsRepo flush", () => {
  test("mode=none strips bodies; row still written with metadata + payload_capture tag", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.OBSERVABILITY_MAX_JSON_SIZE = "20";
    process.env.SWAY_PAYLOAD_CAPTURE = "none";
    __resetPayloadCaptureForTests();
    const id = `e2e-none-${Date.now()}`;
    await saveRequestDetail({
      id,
      provider: "claude",
      model: "sonnet",
      status: "success",
      request: { body: "SUPER SECRET PROMPT" },
      response: { content: "SUPER SECRET COMPLETION" },
      latency: { ttft: 12, total: 99 },
      tokens: { prompt_tokens: 5, completion_tokens: 7 },
    } as any);

    await new Promise((r) => setTimeout(r, 50));
    await saveRequestDetail({ id: `${id}-b`, provider: "claude", model: "sonnet", status: "success", request: { body: "x" } } as any);
    await new Promise((r) => setTimeout(r, 50));
    const row = await getRequestDetailById(id);
    expect(row, `row persisted under none`).not.toBeNull();
    expect(row?.provider, `meta provider`).toBe("claude");
    expect(row?.payload_capture, `tag = none:drop`).toBe("none:drop");
    expect((row?.request as any)?._redacted, `body redacted`).toContain("payload_capture_mode");
    expect((row?.response as any)?._redacted, `response redacted`).toContain("payload_capture_mode");
    delete process.env.ENABLE_REQUEST_LOGS;
    delete process.env.OBSERVABILITY_MAX_JSON_SIZE;
  });

  test("mode=bounded keeps bodies verbatim", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.OBSERVABILITY_MAX_JSON_SIZE = "20";
    process.env.SWAY_PAYLOAD_CAPTURE = "bounded";
    __resetPayloadCaptureForTests();
    const id = `e2e-bounded-${Date.now()}`;
    await saveRequestDetail({
      id,
      provider: "openai",
      model: "gpt-4",
      status: "success",
      request: { body: "PLAIN PROMPT" },
      response: { content: "PLAIN ANSWER" },
    } as any);
    await new Promise((r) => setTimeout(r, 50));
    await saveRequestDetail({ id: `${id}-b`, provider: "openai", model: "gpt-4", status: "success", request: { body: "y" } } as any);
    await new Promise((r) => setTimeout(r, 50));
    const row = await getRequestDetailById(id);
    expect(row, `row persisted`).not.toBeNull();
    expect(row?.payload_capture, `tag = bounded:keep`).toBe("bounded:keep");
    expect((row?.request as any)?.body, `body kept`).toBe("PLAIN PROMPT");
    expect((row?.response as any)?.content, `response kept`).toBe("PLAIN ANSWER");
    delete process.env.ENABLE_REQUEST_LOGS;
    delete process.env.OBSERVABILITY_MAX_JSON_SIZE;
    delete process.env.SWAY_PAYLOAD_CAPTURE;
  });

  test("mode=error keeps failure body, drops success body", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.OBSERVABILITY_MAX_JSON_SIZE = "20";
    process.env.SWAY_PAYLOAD_CAPTURE = "error";
    __resetPayloadCaptureForTests();
    const okId = `e2e-err-ok-${Date.now()}`;
    const badId = `e2e-err-bad-${Date.now()}`;
    await saveRequestDetail({ id: okId, provider: "p", model: "m", status: "success", request: { body: "OK" } } as any);
    await saveRequestDetail({ id: badId, provider: "p", model: "m", status: "provider_500", request: { body: "FAILED" } } as any);
    await new Promise((r) => setTimeout(r, 50));
    await saveRequestDetail({ id: `${okId}-b`, provider: "p", model: "m", status: "success", request: { body: "x" } } as any);
    await new Promise((r) => setTimeout(r, 50));
    const okRow = await getRequestDetailById(okId);
    const badRow = await getRequestDetailById(badId);
    expect(okRow?.payload_capture, `happy path dropped`).toBe("error:drop");
    expect(badRow?.payload_capture, `failure kept`).toBe("error:keep");
    expect((okRow?.request as any)?._redacted, `happy body stripped`).toContain("payload_capture_mode");
    expect((badRow?.request as any)?.body, `failure body kept`).toBe("FAILED");
    delete process.env.ENABLE_REQUEST_LOGS;
    delete process.env.OBSERVABILITY_MAX_JSON_SIZE;
    delete process.env.SWAY_PAYLOAD_CAPTURE;
  });
});
