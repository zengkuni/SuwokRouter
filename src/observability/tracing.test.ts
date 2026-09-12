import { describe, expect, test, beforeEach } from "bun:test";
import {
  parseTraceparent,
  createChildSpan,
  ensureTraceContext,
  getCurrentTrace,
  getCurrentTraceId,
  outboundTraceparent,
  stampResponseWithTrace,
  stampResponseTrace,
} from "./tracing.js";
import { cookieStoreAls } from "@/next/server";
import { __resetMetricsForTests } from "./metrics.js";

const HEX32 = "0123456789abcdef0123456789abcdef";
const HEX16 = "0123456789abcdef";

beforeEach(() => {
  __resetMetricsForTests();
});

describe("tracing: parseTraceparent", () => {
  test("valid header → parsed dengan sampled flag", () => {
    const r = parseTraceparent(`00-${HEX32}-${HEX16}-01`);
    expect(r, `parsed non-null`).not.toBeNull();
    expect(r?.version, `version 00`).toBe("00");
    expect(r?.traceId, `traceId`).toBe(HEX32);
    expect(r?.spanId, `spanId (inbound parent)`).toBe(HEX16);
    expect(r?.flags, `flags 01`).toBe("01");
    expect(r?.sampled, `sampled true`).toBe(true);
  });

  test("sampled=false saat flags 00", () => {
    const r = parseTraceparent(`00-${HEX32}-${HEX16}-00`);
    expect(r?.sampled, `sampled false`).toBe(false);
  });

  test("invalid headers → null", () => {
    expect(parseTraceparent(null), `null`).toBeNull();
    expect(parseTraceparent(""), `empty`).toBeNull();
    expect(parseTraceparent("garbage"), `garbage`).toBeNull();
    expect(parseTraceparent(`00-${HEX32.slice(0, 31)}-${HEX16}-01`), `31-hex traceId`).toBeNull();
    expect(parseTraceparent(`00-${HEX32}-${HEX16.slice(0, 15)}-01`), `15-hex spanId`).toBeNull();
    expect(parseTraceparent(`00-${HEX32}-zzzzzzzzzzzzzzzz-01`), `non-hex spanId`).toBeNull();
    expect(parseTraceparent(`ff-${HEX32}-${HEX16}-01`), `forbidden version ff`).toBeNull();
    expect(parseTraceparent(`00-${"0".repeat(32)}-${HEX16}-01`), `all-zero traceId`).toBeNull();
    expect(parseTraceparent(`00-${HEX32}-${"0".repeat(16)}-01`), `all-zero spanId`).toBeNull();
    expect(parseTraceparent(`00-${HEX32}-${HEX16}`), `missing flags`).toBeNull();
  });
});

describe("tracing: createChildSpan", () => {
  test("dari parent → same traceId, spanId baru, parentSpanId = parent.spanId", () => {
    const parent = parseTraceparent(`00-${HEX32}-${HEX16}-01`);
    const child = createChildSpan(parent);
    expect(child.traceId, `child inherits traceId`).toBe(parent!.traceId);
    expect(child.spanId, `child new spanId`).not.toBe(parent!.spanId);
    expect(child.spanId, `child spanId 16 hex`).toMatch(/^[0-9a-f]{16}$/);
    expect(child.parentSpanId, `parentSpanId = inbound span`).toBe(parent!.spanId);
    expect(child.flags, `flags inherited`).toBe(parent!.flags);
    expect(child.sampled, `sampled inherited`).toBe(parent!.sampled);
  });

  test("root (no parent) → fresh traceId + spanId", () => {
    const root = createChildSpan(null);
    expect(root.traceId, `root traceId fresh 32 hex`).toMatch(/^[0-9a-f]{32}$/);
    expect(root.traceId, `root traceId ≠ any fixed`).not.toBe(HEX32);
    expect(root.spanId, `root spanId 16 hex`).toMatch(/^[0-9a-f]{16}$/);
    expect(root.parentSpanId, `root kagak parent`).toBeNull();
    expect(root.version, `version 00`).toBe("00");
    expect(root.flags, `default flags 01`).toBe("01");
    expect(root.sampled, `default sampled`).toBe(true);
  });
});

