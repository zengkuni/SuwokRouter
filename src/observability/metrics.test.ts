import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { initDb } from "../lib/db/index.js";
import { getAdapter } from "../lib/db/driver.js";
import {
  counter,
  gauge,
  histogram,
  toPrometheus,
  persistMetrics,
  restoreMetrics,
  recordHttpRequest,
  __resetMetricsForTests,
} from "./metrics.js";

beforeEach(() => {
  __resetMetricsForTests();
});

afterAll(async () => {
  try {
    const db = await getAdapter();
    db.run(`DELETE FROM _meta WHERE key = ?`, ["metrics.snapshot"]);
  } catch {

  }
});

describe("metrics: counter", () => {
  test("inc monotonik + label key memisahkan seri", () => {
    const c = counter({ name: "t_c_total", help: "test counter", labels: ["route"] });
    c.inc({ route: "/a" });
    c.inc({ route: "/a" }, 2);
    c.inc({ route: "/b" });
    expect(c.value({ route: "/a" }), `seri /a`).toBe(3);
    expect(c.value({ route: "/b" }), `seri /b`).toBe(1);
  });

  test("inc tipe selain counter nolak (guard kind)", () => {
    const g = gauge({ name: "t_c_gauge", help: "x" });
    expect(() => g.inc({}, 1)).toThrow(/counter-only/);
  });
});

describe("metrics: gauge", () => {
  test("set + overwrite (naik turun)", () => {
    const g = gauge({ name: "t_g", help: "gauge test" });
    g.set({}, 5);
    expect(g.value({}), `set 5`).toBe(5);
    g.set({}, 2);
    expect(g.value({}), `overwrite 2`).toBe(2);
  });

  test("set tipe selain gauge nolak", () => {
    const c = counter({ name: "t_g_counter", help: "x", labels: [] });
    expect(() => c.set({}, 1)).toThrow(/gauge-only/);
  });
});

describe("metrics: histogram", () => {
  test("observe → bucket kumulatif + sum + count + +Inf", () => {
    const h = histogram({
      name: "t_h_ms",
      help: "histo test",
      labels: [],
      buckets: [1, 10, 100],
    });
    h.observe({}, 0.5);
    h.observe({}, 5);
    h.observe({}, 50);
    const b = h.value({}) as number[];

    expect(b.length, `+Inf slot`).toBe(4);
    expect(b[0], `bucket le=1`).toBe(1);
    expect(b[1], `bucket le=10`).toBe(2);
    expect(b[2], `bucket le=100`).toBe(3);
    expect(b[3], `bucket le=+Inf`).toBe(3);
    const entry = b as unknown as { _sum: number; _count: number };
    expect(entry._sum, `sum`).toBe(55.5);
    expect(entry._count, `count`).toBe(3);
  });

  test("observe tipe selain histogram nolak", () => {
    const c = counter({ name: "t_h_counter", help: "x", labels: [] });
    expect(() => c.observe({}, 1)).toThrow(/histogram-only/);
  });
});

describe("metrics: cardinality guard", () => {
  test("lewat 100 seri → overflow naik, seri baru ditolak (tetap 100)", () => {
    const c = counter({ name: "t_overflow", help: "overflow test", labels: ["k"] });
    for (let i = 0; i < 100; i++) c.inc({ k: `series_${i}` });
    expect(c.series.size, `cap 100`).toBe(100);
    c.inc({ k: "series_overflow" });
    expect(c.series.size, `masih 100`).toBe(100);
    expect(c.overflows, `overflow counter`).toBe(1);
  });
});

describe("metrics: toPrometheus format", () => {
  test("counter/gauge/histogram jadi text 0.0.4 valid", () => {
    const c = counter({ name: "t_req_total", help: "req total", labels: ["route", "status"] });
    c.inc({ route: "/v1/chat", status: "200" }, 4);
    const g = gauge({ name: "t_inflight", help: "inflight" });
    g.set({}, 3);
    const h = histogram({ name: "t_dur_ms", help: "dur", labels: [], buckets: [10, 100] });
    h.observe({}, 5);
    h.observe({}, 50);

    const text = toPrometheus();

    expect(text, `HELP counter`).toContain(`# HELP t_req_total req total`);
    expect(text, `TYPE counter`).toContain(`# TYPE t_req_total counter`);
    expect(text, `TYPE gauge`).toContain(`# TYPE t_inflight gauge`);
    expect(text, `TYPE histogram`).toContain(`# TYPE t_dur_ms histogram`);

    expect(text, `counter label`).toMatch(/t_req_total\{route="\/v1\/chat",status="200"\} 4/);

    expect(text, `gauge value`).toMatch(/t_inflight 3/);

    expect(text, `histo le=10`).toMatch(/t_dur_ms_bucket\{le="10"\} 1/);
    expect(text, `histo le=100`).toMatch(/t_dur_ms_bucket\{le="100"\} 2/);
    expect(text, `histo le=+Inf`).toMatch(/t_dur_ms_bucket\{le="\+Inf"\} 2/);
    expect(text, `histo sum`).toMatch(/t_dur_ms_sum 55/);
    expect(text, `histo count`).toMatch(/t_dur_ms_count 2/);
  });
});

describe("metrics: persist/restore roundtrip (survive restart)", () => {
  test("inc → persist → reset → restore → recreate = nilai dipulihkan", async () => {
    await initDb();

    const c = counter({ name: "t_snapshot_counter", help: "snap", labels: ["route"] });
    c.inc({ route: "/a" }, 7);
    const h = histogram({ name: "t_snapshot_histo", help: "snap h", labels: [], buckets: [10] });
    h.observe({}, 3);
    h.observe({}, 7);

    await persistMetrics();

    __resetMetricsForTests();

    await restoreMetrics();

    const c2 = counter({ name: "t_snapshot_counter", help: "snap", labels: ["route"] });
    const h2 = histogram({ name: "t_snapshot_histo", help: "snap h", labels: [], buckets: [10] });
    expect(c2.value({ route: "/a" }), `counter dipulihkan`).toBe(7);
    const b2 = h2.value({}) as number[];
    expect(b2[0], `histo bucket<=10`).toBe(2);
    const entry = b2 as unknown as { _sum: number; _count: number };
    expect(entry._sum, `histo sum`).toBe(10);
    expect(entry._count, `histo count`).toBe(2);
  });
});

describe("metrics: recordHttpRequest helper", () => {
  test("record → inc http_requests_total + observe http_request_duration_ms", () => {

    recordHttpRequest("POST", "/api/v1/chat/completions", 200, 12);
    recordHttpRequest("POST", "/api/v1/chat/completions", 200, 8);
    const text = toPrometheus();

    expect(text, `http requests total`).toMatch(/sway_http_requests_total\{method="POST",route="\/api\/v1\/chat\/completions",status="200"\} 2/);
    expect(text, `http duration count`).toMatch(/sway_http_request_duration_ms_count\{method="POST",route="\/api\/v1\/chat\/completions"\} 2/);
  });
});
