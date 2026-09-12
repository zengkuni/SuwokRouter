import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import pkg from "../../../package.json" with { type: "json" };

function isDockerRuntime() {
  return process.env.SWAYROUTER_RUNTIME_MODE === "docker"
    || process.env.DATA_DIR === "/app/data"
    || existsSync("/.dockerenv");
}

export function canInstallUpdate() {
  return pkg.private !== true && !isDockerRuntime();
}

function updateCommand() {
  const customCommand = String(process.env.SWAYROUTER_PACKAGE_MANAGER_PATH || "").trim();
  if (customCommand) return { command: customCommand, args: ["install", "--global"] };

  const preferred = String(process.env.SWAYROUTER_PACKAGE_MANAGER || "").trim().toLowerCase();
  if (preferred === "npm") return { command: "npm", args: ["install", "--global"] };
  if (preferred === "bun") return { command: process.execPath, args: ["install", "--global"] };
  return { command: process.execPath, args: ["install", "--global"] };
}

export function installPackageVersion(version) {
  if (!canInstallUpdate()) {
    return Promise.reject(new Error("Package updates are unavailable for this runtime"));
  }
  const spec = `${pkg.name || "swayrouter"}@${version}`;
  const update = updateCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(update.command, [...update.args, spec], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const capture = (chunk) => {
      output += String(chunk);
      if (output.length > 4000) output = output.slice(-4000);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ version, packageName: pkg.name || "swayrouter", manager: update.command, output });
      } else {
        reject(new Error(`${update.command} install failed${code === null ? "" : ` with exit code ${code}`}`));
      }
    });
  });
}
