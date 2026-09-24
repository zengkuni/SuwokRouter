import { describe, expect, test } from "bun:test";
import { makeKv } from "./kvStore.js";
import { createBunSqliteAdapter } from "../adapters/bunSqliteAdapter.js";
import { setAdapterForTest, closeAdapter } from "../driver.js";
import { rmSync } from "node:fs";

describe("kvStore async round-trip", () => {
  test("set/get/delete works through the async contract", async () => {
    const path = `${import.meta.dir}/.tmp-kv-${Date.now()}.sqlite`;
    const adapter = await createBunSqliteAdapter(path);
    await setAdapterForTest(adapter);
    try {
      await adapter.exec(
        `CREATE TABLE IF NOT EXISTS kv (scope TEXT, key TEXT, value TEXT, PRIMARY KEY (scope, key))`,
      );
      const kv = makeKv("test");
      expect(await kv.get("missing", "def")).toBe("def");
      await kv.set("a", { n: 1 });
      expect(await kv.get("a")).toEqual({ n: 1 });
      await kv.setMany({ b: "two", c: [1, 2] });
      expect(await kv.getAll()).toEqual({ a: { n: 1 }, b: "two", c: [1, 2] });
      await kv.remove("b");
      expect(await kv.get("b")).toBe(null);
      await kv.clear();
      expect(await kv.getAll()).toEqual({});
    } finally {
      try { await closeAdapter(); } catch {}
      try { await adapter.close(); } catch {}
      try { rmSync(path); } catch {}
    }
  });
});
