import { describe, expect, test } from "bun:test";
import { formToSettingsPartial, settingsToForm, type SettingsForm } from "@/lib/admin-extras-api";

const FORM: SettingsForm = {
  profileName: "Sway Router",
  profileAvatar: "",
  currency: "USD",
  requireApiKey: true,
  requireLogin: true,
  payloadCaptureEnabled: true,
  rtkEnabled: true,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
};

describe("Settings helpers", () => {
  test("maps token-saver settings and serializes supported fields", () => {
    const form = settingsToForm({
      rtkEnabled: false,
      cavemanEnabled: true,
      cavemanLevel: "lite",
      ponytailEnabled: true,
      ponytailLevel: "ultra",
    });
    expect(form.rtkEnabled).toBe(false);
    expect(form.cavemanEnabled).toBe(true);
    expect(form.cavemanLevel).toBe("lite");
    expect(form.ponytailEnabled).toBe(true);
    expect(form.ponytailLevel).toBe("ultra");

    const partial = formToSettingsPartial(FORM);
    expect(partial.payloadCaptureEnabled).toBe(true);
    expect(partial.fallbackStrategy).toBeUndefined();
    expect(partial.rtkEnabled).toBe(true);
    expect(partial.cavemanEnabled).toBe(false);
    expect(partial.ponytailEnabled).toBe(false);
  });

  test("uses stable defaults for missing settings", () => {
    const form = settingsToForm({});
    expect(form.payloadCaptureEnabled).toBe(true);
    expect(form.rtkEnabled).toBe(true);
    expect(form.cavemanLevel).toBe("full");
    expect(form.ponytailLevel).toBe("full");
  });
});