describe("tracing: ensureTraceContext + ALS propagation", () => {
  test("ensureTraceContext sets store.trace; idempotent; inbound flag", () => {
    const store: any = { cookies: null, headers: null };
    const t1 = ensureTraceContext(store, `00-${HEX32}-${HEX16}-01`, "k=v");
    expect(t1, `trace set`).not.toBeNull();
    expect(t1!.inbound, `inbound true when parent`).toBe(true);
    expect(t1!.tracestate, `tracestate carried`).toBe("k=v");
    const t2 = ensureTraceContext(store, `00-${HEX32}-${HEX16}-01`, "k=v");
    expect(t2, `idempotent returns same`).toBe(t1);
    const root_store: any = { cookies: null, headers: null };
    const tr = ensureTraceContext(root_store, null, null);
    expect(tr!.inbound, `inbound false when root`).toBe(false);
  });

  test("getCurrentTrace inside scope returns trace; outside null", () => {
    const store: any = { cookies: null, headers: null };
    ensureTraceContext(store, `00-${HEX32}-${HEX16}-01`, null);
    expect(getCurrentTrace(), `outside scope null`).toBeNull();
    let seen: any = "untouched";
    cookieStoreAls.run(store, () => {
      seen = getCurrentTrace();
    });
    expect(seen?.traceId, `inside scope traceId`).toBe(HEX32);
    expect(getCurrentTrace(), `after scope null lagi`).toBeNull();
  });

  test("getCurrentTraceId mirrors scope traceId", () => {
    expect(getCurrentTraceId(), `outside null`).toBeNull();
    const store: any = { cookies: null, headers: null };
    ensureTraceContext(store, `00-${HEX32}-${HEX16}-01`, null);
    let id: string | null = null;
    cookieStoreAls.run(store, () => {
      id = getCurrentTraceId();
    });
    expect(id!, `inside scope id`).toBe(HEX32);
  });
});

describe("tracing: outbound + response stamping", () => {
  test("outboundTraceparent valid inside scope, null outside", () => {
    expect(outboundTraceparent(), `outside null`).toBeNull();
    const store: any = { cookies: null, headers: null };
    ensureTraceContext(store, `00-${HEX32}-${HEX16}-01`, null);
    let out: string | null = null;
    cookieStoreAls.run(store, () => {
      out = outboundTraceparent();
    });
    expect(out, `outbound non-null`).not.toBeNull();
    expect(out!, `outbound format`).toBe(`00-${HEX32}-${store.trace.spanId}-01`);
  });

  test("stampResponseWithTrace menambah x-swayrouter-trace-id + traceparent", () => {
    const trace = { version: "00", traceId: HEX32, spanId: HEX16, flags: "01" } as any;
    const resp = stampResponseWithTrace(new Response("ok", { status: 200 }), trace);
    expect(resp.headers.get("x-swayrouter-trace-id"), `trace-id header`).toBe(HEX32);
    expect(resp.headers.get("traceparent"), `traceparent header`).toBe(`00-${HEX32}-${HEX16}-01`);
  });

  test("stampResponseWithTrace no-op saat trace null", () => {
    const orig = new Response("ok");
    const resp = stampResponseWithTrace(orig, null);
    expect(resp.headers.get("x-swayrouter-trace-id"), `no header`).toBeNull();
  });

  test("stampResponseTrace ALS convenience stamps inside scope", () => {
    const store: any = { cookies: null, headers: null };
    ensureTraceContext(store, `00-${HEX32}-${HEX16}-01`, null);
    let stamped: Response | null = null;
    cookieStoreAls.run(store, () => {
      stamped = stampResponseTrace(new Response("ok"));
    });
    expect(stamped!.headers.get("x-swayrouter-trace-id"), `ALS stamp traceId`).toBe(HEX32);
  });
});
