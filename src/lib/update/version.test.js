import { checkForUpdate, compareVersions, isNewerVersion, resetUpdateCheckCache } from "./version.js";
import pkg from "../../../package.json" with { type: "json" };

function nextPatchVersion(version) {
  const [major, minor, patch] = String(version).split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

describe("version update checks", () => {
  afterEach(() => resetUpdateCheckCache());

  test("compares stable and prerelease versions correctly", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.10")).toBeGreaterThan(0);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(false);
  });

  test("reads the latest version from the registry response", async () => {
    const latestVersion = nextPatchVersion(pkg.version);
    const result = await checkForUpdate({
      force: true,
      fetchImpl: async () => new Response(JSON.stringify({ version: latestVersion }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    expect(result.latestVersion).toBe(latestVersion);
    expect(result.updateAvailable).toBe(true);
    expect(result.packageName).toBe(pkg.name);
  });

  test("does not treat a missing package as an update error", async () => {
    const result = await checkForUpdate({
      force: true,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });

    expect(result.latestVersion).toBe(null);
    expect(result.updateAvailable).toBe(false);
    expect(result.checkError).toBe(null);
  });
});
