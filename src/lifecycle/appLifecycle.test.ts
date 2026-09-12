import { describe, expect, test } from "bun:test";
import {
  getLifecycleSnapshot,
  markLifecycleDegraded,
  markLifecycleReady,
  markLifecycleStarted,
  markLifecycleStopped,
  markLifecycleStopping,
  registerShutdownHandler,
  resetLifecycleForTests,
  requestShutdown,
} from "./appLifecycle";

describe("application lifecycle", () => {
  test("tracks explicit startup and shutdown states", () => {
    resetLifecycleForTests();
    markLifecycleStarted("2026-01-01T00:00:00.000Z");
    expect(getLifecycleSnapshot().state).toBe("starting");
    markLifecycleReady("2026-01-01T00:00:01.000Z");
    expect(getLifecycleSnapshot().state).toBe("ready");
    markLifecycleStopping();
    expect(getLifecycleSnapshot().state).toBe("stopping");
    markLifecycleStopped();
    expect(getLifecycleSnapshot().state).toBe("stopped");
  });

  test("retains a sanitized degraded error message", () => {
    resetLifecycleForTests();
    markLifecycleDegraded(new Error("database unavailable"));
    const state = getLifecycleSnapshot();
    expect(state.state).toBe("degraded");
    expect(state.lastError).toBe("database unavailable");
  });

  test("accepts only one shutdown request and invokes the registered handler", async () => {
    resetLifecycleForTests();
    const exitCodes: number[] = [];
    registerShutdownHandler((exitCode = 0) => {
      exitCodes.push(exitCode);
    });

    expect(requestShutdown(0)).toBe("accepted");
    expect(requestShutdown(1)).toBe("already_requested");

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(exitCodes).toEqual([0]);
    resetLifecycleForTests();
  });
});
