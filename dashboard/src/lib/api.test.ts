import { describe, expect, test } from "bun:test";
import { beautifyPath, compactDatabasePath } from "@/lib/api";

describe("beautifyPath", () => {
  test("masks a Windows home directory", () => {
    expect(beautifyPath("C:\\Users\\operator\\AppData\\Roaming\\.swayrouter\\db\\data.sqlite"))
      .toBe("~\\AppData\\Roaming\\.swayrouter\\db\\data.sqlite");
    expect(beautifyPath("D:/Users/operator/.swayrouter/db/data.sqlite"))
      .toBe("~/.swayrouter/db/data.sqlite");
  });

  test("masks Linux and macOS home directories", () => {
    expect(beautifyPath("/home/operator/.swayrouter/db/data.sqlite"))
      .toBe("~/.swayrouter/db/data.sqlite");
    expect(beautifyPath("/Users/operator/.swayrouter/db/data.sqlite"))
      .toBe("~/.swayrouter/db/data.sqlite");
  });

  test("keeps empty and non-home paths usable", () => {
    expect(beautifyPath(undefined)).toBe("");
    expect(beautifyPath(null)).toBe("");
    expect(beautifyPath("./data/db/data.sqlite")).toBe("./data/db/data.sqlite");
    expect(beautifyPath("/var/lib/swayrouter/db/data.sqlite"))
      .toBe("/var/lib/swayrouter/db/data.sqlite");
    expect(beautifyPath("\\\\server\\share\\data.sqlite"))
      .toBe("\\\\server\\share\\data.sqlite");
  });

  test("renders the compact logical SQLite location", () => {
    expect(compactDatabasePath("/home/operator/.swayrouter/db/data.sqlite"))
      .toBe("~/.swayrouter/data.sqlite");
    expect(compactDatabasePath("C:\\Users\\operator\\AppData\\Roaming\\.swayrouter\\db\\data.sqlite"))
      .toBe("~/.swayrouter/data.sqlite");
    expect(compactDatabasePath("/srv/swayrouter/db/data.sqlite"))
      .toBe("/srv/swayrouter/data.sqlite");
    expect(compactDatabasePath(undefined)).toBe("");
  });
});
