const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, execSync } = require("child_process");

const APP_NAME = "swayrouter";
const APP_LABEL = "com.swayrouter.autostart";
const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const WINDOWS_RUN_VALUE = "SwayRouter";
const WINDOWS_START_DELAY_MS = 5000;

function roamingAppData() {
  return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
}

function windowsAutoStartPaths() {
  const runtimeDir = path.join(roamingAppData(), ".swayrouter", "runtime");
  return {
    runtimeDir,
    vbsPath: path.join(runtimeDir, `${APP_NAME}-autostart.vbs`),
    logPath: path.join(runtimeDir, "autostart.log"),
    legacyVbsPath: path.join(
      roamingAppData(),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
      `${APP_NAME}.vbs`,
    ),
  };
}

function windowsSystemExecutable(name) {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32", name);
}

function escapeVbsString(value) {
  return String(value).replace(/"/g, '""');
}

function buildWindowsVbs({ executablePath, routerScript, logPath }) {
  const command = `"${executablePath}" "${routerScript}" --tray --skip-update`;
  return `Option Explicit
Dim WshShell, ProcessEnv, Fso, LogFile, LogPath
Set WshShell = CreateObject("WScript.Shell")
Set ProcessEnv = WshShell.Environment("PROCESS")
Set Fso = CreateObject("Scripting.FileSystemObject")
LogPath = "${escapeVbsString(logPath)}"
WScript.Sleep ${WINDOWS_START_DELAY_MS}
ProcessEnv("SWAYROUTER_AUTOSTART_LOG") = LogPath
On Error Resume Next
Set LogFile = Fso.OpenTextFile(LogPath, 8, True)
LogFile.WriteLine Now & " Launching Sway Router"
LogFile.Close
Err.Clear
WshShell.Run "${escapeVbsString(command)}", 0, False
If Err.Number <> 0 Then
  Set LogFile = Fso.OpenTextFile(LogPath, 8, True)
  LogFile.WriteLine Now & " Launch failed: " & Err.Description
  LogFile.Close
End If
`;
}

function parseWindowsRunValue(output) {
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*SwayRouter\s+REG_\w+\s+(.+?)\s*$/i);
    if (match) return match[1];
  }
  return null;
}

function readWindowsRunValue() {
  try {
    const output = execFileSync("reg.exe", ["query", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 3000,
    });
    return parseWindowsRunValue(output);
  } catch {
    return null;
  }
}

function isWindowsRunRegistrationValid(runValue, vbsPath) {
  if (!runValue || !vbsPath) return false;
  const normalizedValue = String(runValue).replaceAll("/", "\\").toLowerCase();
  const normalizedPath = path.resolve(vbsPath).replaceAll("/", "\\").toLowerCase();
  return normalizedValue.includes(normalizedPath);
}

function getCliJsPath(cliPath) {
  if (cliPath) {
    const resolved = path.resolve(cliPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  if (process.argv[1]) {
    const resolved = path.resolve(process.argv[1]);
    if (path.basename(resolved) === "cli.js" && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  const computed = path.resolve(__dirname, "..", "..", "..", "cli.js");
  if (fs.existsSync(computed)) return computed;
  return null;
}

function enableAutoStart(cliPath) {
  const platform = process.platform;

  if (!["darwin", "win32", "linux"].includes(platform)) return false;
  if (platform === "linux" && !process.env.DISPLAY) return false;

  try {
    if (platform === "darwin") return enableMacOS(cliPath);
    if (platform === "win32") return enableWindows(cliPath);
    if (platform === "linux") return enableLinux(cliPath);
  } catch (err) {

  }
  return false;
}

function disableAutoStart() {
  const platform = process.platform;
  try {
    if (platform === "darwin") return disableMacOS();
    if (platform === "win32") return disableWindows();
    if (platform === "linux") return disableLinux();
  } catch (err) {}
  return false;
}

function isAutoStartEnabled() {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      if (!fs.existsSync(plistPath)) return false;
      try {
        execSync(`launchctl list ${APP_LABEL}`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 3000
        });
        return true;
      } catch (e) {
        return false;
      }
    } else if (platform === "win32") {
      const { vbsPath } = windowsAutoStartPaths();
      return fs.existsSync(vbsPath) && isWindowsRunRegistrationValid(readWindowsRunValue(), vbsPath);
    } else if (platform === "linux") {
      const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
      return fs.existsSync(desktopPath);
    }
  } catch (e) {}
  return false;
}

function migrateLegacyAutoStart(cliPath) {
  if (process.platform !== "win32") return isAutoStartEnabled();
  if (isAutoStartEnabled()) return true;
  const { legacyVbsPath } = windowsAutoStartPaths();
  if (!fs.existsSync(legacyVbsPath)) return false;
  return enableWindows(cliPath);
}

function isAgentSelfMacOS() {
  try {
    const output = execSync(`launchctl list ${APP_LABEL}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    });
    const match = output.match(/"PID"\s*=\s*(\d+)/);
    return !!(match && parseInt(match[1], 10) === process.pid);
  } catch (e) {
    return false;
  }
}

function enableMacOS(cliPath) {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);

  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);

  if (!routerScript) return false;

  const launchPath = `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`;

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${routerScript}</string>
        <string>--tray</string>
        <string>--skip-update</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${launchPath}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/swayrouter.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/swayrouter.error.log</string>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plistContent);

  if (isAgentSelfMacOS()) {
    return true;
  }

  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
  } catch (e) {}
  try {
    execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" });
  } catch (e) {

  }
  return true;
}

function disableMacOS() {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);

  if (!isAgentSelfMacOS()) {
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
    } catch (e) {}
  }

  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  return true;
}

function enableWindows(cliPath) {
  const { runtimeDir, vbsPath, logPath, legacyVbsPath } = windowsAutoStartPaths();
  const executablePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(vbsPath, buildWindowsVbs({ executablePath, routerScript, logPath }));

  const runCommand = `"${windowsSystemExecutable("wscript.exe")}" "${vbsPath}"`;
  execFileSync("reg.exe", [
    "add",
    WINDOWS_RUN_KEY,
    "/v",
    WINDOWS_RUN_VALUE,
    "/t",
    "REG_SZ",
    "/d",
    runCommand,
    "/f",
  ], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 3000,
  });

  try { fs.rmSync(legacyVbsPath, { force: true }); } catch {}
  return isAutoStartEnabled();
}

function disableWindows() {
  const { vbsPath, legacyVbsPath } = windowsAutoStartPaths();
  try {
    execFileSync("reg.exe", ["delete", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE, "/f"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 3000,
    });
  } catch {}
  try { fs.rmSync(vbsPath, { force: true }); } catch {}
  try { fs.rmSync(legacyVbsPath, { force: true }); } catch {}
  return true;
}

function enableLinux(cliPath) {
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);

  if (!fs.existsSync(autostartDir)) {
    try { fs.mkdirSync(autostartDir, { recursive: true }); }
    catch (e) { return false; }
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const desktopContent = `[Desktop Entry]
Type=Application
Name=Sway Router
Comment=Sway Router API Proxy
Exec=${nodePath} ${routerScript} --tray --skip-update
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(desktopPath, desktopContent);
  return true;
}

function disableLinux() {
  const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
  if (fs.existsSync(desktopPath)) {
    fs.unlinkSync(desktopPath);
  }
  return true;
}

module.exports = {
  enableAutoStart,
  disableAutoStart,
  isAutoStartEnabled,
  migrateLegacyAutoStart,
  __test__: {
    buildWindowsVbs,
    isWindowsRunRegistrationValid,
    parseWindowsRunValue,
    windowsAutoStartPaths,
  },
};
