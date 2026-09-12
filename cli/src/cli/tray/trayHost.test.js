const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, expect, test } = require("bun:test");
const { acquireTrayLock, trayLockPath } = require("./trayHost");

describe("tray host singleton", () => {
  test("allows only one tray host for a data directory", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "swayrouter-tray-"));
    const installation = { dataDir, installDir: dataDir };
    const first = acquireTrayLock(installation, 14045);

    expect(first).not.toBeNull();
    expect(acquireTrayLock(installation, 14045)).toBeNull();

    first.release();
    expect(fs.existsSync(trayLockPath(installation))).toBe(false);

    const next = acquireTrayLock(installation, 14045);
    expect(next).not.toBeNull();
    next.release();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
