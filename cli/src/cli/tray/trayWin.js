const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");

let psProcess = null;
let clickHandler = null;

function sendCommand(cmd) {
  if (psProcess && psProcess.stdin.writable) {
    psProcess.stdin.write(`${JSON.stringify(cmd)}\n`, "utf8");
  }
}

function initWinTray(options) {
  const { iconPath, tooltip, items, onClick } = options;
  clickHandler = onClick;

  const scriptPath = path.join(__dirname, "tray.ps1");

  try {
    psProcess = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-InputFormat", "Text",
        "-OutputFormat", "Text",
        "-File", scriptPath,
        "-IconPath", iconPath,
        "-Tooltip", tooltip
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    return null;
  }

  const rl = readline.createInterface({ input: psProcess.stdout });
  rl.on("line", (line) => {
    try {
      const evt = JSON.parse(line);
      if (evt.type === "click" && clickHandler) {
        clickHandler(evt.index);
      }
    } catch (e) {}
  });

  psProcess.on("error", () => {});
  psProcess.stderr.on("data", () => {});

  items.forEach((item, index) => {
    sendCommand({
      action: "add-item",
      index,
      title: item.title,
      enabled: item.enabled,
      checked: item.checked === true,
    });
  });

  return {
    updateItem(index, title, enabled, checked = false) {
      sendCommand({ action: "update-item", index, title, enabled, checked });
    },
    setTooltip(text) {
      sendCommand({ action: "set-tooltip", text });
    },
    kill() {
      try {
        sendCommand({ action: "kill" });
      } catch (e) {}
      setTimeout(() => {
        if (psProcess && !psProcess.killed) {
          try { psProcess.kill(); } catch (e) {}
        }
        psProcess = null;
      }, 300);
    }
  };
}

module.exports = { initWinTray };
