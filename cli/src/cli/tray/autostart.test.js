const path = require("node:path");
const { __test__ } = require("./autostart");

describe("Windows auto-start registration", () => {
  test("builds a delayed hidden launcher with a diagnostic log", () => {
    const script = __test__.buildWindowsVbs({
      executablePath: "C:\\Program Files\\nodejs\\node.exe",
      routerScript: "C:\\Users\\Test User\\swayrouter\\cli\\cli.js",
      logPath: "C:\\Users\\Test User\\AppData\\Roaming\\.swayrouter\\runtime\\autostart.log",
    });

    expect(script).toContain("WScript.Sleep 5000");
    expect(script).toContain("SWAYROUTER_AUTOSTART_LOG");
    expect(script).toContain('WshShell.Run """C:\\Program Files\\nodejs\\node.exe""');
    expect(script).toContain("--tray --skip-update");
  });

  test("parses and validates the registered Run command", () => {
    const vbsPath = path.resolve("C:\\Users\\noval\\AppData\\Roaming\\.swayrouter\\runtime\\swayrouter-autostart.vbs");
    const output = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
    SwayRouter    REG_SZ    "C:\\Windows\\System32\\wscript.exe" "${vbsPath}"
`;
    const value = __test__.parseWindowsRunValue(output);
    expect(value).toContain("wscript.exe");
    expect(__test__.isWindowsRunRegistrationValid(value, vbsPath)).toBe(true);
    expect(
      __test__.isWindowsRunRegistrationValid(value, `${vbsPath}.old`),
    ).toBe(false);
  });
});
