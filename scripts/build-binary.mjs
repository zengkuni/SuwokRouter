import { mkdir, cp, rm } from "node:fs/promises";
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
const outputName = target.includes("windows") ? "swayrouter.exe" : "swayrouter";
const output = join(outDir, outputName);

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await run(process.platform === "win32" ? "bun.exe" : "bun", ["run", "build"], join(root, "dashboard"));
await run(process.platform === "win32" ? "bun.exe" : "bun", ["build", "--compile", "--minify", "--bytecode", "src/server.ts", "--outfile", output, ...(target ? ["--target", target] : [])]);
await cp(join(root, "dashboard", "dist"), join(outDir, "dashboard", "dist"), { recursive: true });
await cp(join(root, "dashboard", "public"), join(outDir, "dashboard", "public"), { recursive: true });
await cp(join(root, "src", "lib", "db", "migrations"), join(outDir, "migrations"), { recursive: true });
await cp(join(root, "package.json"), join(outDir, "package.json"));
await cp(join(root, "src", "shared", "constants", "config.js"), join(outDir, "src", "shared", "constants", "config.js"), { recursive: true });
await Bun.write(join(outDir, "BUILD_TARGET"), `${target}\n`);
console.log(`Binary package ready: ${output}`);
