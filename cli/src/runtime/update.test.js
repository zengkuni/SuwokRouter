const { checkForUpdate, compareVersions, isNewerVersion } = require("./update");
const pkg = require("../../../package.json");

function nextPatchVersion(version) {
  const [major, minor, patch] = String(version).split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

describe("CLI version update checks", () => {
  test("compares stable and prerelease versions correctly", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(false);
  });

  test("reads a newer registry version", async () => {
    const latestVersion = nextPatchVersion(pkg.version);
    const result = await checkForUpdate(async () => new Response(JSON.stringify({ version: latestVersion }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    expect(result.latestVersion).toBe(latestVersion);
    expect(result.updateAvailable).toBe(true);
  });
});
