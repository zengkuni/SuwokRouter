export type LifecycleState = "starting" | "ready" | "degraded" | "stopping" | "stopped";

export interface LifecycleSnapshot {
  state: LifecycleState;
  startedAt: string | null;
  readyAt: string | null;
  lastError: string | null;
}

export type ShutdownHandler = (exitCode?: number) => void | Promise<void>;
export type ShutdownRequestResult =
  | "accepted"
  | "already_requested"
  | "unavailable";

const initialSnapshot: LifecycleSnapshot = {
  state: "starting",
  startedAt: null,
  readyAt: null,
  lastError: null,
};

let snapshot: LifecycleSnapshot = { ...initialSnapshot };
let shutdownHandler: ShutdownHandler | null = null;
let shutdownRequestState: "idle" | "accepted" = "idle";

export function registerShutdownHandler(handler: ShutdownHandler): () => void {
  shutdownHandler = handler;
  shutdownRequestState = "idle";

  return () => {
    if (shutdownHandler === handler) {
      shutdownHandler = null;
      shutdownRequestState = "idle";
    }
  };
}

export function requestShutdown(exitCode = 0): ShutdownRequestResult {
  if (!shutdownHandler) return "unavailable";
  if (shutdownRequestState === "accepted") return "already_requested";

  shutdownRequestState = "accepted";
  const handler = shutdownHandler;
  const timer = setTimeout(() => {
    try {
      void Promise.resolve(handler(exitCode)).catch((error) => {
        console.error(
          "[lifecycle] shutdown request failed:",
          error instanceof Error ? error.message : String(error),
        );
      });
    } catch (error) {
      console.error(
        "[lifecycle] shutdown request failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, 100);
  // The pending shutdown should not keep a test process alive by itself.
  // @ts-ignore - Bun's Timer has unref; Node's typing doesn't expose it here.
  timer.unref?.();

  return "accepted";
}

export function markLifecycleStarted(at = new Date().toISOString()): void {
  snapshot = { ...snapshot, state: "starting", startedAt: at, lastError: null };
}

export function markLifecycleReady(at = new Date().toISOString()): void {
  snapshot = { ...snapshot, state: "ready", readyAt: at, lastError: null };
}

export function markLifecycleDegraded(error: unknown): void {
  snapshot = {
    ...snapshot,
    state: "degraded",
    lastError: error instanceof Error ? error.message : String(error || "unknown error"),
  };
}

export function markLifecycleStopping(): void {
  snapshot = { ...snapshot, state: "stopping" };
}

export function markLifecycleStopped(): void {
  snapshot = { ...snapshot, state: "stopped" };
}

export function getLifecycleSnapshot(): LifecycleSnapshot {
  return { ...snapshot };
}

export function resetLifecycleForTests(): void {
  snapshot = { ...initialSnapshot };
  shutdownHandler = null;
  shutdownRequestState = "idle";
}
