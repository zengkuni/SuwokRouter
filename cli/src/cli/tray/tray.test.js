import { describe, expect, it } from "bun:test";

const { buildAutostartMenuItem, buildMenuItems } = require("./tray.js");

describe("system tray auto-start menu", () => {
  it("marks enabled auto-start with a checked menu item", () => {
    expect(buildAutostartMenuItem(true)).toMatchObject({
      title: "Auto-start",
      checked: true,
      enabled: true,
    });
  });

  it("keeps disabled auto-start unchecked and actionable", () => {
    expect(buildAutostartMenuItem(false)).toMatchObject({
      title: "Auto-start",
      checked: false,
      enabled: true,
    });
  });

  it("includes the current auto-start state in the tray menu", () => {
    expect(buildMenuItems(14045, true)[2].checked).toBe(true);
    expect(buildMenuItems(14045, false)[2].checked).toBe(false);
  });
});
