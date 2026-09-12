import { describe, expect, test } from "bun:test";
import { DATA_FILE } from "@/lib/db/paths.js";
import { GET } from "./route.js";

describe("GET /api/settings/database/path", () => {
  test("returns only the resolved SQLite path with no-store caching", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ dbPath: DATA_FILE });
  });
});
