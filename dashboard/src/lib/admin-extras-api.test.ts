import { describe, expect, test } from "bun:test";
import { formToSettingsPartial, settingsToForm, type SettingsForm } from "@/lib/admin-extras-api";

const FORM: SettingsForm = {
  profileName: "Suwok Router",
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
  upstreamTimeoutSeconds: "",
  upstreamMaxAttempts: "",
  upstreamStreamTimeoutSeconds: "",
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

  test("maps upstream timeout, attempts, and stream stall, clamping to ranges", () => {
    const form = settingsToForm({
      upstreamTimeoutMs: 90_000,
      upstreamMaxAttempts: 4,
      upstreamStreamTimeoutMs: 300_000,
    });
    expect(form.upstreamTimeoutSeconds).toBe("90");
    expect(form.upstreamMaxAttempts).toBe("4");
    expect(form.upstreamStreamTimeoutSeconds).toBe("300");

    const partial = formToSettingsPartial({
      ...FORM,
      upstreamTimeoutSeconds: "60",
      upstreamMaxAttempts: "8",
      upstreamStreamTimeoutSeconds: "120",
    });
    expect(partial.upstreamTimeoutMs).toBe(60_000);
    expect(partial.upstreamMaxAttempts).toBe(8);
    expect(partial.upstreamStreamTimeoutMs).toBe(120_000);

    const clamped = formToSettingsPartial({
      ...FORM,
      upstreamTimeoutSeconds: "9999",
      upstreamMaxAttempts: "999",
      upstreamStreamTimeoutSeconds: "99999",
    });
    expect(clamped.upstreamTimeoutMs).toBe(600_000);
    expect(clamped.upstreamMaxAttempts).toBe(100);
    expect(clamped.upstreamStreamTimeoutMs).toBe(3_600_000);

    const cleared = formToSettingsPartial({
      ...FORM,
      upstreamTimeoutSeconds: "",
      upstreamMaxAttempts: "",
      upstreamStreamTimeoutSeconds: "",
    });
    expect(cleared.upstreamTimeoutMs).toBeNull();
    expect(cleared.upstreamMaxAttempts).toBeNull();
    expect(cleared.upstreamStreamTimeoutMs).toBeNull();
  });

  test("uses stable defaults for missing settings", () => {
    const form = settingsToForm({});
    expect(form.payloadCaptureEnabled).toBe(true);
    expect(form.rtkEnabled).toBe(true);
    expect(form.cavemanLevel).toBe("full");
    expect(form.ponytailLevel).toBe("full");
  });
});
