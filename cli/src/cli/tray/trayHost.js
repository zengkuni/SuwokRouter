const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const LOCK_FILE = "swayrouter-tray.json";

function defaultDataDirectory() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), ".swayrouter")
    : path.join(os.homedir(), ".swayrouter");
}

function trayLockPath(installation = {}) {
  const configured = String(installation.dataDir || "");
  const dataDir = configured && !configured.startsWith("docker-volume:")
    ? configured
    : defaultDataDirectory();
  return path.join(dataDir, "runtime", LOCK_FILE);
}

function readLock(lockPath) {
  try {
    const record = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return Number.isInteger(record?.pid) && record.pid > 0 ? record : null;
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeLockIfOwned(lockPath, pid) {
  const record = readLock(lockPath);
  if (record?.pid !== pid) return false;
  try { fs.rmSync(lockPath, { force: true }); } catch {}
  return true;
}

function stopLegacyTrayHosts(installation) {
  if (process.platform !== "win32") return 0;

  const lockPath = trayLockPath(installation);
  const activePid = readLock(lockPath)?.pid || 0;
  const installDir = path.resolve(installation.installDir || process.cwd())
    .toLowerCase()
    .replace(/'/g, "''");
  const script = [
    `$currentPid = ${process.pid}`,
    `$activePid = ${activePid}`,
    `$installDir = '${installDir}'`,
    "$trayPids = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -match '^(node|bun)(\\.exe)?$' -and",
    "  $_.ProcessId -ne $currentPid -and",
    "  $_.ProcessId -ne $activePid -and",
    "  $_.CommandLine -and",
    "  $_.CommandLine.ToLowerInvariant().Contains('--tray') -and",
    "  $_.CommandLine.ToLowerInvariant().Contains($installDir)",
    "} | Select-Object -ExpandProperty ProcessId",
    "$trayPids",
  ].join("; ");

  let pids = [];
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    pids = String(output).split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return 0;
  }

  for (const pid of new Set(pids)) {
    try {
      execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {}
  }
  return new Set(pids).size;
}

function acquireTrayLock(installation, port) {
  const lockPath = trayLockPath(installation);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify({
        pid: process.pid,
        installDir: path.resolve(installation.installDir || process.cwd()),
        port: Number(port) || 14045,
        startedAt: new Date().toISOString(),
      })}\n`);
      fs.closeSync(fd);

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.removeListener("exit", release);
        removeLockIfOwned(lockPath, process.pid);
      };
      process.once("exit", release);
      return { lockPath, release };
    } catch (error) {
      if (error?.code !== "EEXIST") return null;
      const existing = readLock(lockPath);
      if (existing?.pid && processAlive(existing.pid)) return null;
      try { fs.rmSync(lockPath, { force: true }); } catch {}
    }
  }

  return null;
}

async function stopTrayHost(installation) {
  const lockPath = trayLockPath(installation);
  const record = readLock(lockPath);
  if (!record || record.pid === process.pid) return false;

  if (processAlive(record.pid)) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(record.pid)], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        try { process.kill(-record.pid, "SIGTERM"); } catch { process.kill(record.pid, "SIGTERM"); }
      }
    } catch {}

    const deadline = Date.now() + 2500;
    while (processAlive(record.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  if (!processAlive(record.pid)) removeLockIfOwned(lockPath, record.pid);
  return true;
}

module.exports = { acquireTrayLock, stopLegacyTrayHosts, stopTrayHost, trayLockPath };
