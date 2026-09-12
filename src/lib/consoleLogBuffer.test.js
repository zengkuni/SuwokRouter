import { afterEach, describe, expect, test } from "bun:test";
import {
  clearConsoleLogs,
  getConsoleEmitter,
  getConsoleLogs,
  initConsoleLogCapture,
} from "./consoleLogBuffer.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEvents(chunk) {
  return new TextDecoder().decode(chunk)
    .split("\n\n")
    .filter((part) => part.startsWith("data: "))
    .map((part) => JSON.parse(part.slice(6)));
}

describe("console log buffer", () => {
  afterEach(() => {
    clearConsoleLogs();
  });

  test("captures backend console output before route access", async () => {
    initConsoleLogCapture();
    initConsoleLogCapture();

    console.log("startup-capture-test");
    await wait(120);

    expect(getConsoleLogs().some((line) => line.includes("startup-capture-test"))).toBe(true);
  });

  test("batches lines and broadcasts clear events", async () => {
    initConsoleLogCapture();
    const batches = [];
    const onLines = (lines) => batches.push(lines);
    const clears = [];
    const onClear = () => clears.push(true);
    const emitter = getConsoleEmitter();
    emitter.on("lines", onLines);
    emitter.on("clear", onClear);

    console.info("batch-one");
    console.warn("batch-two");
    await wait(120);

    emitter.off("lines", onLines);
    expect(batches.flat().some((entry) => entry.line.includes("batch-one"))).toBe(true);
    expect(batches.flat().some((entry) => entry.line.includes("batch-two"))).toBe(true);

    clearConsoleLogs();
    emitter.off("clear", onClear);
    expect(clears).toHaveLength(1);
    expect(getConsoleLogs()).toEqual([]);
    expect((await import("./consoleLogBuffer.js")).getConsoleEntries()).toEqual([]);

    console.log("after-clear-reuse");
    await wait(120);
    expect(getConsoleLogs().some((line) => line.includes("after-clear-reuse"))).toBe(true);
  });

  test("SSE sends the snapshot and subsequent backend lines", async () => {
    initConsoleLogCapture();
    console.log("snapshot-before-connect");
    await wait(120);

    const { GET } = await import("../routes/api/translator/console-logs/stream/route.js");
    const controller = new AbortController();
    const response = await GET(new Request("http://localhost/api/translator/console-logs/stream", {
      signal: controller.signal,
    }));
    const reader = response.body.getReader();

    const first = await reader.read();
    const initialEvents = decodeEvents(first.value);
    const initial = initialEvents.find((event) => event.type === "init");
    expect(initial?.entries.some((entry) => entry.line.includes("snapshot-before-connect"))).toBe(true);
    expect(initial?.entries.find((entry) => entry.line.includes("snapshot-before-connect"))?.ts).toBeGreaterThan(0);

    console.error("sse-live-line");
    const second = await reader.read();
    const nextEvents = decodeEvents(second.value);
    expect(nextEvents.some((event) => (event.type === "line" || event.type === "lines") && JSON.stringify(event).includes("sse-live-line"))).toBe(true);

    controller.abort();
    await reader.cancel();
  });
});
