import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "node:events";

let mockActiveRequests: Array<{ model: string; provider: string; account: string; count: number }> = [];
const mockEmitter = new EventEmitter();
const readActiveRequests = () => Promise.resolve({ activeRequests: mockActiveRequests, recentRequests: [], errorProvider: "" });

const { buildInflightSnapshot, createInflightStream, __resetInflightForTests } = await import("./inflight");

async function collectSSE(stream: ReadableStream, count: number, timeoutMs = 5000): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  const deadline = Date.now() + timeoutMs;

  while (events.length < count) {
    if (Date.now() > deadline) break;
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) =>
        setTimeout(() => r({ value: undefined, done: true }), timeoutMs)
      ),
    ]);
    if (done) break;
    const text = decoder.decode(value, { stream: true });

    for (const line of text.split("\n\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        events.push(trimmed.slice(6));
      }
    }
  }

  reader.cancel().catch(() => {});
  return events;
}

describe("buildInflightSnapshot", () => {
  it("returns zero-total snapshot for empty active list", () => {
    const snap = buildInflightSnapshot([]);
    expect(snap.total).toBe(0);
    expect(snap.byProvider).toEqual({});
    expect(snap.byAccount).toEqual({});
    expect(snap.requests).toEqual([]);
    expect(snap.timestamp).toBeTruthy();
  });

  it("counts a single request correctly", () => {
    const snap = buildInflightSnapshot([
      { model: "claude-3.5-sonnet", provider: "anthropic", account: "cli-123", count: 1 },
    ]);
    expect(snap.total).toBe(1);
    expect(snap.byProvider).toEqual({ anthropic: 1 });
    expect(snap.byAccount).toEqual({ "cli-123": { anthropic: 1 } });
  });

  it("aggregates multiple requests across providers", () => {
    const snap = buildInflightSnapshot([
      { model: "claude-3.5-sonnet", provider: "anthropic", account: "cli-123", count: 3 },
      { model: "gpt-4o", provider: "openai", account: "pat-456", count: 2 },
      { model: "claude-3.5-sonnet", provider: "anthropic", account: "cli-123", count: 1 },
    ]);
    expect(snap.total).toBe(6);
    expect(snap.byProvider).toEqual({ anthropic: 4, openai: 2 });
    expect(snap.byAccount).toEqual({
      "cli-123": { anthropic: 4 },
      "pat-456": { openai: 2 },
    });
    expect(snap.requests).toHaveLength(3);
  });

  it("handles same model across different providers", () => {
    const snap = buildInflightSnapshot([
      { model: "claude-3.5-sonnet", provider: "anthropic", account: "cli-1", count: 2 },
      { model: "claude-3.5-sonnet", provider: "amazon-bedrock", account: "cli-2", count: 1 },
    ]);
    expect(snap.total).toBe(3);
    expect(snap.byProvider).toEqual({ anthropic: 2, "amazon-bedrock": 1 });
    expect(snap.byAccount).toEqual({
      "cli-1": { anthropic: 2 },
      "cli-2": { "amazon-bedrock": 1 },
    });
  });
});

describe("createInflightStream", () => {
  beforeEach(() => {
    __resetInflightForTests();
    mockActiveRequests = [];
    mockEmitter.removeAllListeners();
  });

  afterEach(() => {
    __resetInflightForTests();
    mockEmitter.removeAllListeners();
  });

  it("returns stream with status 200", () => {
    const result = createInflightStream({ statsEmitter: mockEmitter, getActiveRequests: readActiveRequests });
    expect(result.status).toBe(200);
    expect(result.stream).toBeInstanceOf(ReadableStream);
    result.cleanup();
  });

  it("returns 429 when max clients reached", () => {
    const streams: Array<{ stream: ReadableStream | null; cleanup: () => void }> = [];
    for (let i = 0; i < 10; i++) {
      streams.push(createInflightStream({ statsEmitter: mockEmitter, getActiveRequests: readActiveRequests }));
    }
    const overflow = createInflightStream({ statsEmitter: mockEmitter, getActiveRequests: readActiveRequests });
    expect(overflow.status).toBe(429);
    expect(overflow.stream).toBeNull();
    streams.forEach((s) => s.cleanup());
  });

  it("sends initial snapshot on connect", async () => {
    mockActiveRequests = [
      { model: "claude-3.5-sonnet", provider: "anthropic", account: "cli-1", count: 1 },
    ];
    const { stream, cleanup } = createInflightStream({ statsEmitter: mockEmitter, getActiveRequests: readActiveRequests });
    const events = await collectSSE(stream!, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const snap = JSON.parse(events[0]!);
    expect(snap.total).toBe(1);
    expect(snap.byProvider).toEqual({ anthropic: 1 });
    cleanup();
  });

  it("pushes throttled updates on pending events", async () => {
    mockActiveRequests = [];
    const { stream, cleanup } = createInflightStream({
      throttleMs: 100,
      statsEmitter: mockEmitter,
      getActiveRequests: readActiveRequests,
    });

    const reader = stream!.getReader();
    const decoder = new TextDecoder();

    const firstChunk = await reader.read();
    const firstText = decoder.decode(firstChunk.value, { stream: true });
    expect(firstText).toContain("data:");

    await new Promise((r) => setTimeout(r, 150));
    mockActiveRequests = [
      { model: "gpt-4o", provider: "openai", account: "pat-1", count: 1 },
    ];
    mockEmitter.emit("pending");

    await new Promise((r) => setTimeout(r, 200));
    const secondChunk = await reader.read();
    const secondText = decoder.decode(secondChunk.value, { stream: true });
    expect(secondText).toContain('"openai"');

    reader.cancel().catch(() => {});
    cleanup();
  });

  it("cleanup removes event listeners", () => {
    const { cleanup } = createInflightStream({
      statsEmitter: mockEmitter,
      getActiveRequests: readActiveRequests,
    });
    expect(mockEmitter.listenerCount("pending")).toBe(1);
    cleanup();
    expect(mockEmitter.listenerCount("pending")).toBe(0);
  });

  it("cleanup is idempotent", () => {
    const { cleanup } = createInflightStream({
      statsEmitter: mockEmitter,
      getActiveRequests: readActiveRequests,
    });
    cleanup();
    cleanup();
    expect(mockEmitter.listenerCount("pending")).toBe(0);
  });
});
