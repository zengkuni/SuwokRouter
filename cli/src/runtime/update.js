const { spawn } = require("node:child_process");
const pkg = require("../../../package.json");
const { withProgress } = require("../cli/utils/display");

const REQUEST_TIMEOUT_MS = 2500;

function normalizeVersion(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function isNewerVersion(currentVersion, latestVersion) {
  return Boolean(normalizeVersion(currentVersion) && normalizeVersion(latestVersion)
    && compareVersions(latestVersion, currentVersion) > 0);
}

function registryUrl() {
  return String(process.env.SWAYROUTER_NPM_REGISTRY || "https://registry.npmjs.org").replace(/\/+$/, "");
}

async function checkForUpdate(fetchImpl = globalThis.fetch) {
  const currentVersion = String(pkg.version || "0.0.0");
  const packageName = process.env.SWAYROUTER_PACKAGE_NAME || pkg.name || "swayrouter";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let latestVersion = null;
  let checkError = null;
  try {
    const response = await fetchImpl(
      `${registryUrl()}/${encodeURIComponent(packageName)}/latest`,
      { headers: { accept: "application/json" }, signal: controller.signal },
    );
    if (response.ok) {
      const body = await response.json();
      latestVersion = typeof body?.version === "string" ? body.version.trim() : null;
    } else if (response.status !== 404) {
      checkError = `registry returned ${response.status}`;
    }
  } catch (error) {
    checkError = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }

  return {
    packageName,
    currentVersion,
    latestVersion,
    updateAvailable: isNewerVersion(currentVersion, latestVersion),
    updateSupported: pkg.private !== true && Boolean(latestVersion),
    checkedAt: new Date().toISOString(),
    checkError,
  };
}

function packageManager() {
  const customCommand = String(process.env.SWAYROUTER_PACKAGE_MANAGER_PATH || "").trim();
  if (customCommand) return { command: customCommand, args: ["install", "--global"] };

  const preferred = String(process.env.SWAYROUTER_PACKAGE_MANAGER || "").trim().toLowerCase();
  if (preferred === "npm") return { command: "npm", args: ["install", "--global"] };
  return { command: "bun", args: ["install", "--global"] };
}

function installPackageVersion(version) {
  if (pkg.private === true) {
    return Promise.reject(new Error("Package updates are unavailable for this private checkout"));
  }
  const manager = packageManager();
  const spec = `${process.env.SWAYROUTER_PACKAGE_NAME || pkg.name || "swayrouter"}@${version}`;
  return withProgress(`Updating Sway Router to v${version}`, (progress) => new Promise((resolve, reject) => {
    progress.update(35, "Preparing update");
    let child;
    try {
      child = spawn(manager.command, [...manager.args, spec], {
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    progress.update(55, `Installing v${version}`);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ manager: manager.command, version });
      else reject(new Error(`${manager.command} install failed with exit code ${code ?? "unknown"}`));
    });
  }), { indeterminate: true, doneMessage: `Sway Router updated to v${version}` });
}

module.exports = {
  checkForUpdate,
  compareVersions,
  installPackageVersion,
  isNewerVersion,
};
