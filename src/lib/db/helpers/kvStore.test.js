import { describe, expect, test } from "bun:test";
import { makeKv } from "./kvStore.js";
import { createPostgresAdapter } from "../adapters/postgresAdapter.js";
import { setAdapterForTest, closeAdapter } from "../driver.js";
import postgres from "postgres";

const DB_URL = process.env.DB_URL || "";
const maybe = DB_URL ? describe : describe.skip;

maybe("kvStore async round-trip", () => {
  test("set/get/delete works through the async contract", async () => {
    const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
    const adapter = createPostgresAdapter({ pool: sql });
    const scope = `test-${Math.random().toString(36).slice(2, 8)}`;
    await setAdapterForTest(adapter);
    try {
      const kv = makeKv(scope);
      expect(await kv.get("missing", "def")).toBe("def");
      await kv.set("a", { n: 1 });
      expect(await kv.get("a")).toEqual({ n: 1 });
      await kv.setMany({ b: "two", c: [1, 2] });
      expect(await kv.get("b")).toBe("two");
      expect(await kv.get("c")).toEqual([1, 2]);
      await kv.remove("a");
      expect(await kv.get("a", "gone")).toBe("gone");
    } finally {
      await adapter.run("DELETE FROM kv WHERE scope = $1", [scope]);
      await adapter.close();
      // Never leave the contract adapter in the process-global state.
      await closeAdapter();
    }
  });
});
