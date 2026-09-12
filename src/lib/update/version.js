import pkg from "../../../package.json" with { type: "json" };

const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

let cachedCheck = null;

function packageName() {
  return process.env.SWAYROUTER_PACKAGE_NAME || pkg.name || "swayrouter";
}

function registryUrl() {
  return String(process.env.SWAYROUTER_NPM_REGISTRY || "https://registry.npmjs.org").replace(/\/+$/, "");
}

function normalizeVersion(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    raw: String(value).trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;

  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function isNewerVersion(currentVersion, latestVersion) {
  return Boolean(normalizeVersion(currentVersion) && normalizeVersion(latestVersion)
    && compareVersions(latestVersion, currentVersion) > 0);
}

async function fetchLatestVersion(fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${registryUrl()}/${encodeURIComponent(packageName())}/latest`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`registry returned ${response.status}`);
    const body = await response.json();
    return typeof body?.version === "string" ? body.version.trim() : null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForUpdate({ force = false, fetchImpl = globalThis.fetch } = {}) {
  const currentVersion = String(pkg.version || "0.0.0");
  const now = Date.now();
  if (!force && cachedCheck && now - cachedCheck.timestamp < CHECK_TTL_MS) {
    return { ...cachedCheck.value };
  }

  let latestVersion = null;
  let checkError = null;
  try {
    latestVersion = await fetchLatestVersion(fetchImpl);
  } catch (error) {
    checkError = error instanceof Error ? error.message : String(error);
  }

  const value = {
    packageName: packageName(),
    currentVersion,
    latestVersion,
    updateAvailable: isNewerVersion(currentVersion, latestVersion),
    updateSupported: pkg.private !== true && Boolean(latestVersion),
    checkedAt: new Date().toISOString(),
    checkError,
  };
  cachedCheck = { timestamp: now, value };
  return { ...value };
}

export function resetUpdateCheckCache() {
  cachedCheck = null;
}
