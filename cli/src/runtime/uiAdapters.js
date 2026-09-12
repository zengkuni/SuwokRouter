const { exec } = require("node:child_process");

function openBrowser(url) {
  const command = process.platform === "win32"
    ? `start "" "${url.replaceAll('"', '')}"`
    : process.platform === "darwin"
      ? `open "${url.replaceAll('"', '')}"`
      : `xdg-open "${url.replaceAll('"', '')}"`;
  exec(command, { windowsHide: true }, () => {});
}

module.exports = { openBrowser };
