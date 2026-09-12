const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const INSTALL_MANIFEST = ".swayrouter-install.json";
const REGISTRATION_FILE = "install.json";
const LEGACY_BUNDLED_ERROR = "This bundled npm installation is no longer supported. Reinstall from a source checkout or prepare it with Docker.";

function defaultDataDir() {
  if (process.env.DATA_DIR && !(process.platform === "win32" && /^\//.test(process.env.DATA_DIR))) {
    return process.env.DATA_DIR;
  }
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), ".swayrouter")
    : path.join(os.homedir(), ".swayrouter");
}

function candidateInstallDirs() {
  const dirs = [];
  if (process.env.SWAY_ROUTER_DIR) dirs.push(process.env.SWAY_ROUTER_DIR);
  if (process.platform === "win32") {
    dirs.push(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SwayRouter"));
  } else {
    dirs.push(path.join(os.homedir(), ".local", "share", "swayrouter"));
    dirs.push("/opt/swayrouter");
  }
  return dirs;
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readDotEnv(file) {
  const values = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\$\$/g, "$");
      } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      values[match[1]] = value;
    }
  } catch {}
  return values;
}

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function dirExists(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

function inspectDirectory(dir, manifest = null) {
  if (!dir || !dirExists(dir)) return null;
  const resolved = path.resolve(dir);
  const localManifest = manifest || readJson(path.join(resolved, INSTALL_MANIFEST));
  if (localManifest?.mode === "bundled") throw new Error(LEGACY_BUNDLED_ERROR);

  const composeFile = localManifest?.composeFile && fileExists(localManifest.composeFile)
    ? localManifest.composeFile
    : (fileExists(path.join(resolved, "docker-compose.yml")) ? path.join(resolved, "docker-compose.yml") : null);
  const sourceFile = fileExists(path.join(resolved, "src", "server.ts")) ? path.join(resolved, "src", "server.ts") : null;
  const binaryNames = process.platform === "win32" ? ["swayrouter.exe"] : ["swayrouter"];
  const binaryFile = binaryNames.map((name) => path.join(resolved, name)).find(fileExists) || null;
  if (!composeFile && !sourceFile && !binaryFile && !localManifest) return null;
  const mode = localManifest?.mode || (composeFile ? "docker" : binaryFile && !sourceFile ? "binary" : "native");
  const manifestDataDir = localManifest?.dataDir;
  const dataDir = manifestDataDir && !String(manifestDataDir).startsWith("docker-volume:")
    ? manifestDataDir
    : defaultDataDir();
  return {
    mode,
    installDir: resolved,
    composeFile,
    sourceFile,
    binaryFile,
    dataDir,
    env: mode === "docker" ? {} : readDotEnv(path.join(resolved, ".env")),
    dockerVolume: manifestDataDir && String(manifestDataDir).startsWith("docker-volume:")
      ? String(manifestDataDir).slice("docker-volume:".length)
      : null,
    port: Number(localManifest?.port) || 14045,
    host: localManifest?.host || "127.0.0.1",
    manifest: localManifest,
  };
}

function loadRegisteredInstallation() {
  const registration = readJson(path.join(defaultDataDir(), REGISTRATION_FILE));
  if (!registration?.installDir) return null;
  return inspectDirectory(registration.installDir, registration);
}

function findCommand(command) {
  try {
    const resolver = process.platform === "win32" ? "where.exe" : "which";
    return execFileSync(resolver, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

function discoverInstall({ dir, cliDirectory } = {}) {
  const explicit = dir || process.env.SWAY_ROUTER_DIR;
  if (explicit) return inspectDirectory(explicit);

  const registered = loadRegisteredInstallation();
  if (registered) return registered;

  const repositoryRoot = path.resolve(cliDirectory || path.join(__dirname, "..", "..", ".."));
  const local = inspectDirectory(repositoryRoot);
  if (local) return local;

  const binaryNames = process.platform === "win32" ? ["swayrouter.exe"] : ["swayrouter"];
  const siblingCandidates = [
    ...binaryNames.map((name) => path.join(cliDirectory || path.join(__dirname, "..", "..", ".."), name)),
    ...binaryNames.map((name) => path.join(__dirname, "..", "..", name)),
  ];
  for (const binary of siblingCandidates) {
    if (fileExists(binary)) return inspectDirectory(path.dirname(binary));
  }

  for (const candidate of candidateInstallDirs()) {
    const found = inspectDirectory(candidate);
    if (found) return found;
  }
  return null;
}

module.exports = {
  INSTALL_MANIFEST,
  LEGACY_BUNDLED_ERROR,
  defaultDataDir,
  findCommand,
  readDotEnv,
  inspectDirectory,
  discoverInstall,
};
