import { describe, expect, test, mock } from "bun:test";

// Driver selection: Postgres is the only driver. DB_URL is required — there is
// no file fallback after Swap B.
describe("db driver selection", () => {
  test("initAdapter throws without DB_URL", async () => {
    const original = process.env.DB_URL;
    delete process.env.DB_URL;
    try {
      // Fresh import so loadEnv re-reads the environment.
      const mod = await import(`./driver.js?nodb=${Date.now()}`);
      await expect(mod.initAdapter()).rejects.toThrow(/DB_URL/);
    } finally {
      if (original !== undefined) process.env.DB_URL = original;
    }
  });

  test("initAdapter returns the postgres adapter with DB_URL", async () => {
    if (!process.env.DB_URL) return; // dev/CI without a database skips
    const mod = await import(`./driver.js?withdb=${Date.now()}`);
    const adapter = await mod.initAdapter();
    expect(adapter.driver).toBe("postgres");
    expect(typeof adapter.run).toBe("function");
    expect(typeof adapter.transaction).toBe("function");
    await adapter.close();
  });

  test("getAdapterSync throws before initialization", async () => {
    const mod = await import(`./driver.js?sync=${Date.now()}`);
    expect(() => mod.getAdapterSync()).toThrow(/not initialized/);
  });

  test("setAdapterForTest injects a test adapter", async () => {
    const mod = await import(`./driver.js?inject=${Date.now()}`);
    const fake = { driver: "test", run: async () => ({ changes: 0, lastInsertRowid: null }) };
    await mod.setAdapterForTest(fake);
    expect(await mod.getAdapter()).toBe(fake);
  });
});
