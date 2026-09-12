const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { selectMenu, pause } = require("../cli/utils/input");
const { showStatus, withProgress } = require("../cli/utils/display");
const { openBrowser } = require("./uiAdapters");
const { installPackageVersion } = require("./update");
const lifecycle = require("./lifecycle");
const { initTray, killTray } = require("../cli/tray/tray");
const { acquireTrayLock, stopLegacyTrayHosts, stopTrayHost } = require("../cli/tray/trayHost");
const pkg = require("../../../package.json");

function trayOptions(installation, port) {
  return {
    port,
    onOpenDashboard: () => openBrowser(dashboardUrl(installation, port)),
    onQuit: () => {
      try { lifecycle.stop(installation); } catch {}
    },
  };
}

function initializeTray(installation, port) {
  try { return initTray(trayOptions(installation, port)); } catch { return null; }
}

function trayHostArgs(installation, port) {
  const cliEntry = path.resolve(__dirname, "..", "..", "cli.js");
  const args = [];
  if (fs.existsSync(cliEntry)) args.push(cliEntry);
  args.push("--tray", "--skip-update", "--dir", installation.installDir, "--port", String(port));
  if (installation.host) args.push("--host", installation.host);
  return args;
}

function startTrayHost(installation, port) {
  try {
    stopLegacyTrayHosts(installation);
    const child = spawn(process.execPath, trayHostArgs(installation, port), {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    return child.pid || true;
  } catch {
    return null;
  }
}

async function runTrayHost(installation, options = {}) {
  const port = Number(options.port || installation.port || 14045);
  const trayLock = acquireTrayLock(installation, port);
  if (!trayLock) return;

  let running = lifecycle.status(installation).running;
  if (!running) {
    running = await lifecycle.waitForReady(port, {
      host: options.host || installation.host,
      timeoutMs: 3000,
      intervalMs: 100,
    });
  }
  if (!running) {
    await withProgress("Starting Sway Router", (progress) => {
      progress.update(35, "Starting Sway Router");
      return lifecycle.start(installation, {
        background: true,
        showLog: options.showLog,
        port,
        host: options.host,
      });
    }, { doneMessage: "Sway Router started" });
  }

  const tray = initializeTray(installation, port);
  if (!tray) {
    trayLock.release();
    return;
  }

  const shutdown = () => {
    try { lifecycle.stop(installation); } catch {}
    try { void killTray(); } catch {}
    trayLock.release();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise(() => {});
}

function isHeadless() {
  return process.platform === "linux" && !process.env.DISPLAY;
}

function backgroundStatusMessage(installation, port) {
  const suffix = isHeadless() ? " (headless mode; no system tray)" : "";
  return `Sway Router is running in background at ${dashboardUrl(installation, port)}${suffix}`;
}

function startTrayForMenu(installation, port) {
  return startTrayHost(installation, port);
}

function dashboardUrl(installation, port) {
  return `http://localhost:${port || installation.port || 14045}/dashboard`;
}

async function startAndShow(installation, options, background) {
  try {
    const result = await withProgress("Starting Sway Router", (progress) => {
      progress.update(35, "Starting Sway Router");
      return lifecycle.start(installation, { ...options, background });
    }, { doneMessage: "Sway Router started" });
    if (background) {
      const tray = startTrayForMenu(installation, result.port);
      showStatus(`${backgroundStatusMessage(installation, result.port)}${tray ? " with the tray enabled" : ""}`, "success");
    } else {
      showStatus(`Sway Router is ready at ${dashboardUrl(installation, result.port)}`, "success");
    }
    return true;
  } catch (error) {
    showStatus(error.message, "error");
    return false;
  }
}

async function closeTray(installation) {
  try { await killTray(); } catch {}
  try { await stopTrayHost(installation); } catch {}
  try { stopLegacyTrayHosts(installation); } catch {}
}

async function disableTray(installation) {
  await closeTray(installation);
}

function menuItems(updateInfo = null) {
  const items = [
    { id: "background", label: "Run in Background / Tray" },
    { id: "restart", label: "Restart Sway Router" },
    { id: "stop", label: "Stop Sway Router" },
  ];
  if (updateInfo?.updateAvailable && updateInfo.updateSupported && updateInfo.latestVersion) {
    items.push({ id: "update", label: `Update to v${updateInfo.latestVersion}` });
  }
  items.push({ id: "exit", label: "Exit & Stop Router" });
  return items;
}

async function stopManaged(installation) {
  const result = await withProgress("Stopping Sway Router", () => lifecycle.stop(installation), {
    doneMessage: "Sway Router stopped",
  });
  await disableTray(installation);
  return result;
}

function currentStatus(installation) {
  return lifecycle.status(installation);
}

function menuStatusText(status, version = pkg.version) {
  return `Status: ${status.running ? "running" : "stopped"}\nCurrent Version: v${version}`;
}

async function stopWithMessage(installation) {
  const result = await stopManaged(installation);
  showStatus(result.stopped ? "Sway Router stopped." : "Sway Router was not running.", result.stopped ? "success" : "info");
}

async function updateAndRestart(installation, options, updateInfo) {
  const wasRunning = currentStatus(installation).running;
  if (wasRunning) await stopManaged(installation);
  try {
    await installPackageVersion(updateInfo.latestVersion);
  } catch (error) {
    if (wasRunning) await startAndShow(installation, options, true);
    showStatus(error.message, "error");
    return false;
  }

  if (wasRunning) {
    const restarted = await startAndShow(installation, options, true);
    if (!restarted) return false;
  }
  showStatus(`Updated to v${updateInfo.latestVersion}. Closing menu.`, "success");
  return true;
}

async function runMenu(installation, options = {}) {
  const port = Number(options.port || installation.port || 14045);
  const updateInfo = options.updateInfo || null;
  while (true) {
    const current = currentStatus(installation);
    const items = menuItems(updateInfo);
    const selected = await selectMenu(
      "Sway Router",
      items,
      0,
      menuStatusText(current),
      `Dashboard: ${dashboardUrl(installation, port)}`,
    );
    if (selected === null) return 0;
    const selectedItem = items[selected];
    if (!selectedItem || selectedItem.id === "exit" || selected < 0) {
      await stopWithMessage(installation);
      return 0;
    }
    if (selectedItem.id === "background") {
      if (current.running) {
        const tray = startTrayForMenu(installation, port);
        showStatus(`Sway Router will keep running in the background${tray ? " with the tray enabled" : ""}. Closing menu.`, "success");
      } else {
        const started = await startAndShow(installation, options, true);
        if (!started) {
          await pause("Press Enter to return to the menu...");
          continue;
        }
      }
      return 0;
    }
    if (selectedItem.id === "restart") {
      if (!currentStatus(installation).running) {
        showStatus("Sway Router is stopped. Start it with `swayrouter start` first.", "warning");
      } else {
        await stopManaged(installation);
        await startAndShow(installation, options, true);
      }
      await pause("Press Enter to return to the menu...");
      continue;
    }
    if (selectedItem.id === "stop") {
      if (!currentStatus(installation).running) {
        showStatus("Sway Router is already stopped.", "info");
      } else {
        await stopWithMessage(installation);
      }
      await pause("Press Enter to return to the menu...");
      continue;
    }
    if (selectedItem.id === "update") {
      const updated = await updateAndRestart(installation, options, updateInfo);
      if (updated) return 0;
      await pause("Press Enter to return to the menu...");
    }
  }
}

module.exports = { runMenu, dashboardUrl, menuItems, menuStatusText, runTrayHost, startTrayHost };
