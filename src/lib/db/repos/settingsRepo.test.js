import { describe, expect, test } from "bun:test";
import { stripRemovedSettings } from "./settingsRepo.js";

describe("settings cleanup", () => {
  test("removes deprecated global outbound proxy settings", () => {
    expect(stripRemovedSettings({
      profileName: "Sway Router",
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://proxy.example:8080",
      outboundNoProxy: "localhost",
    })).toEqual({ profileName: "Sway Router" });
  });
});
