const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { findCommand } = require("./discover");

const DEFAULT_PORT = 14045;
const READY_PATH = "/api/health/ready";

function localHost(host) {
  return !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function waitForReady(port, {
  host = "127.0.0.1",
  pathName = READY_PATH,
  timeoutMs = 30000,
  intervalMs = 250,
} = {}) {
  const targetHost = localHost(host);
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;
    const finish = (ready) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(ready);
    };
    const attempt = () => {
      if (finished) return;
      if (Date.now() >= deadline) return finish(false);
      let attemptFinished = false;
      const request = http.get({
        host: targetHost,
        port,
        path: pathName,
        timeout: Math.min(1000, Math.max(100, deadline - Date.now())),
        headers: { accept: "application/json" },
      }, (response) => {
        response.resume();
        const ready = response.statusCode >= 200 && response.statusCode < 300;
        response.once("end", () => {
          if (attemptFinished) return;
          attemptFinished = true;
          if (ready) finish(true);
          else schedule();
        });
      });
      const retry = () => {
        if (attemptFinished) return;
        attemptFinished = true;
        request.destroy();
        schedule();
      };
      request.once("error", retry);
      request.once("timeout", retry);
    };
    const schedule = () => {
      if (finished) return;
      if (Date.now() >= deadline) return finish(false);
      timer = setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}

function composeArguments(installation, args) {
  const composeFile = installation.composeFile || path.join(installation.installDir, "docker-compose.yml");
  return ["compose", "-f", composeFile, "--project-directory", installation.installDir, ...args];
}

function runDocker(installation, args, { stdio = "inherit" } = {}) {
  const compose = findCommand("docker");
  if (!compose) throw new Error("Docker is not installed or is not available on PATH");
  return spawn(compose, composeArguments(installation, args), {
    stdio,
    windowsHide: true,
  });
}

function runDockerSync(installation, args) {
  const compose = findCommand("docker");
  if (!compose) throw new Error("Docker is not installed or is not available on PATH");
  return execFileSync(compose, composeArguments(installation, args), {
    encoding: "utf8",
    windowsHide: true,
    stdio: "pipe",
  });
}

function buildNativeEnv(installation, { host, port } = {}, baseEnv = process.env) {
  const targetPort = Number(port || installation.port || DEFAULT_PORT);
  const targetHost = host || installation.host || "127.0.0.1";
  const env = {
    ...baseEnv,
    ...(installation.env || {}),
    NODE_ENV: installation.env?.NODE_ENV || baseEnv.NODE_ENV || "production",
    PORT: String(targetPort),
    HOSTNAME: targetHost,
  };
  if (installation.dataDir && !String(installation.dataDir).startsWith("docker-volume:")) {
    env.DATA_DIR = installation.dataDir;
  }
  return env;
}

function spawnNative(installation, { host, port, showLog = false, detached = false } = {}) {
  const targetPort = Number(port || installation.port || DEFAULT_PORT);
  const isBinary = installation.mode === "binary";
  const command = isBinary ? installation.binaryFile : findCommand("bun");
  if (!command) {
    throw new Error(isBinary
      ? "Compiled Sway Router binary was not found"
      : "Bun is required to run a native source installation");
  }
  const args = isBinary
    ? []
    : ["--dns-result-order=ipv4first", "--max-old-space-size=6144", installation.sourceFile];
  const stdio = detached ? "ignore" : "inherit";
  const env = buildNativeEnv(installation, { host, port: targetPort });
  const child = spawn(command, args, {
    cwd: installation.installDir,
    detached,
    windowsHide: true,
    stdio,
    env,
  });
  if (detached) child.unref();
  return child;
}

function dataDirectory(installation) {
  if (installation.dataDir && !String(installation.dataDir).startsWith("docker-volume:")) return installation.dataDir;
  return path.join(process.platform === "win32"
    ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"))
    : os.homedir(), ".swayrouter");
}

function pidFile(installation) {
  return path.join(dataDirectory(installation), "runtime", "swayrouter.pid");
}

function readPidRecord(installation) {
  try {
    const text = fs.readFileSync(pidFile(installation), "utf8").trim();
    if (!text) return null;
    if (text.startsWith("{")) {
      const record = JSON.parse(text);
      return Number.isInteger(record.pid) && record.pid > 0 ? record : null;
    }
    const pid = Number.parseInt(text, 10);
    return Number.isInteger(pid) && pid > 0 ? { pid, legacy: true } : null;
  } catch {
    return null;
  }
}

function readPid(installation) {
  return readPidRecord(installation)?.pid || null;
}

function writePid(installation, pid) {
  const file = pidFile(installation);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const record = {
    pid,
    installDir: path.resolve(installation.installDir),
    executable: installation.binaryFile || installation.sourceFile,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}

function removePid(installation) {
  try { fs.rmSync(pidFile(installation), { force: true }); } catch {}
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function ownsProcess(installation, record) {
  if (!record || record.legacy || !processAlive(record.pid)) return false;
  const expectedInstallDir = path.resolve(installation.installDir).toLowerCase();
  const storedInstallDir = record.installDir
    ? path.resolve(record.installDir).toLowerCase()
    : "";
  if (!storedInstallDir || storedInstallDir !== expectedInstallDir) return false;

  const expectedExecutable = installation.mode === "binary"
    ? installation.binaryFile
    : installation.sourceFile;
  if (!expectedExecutable || !record.executable) return false;
  return path.resolve(record.executable).toLowerCase()
    === path.resolve(expectedExecutable).toLowerCase();
}

function stopNative(installation) {
  const stored = readPidRecord(installation);
  const record = ownsProcess(installation, stored) ? stored : null;
  if (!record || !processAlive(record.pid)) {
    if (stored) removePid(installation);
    return { stopped: false, reason: "no managed process" };
  }
  if (!ownsProcess(installation, record)) {
    return { stopped: false, reason: "managed PID does not belong to this installation", pid: record.pid };
  }
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(record.pid)], { stdio: "ignore", windowsHide: true });
    } else {
      try { process.kill(-record.pid, "SIGTERM"); } catch { process.kill(record.pid, "SIGTERM"); }
    }
  } catch {
    try { process.kill(record.pid, "SIGTERM"); } catch {}
  }
  removePid(installation);
  return { stopped: true, pid: record.pid };
}

