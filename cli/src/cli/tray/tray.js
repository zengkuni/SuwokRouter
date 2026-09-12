const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

let trayInstance = null;
let isWinTray = false;

function getIconBase64() {
  const isWin = process.platform === "win32";
  const iconFile = isWin ? "icon.ico" : "icon.png";
  try {
    const iconPath = path.join(__dirname, iconFile);
    if (fs.existsSync(iconPath)) {
      return fs.readFileSync(iconPath).toString("base64");
    }
  } catch (e) {}

  return "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAHpJREFUOE9jYBgFgwEwMjIy/Gdg+P8fyP4PxP8ZGBgEcBnGyMjIsICBgSEAhyH/gfgBUNN8XJoZsdkCVL8Ah+b/QPwbqvkBMvk/AwMDAzYX/GdgYAhAN+A/SICRWAMYGfFEJSMjzriEiwDR/xmIa2RkZCSqnZERb3QCAAo3KxzxbKe1AAAAAElFTkSuQmCC";
}

function isTraySupported() {
  const platform = process.platform;
  if (!["darwin", "win32", "linux"].includes(platform)) {
    return false;
  }
  if (platform === "linux" && !process.env.DISPLAY) {
    return false;
  }
  return true;
}

function initTray(options) {
  if (!isTraySupported()) {
    return null;
  }

  if (process.platform === "win32") {
    return initWindowsTray(options);
  }
  return initUnixTray(options);
}

function buildMenuItems(port, autostartEnabled) {
  return [
    { title: `Sway Router (Port ${port})`, tooltip: "Server is running", enabled: false },
    { title: "Open Dashboard", tooltip: "Open in browser", enabled: true },
    buildAutostartMenuItem(autostartEnabled),
    { title: "Quit", tooltip: "Stop server and exit", enabled: true }
  ];
}

function buildAutostartMenuItem(enabled) {
  return {
    title: "Auto-start",
    tooltip: enabled
      ? "Auto-start is enabled. Click to disable it."
      : "Auto-start is disabled. Click to enable it.",
    checked: enabled === true,
    enabled: true,
  };
}

const MENU_INDEX = { STATUS: 0, DASHBOARD: 1, AUTOSTART: 2, QUIT: 3 };

function getAutostartEnabled() {
  try {
    const { isAutoStartEnabled, migrateLegacyAutoStart } = require("./autostart");
    return isAutoStartEnabled() || migrateLegacyAutoStart();
  } catch (e) {
    return false;
  }
}

function handleClick(index, options, onAutostartToggle) {
  const { onQuit, onOpenDashboard, port } = options;
  if (index === MENU_INDEX.DASHBOARD) {
    if (onOpenDashboard) onOpenDashboard();
    else openBrowser(`http://localhost:${port}/dashboard`);
  } else if (index === MENU_INDEX.AUTOSTART) {
    const enabled = getAutostartEnabled();
    try {
      const { enableAutoStart, disableAutoStart } = require("./autostart");
      if (enabled) disableAutoStart();
      else enableAutoStart();
    } catch (e) {}
    onAutostartToggle(getAutostartEnabled());
  } else if (index === MENU_INDEX.QUIT) {
    console.log("\nShutting down...");
    if (onQuit) onQuit();
    killTray();
    setTimeout(() => process.exit(0), 500);
  }
}

function initWindowsTray(options) {
  const { port } = options;
  try {
    const { initWinTray } = require("./trayWin");
    const iconPath = path.join(__dirname, "icon.ico");
    const autostartEnabled = getAutostartEnabled();
    const items = buildMenuItems(port, autostartEnabled);

    trayInstance = initWinTray({
      iconPath,
      tooltip: `Sway Router - Port ${port}`,
      items,
      onClick: (index) => {
        handleClick(index, options, (newEnabled) => {
          const item = buildAutostartMenuItem(newEnabled);
          trayInstance.updateItem(MENU_INDEX.AUTOSTART, item.title, item.enabled, item.checked);
        });
      }
    });

    isWinTray = true;
    return trayInstance;
  } catch (err) {
    return null;
  }
}

function resolveSystray() {

  try { return { mod: require("systray2").default, isV2: true }; } catch (e) {}

  try { return { mod: require("systray").default, isV2: false }; } catch (e) {}
  return null;
}

function chmodTrayBin(pkgName) {

  try {
    const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
    const candidates = [
      path.join(__dirname, "..", "..", "..", "node_modules", pkgName, "traybin", binName)
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    }
  } catch (e) {}
}

function initUnixTray(options) {
  const { port } = options;
  try {
    const resolved = resolveSystray();
    if (!resolved) return null;
    const { mod: SysTray, isV2 } = resolved;

    chmodTrayBin(isV2 ? "systray2" : "systray");

    const autostartEnabled = getAutostartEnabled();
    const items = buildMenuItems(port, autostartEnabled);

    const menu = {
      icon: getIconBase64(),

      isTemplateIcon: false,
      title: "",
      tooltip: `Sway Router - Port ${port}`,
      items
    };

    trayInstance = new SysTray({ menu, debug: false, copyDir: true });
    isWinTray = false;

    trayInstance.onClick((action) => {
      handleClick(action.seq_id, options, (newEnabled) => {
        const item = buildAutostartMenuItem(newEnabled);
        trayInstance.sendAction({
          type: "update-item",
          item,
          seq_id: MENU_INDEX.AUTOSTART
        });
      });
    });

    if (isV2) {

      trayInstance.ready().catch((err) => {
        process.stderr.write(`[swayrouter] tray failed to start: ${err && err.message ? err.message : err}\n`);
      });
    } else {
      trayInstance.onReady(() => {});
      trayInstance.onError(() => {});
    }

    return trayInstance;
  } catch (err) {
    process.stderr.write(`[swayrouter] tray init error: ${err.message}\n`);
    return null;
  }
}

function killTray() {
  const instance = trayInstance;
  const wasWin = isWinTray;
  trayInstance = null;
  if (!instance) return Promise.resolve();

  if (wasWin) {
    try { instance.kill(); } catch (e) {}
    return Promise.resolve();
  }

  let proc = null;
  try {
    proc = instance._process || (typeof instance.process === "function" ? instance.process() : null);
  } catch (e) {}

  const gracefulQuit = () => { try { instance.kill(true); } catch (e) {} };
  const closeIpc = () => { try { instance.kill(false); } catch (e) {} };

  if (!proc || !proc.pid) {
    gracefulQuit();
    closeIpc();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; closeIpc(); resolve(); };

    proc.once("exit", finish);
    gracefulQuit();

    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGTERM"); } catch (e) {} }, 800);
    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGKILL"); } catch (e) {} }, 1600);

    const deadline = Date.now() + 3000;
    const poll = setInterval(() => {
      try { process.kill(proc.pid, 0); } catch { clearInterval(poll); finish(); return; }
      if (Date.now() > deadline) { clearInterval(poll); finish(); }
    }, 50);
  });
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd);
}

module.exports = {
  initTray,
  killTray,
  buildMenuItems,
  buildAutostartMenuItem,
};
