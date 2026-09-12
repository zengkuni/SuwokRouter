const { dashboardUrl, menuItems, menuStatusText } = require("./runMenu");

describe("runtime menu", () => {
  test("uses the canonical dashboard path", () => {
    expect(dashboardUrl({ port: 14045 }, 8080)).toBe("http://localhost:8080/dashboard");
  });

  test("keeps the menu focused on runtime controls", () => {
    const labels = menuItems(true).map((item) => item.label);
    expect(labels).toEqual([
      "Run in Background / Tray",
      "Restart Sway Router",
      "Stop Sway Router",
      "Exit & Stop Router",
    ]);
    expect(menuItems(false).map((item) => item.label)).toEqual(labels);
    expect(menuItems({ updateAvailable: true, updateSupported: true, latestVersion: "1.1.0" }).map((item) => item.label)).toEqual([
      "Run in Background / Tray",
      "Restart Sway Router",
      "Stop Sway Router",
      "Update to v1.1.0",
      "Exit & Stop Router",
    ]);
  });

  test("shows the runtime status and current version together", () => {
    expect(menuStatusText({ running: true }, "1.0.1")).toBe("Status: running\nCurrent Version: v1.0.1");
    expect(menuStatusText({ running: false }, "1.0.1")).toBe("Status: stopped\nCurrent Version: v1.0.1");
  });
});