function waitForProcessOrReady(child, port, host) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      callback(value);
    };
    const onError = (error) => finish(reject, error);
    const onClose = (code, signal) => finish(reject, new Error(`Sway Router exited before readiness (code=${code ?? "unknown"}, signal=${signal || "none"})`));
    child.once("error", onError);
    child.once("close", onClose);
    waitForReady(port, { host }).then((ready) => {
      if (ready) finish(resolve, true);
      else finish(reject, new Error(`Sway Router did not become ready on port ${port}`));
    });
  });
}

async function start(installation, { background = false, showLog = false, port, host } = {}) {
  const targetPort = Number(port || installation.port || DEFAULT_PORT);
  const targetHost = localHost(host || installation.host);
  if (status(installation).running) throw new Error("Sway Router is already running; stop it before starting again");

  if (installation.mode === "docker") {
    const child = runDocker(installation, background ? ["up", "-d"] : ["up"]);
    if (background) {
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Docker Compose exited with ${code}`)));
      });
      if (!await waitForReady(targetPort, { host: targetHost })) {
        throw new Error(`Sway Router did not become ready on port ${targetPort}`);
      }
    } else {
      await waitForProcessOrReady(child, targetPort, targetHost);
    }
    return { port: targetPort, background, ready: true, child };
  }

  const child = spawnNative(installation, { host, port: targetPort, showLog, detached: background });
  if (!child.pid) throw new Error("Sway Router process did not start");
  writePid(installation, child.pid);
  child.once("error", () => removePid(installation));
  child.once("close", () => removePid(installation));
  try {
    const ready = await waitForReady(targetPort, { host: targetHost });
    if (!ready) throw new Error(`Sway Router did not become ready on port ${targetPort}`);
  } catch (error) {
    stopNative(installation);
    throw error;
  }
  return { port: targetPort, background, ready: true, child };
}

function stop(installation) {
  if (installation.mode === "docker") {
    try {
      runDockerSync(installation, ["down", "--remove-orphans"]);
      return { stopped: true };
    } catch (error) {
      throw new Error(`Docker Compose stop failed: ${error.message}`);
    }
  }
  return stopNative(installation);
}

function parseDockerStatus(output) {
  const text = String(output || "").trim();
  if (!text || text === "[]") return { running: false, detail: "stopped" };
  try {
    const parsed = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const running = records.some((record) => {
      const state = String(record?.State || record?.state || record?.Status || record?.status || "").toLowerCase();
      return state === "running" || state.startsWith("up") || state.includes("running");
    });
    return { running, detail: text };
  } catch {
    return { running: /\brunning\b|\bup\b/i.test(text), detail: text };
  }
}

function status(installation) {
  if (installation.mode === "docker") {
    try { return parseDockerStatus(runDockerSync(installation, ["ps", "--format", "json"])); }
    catch (error) { return { running: false, detail: error.message }; }
  }
  const stored = readPidRecord(installation);
  if (ownsProcess(installation, stored)) return { running: true, pid: stored.pid };
  return { running: false, pid: stored?.pid || null };
}

module.exports = {
  waitForReady,
  start,
  stop,
  status,
  spawnNative,
  runDocker,
  runDockerSync,
  buildNativeEnv,
  pidFile,
  readPid,
  parseDockerStatus,
  writePid,
};
