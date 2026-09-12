import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:").replace(/\/$/, "");
const outDir = join(root, "dist-binary");
const platformTarget = process.platform === "win32"
  ? "bun-windows-x64"
  : process.platform === "darwin"
    ? (process.arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64")
    : (process.arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64");
const target = process.env.BUN_TARGET || platformTarget;
const binary = join(outDir, target.includes("windows") ? "swayrouter.exe" : "swayrouter");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForReady(port, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Compiled binary exited before readiness (${child.exitCode})\n${output.join("").slice(-4000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`Compiled binary did not become ready\n${output.join("").slice(-4000)}`);
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return Promise.resolve();
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    Bun.sleep(timeoutMs).then(() => false),
  ]);
  if (exited || child.exitCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    Bun.sleep(timeoutMs),
  ]);
}

const dataDir = await mkdtemp(join(tmpdir(), "sway-binary-smoke-"));
const port = await freePort();
const childEnv = { ...process.env };
delete childEnv.JWT_SECRET;
delete childEnv.API_KEY_SECRET;
delete childEnv.MACHINE_ID_SALT;
Object.assign(childEnv, {
  NODE_ENV: "production",
  DATA_DIR: dataDir,
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
});

const output = [];
const child = spawn(binary, [], {
  cwd: outDir,
  env: childEnv,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => output.push(String(chunk)));
child.stderr.on("data", (chunk) => output.push(String(chunk)));

try {
  await waitForReady(port, child, output);
  const [ready, version, login] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/health/ready`),
    fetch(`http://127.0.0.1:${port}/api/version`),
    fetch(`http://127.0.0.1:${port}/login`),
  ]);
  if (!ready.ok || !version.ok || !login.ok) {
    throw new Error(`Compiled binary smoke failed: ready=${ready.status}, version=${version.status}, login=${login.status}`);
  }
  console.log(`Compiled binary smoke passed on 127.0.0.1:${port}`);
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await waitForExit(child);
  await rm(dataDir, { recursive: true, force: true });
}
