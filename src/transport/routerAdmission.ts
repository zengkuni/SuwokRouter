import { readFileSync } from "node:fs";
import { env } from "@/lib/env";
import {
  routerActiveRequests,
  routerQueuedRequests,
  routerConcurrencyLimit,
  routerBodyBytesInUse,
  routerAdmissionRejectsTotal,
} from "@/observability/metrics.js";

const MIB = 1024 * 1024;

export type AdmissionReason = "queue_full" | "timeout" | "aborted" | "stopping" | "body_budget";

export interface AdmissionLease {
  release(): void;
  releaseBody(): void;
}

export interface AdmissionResult {
  ok: boolean;
  reason?: AdmissionReason;
  lease?: AdmissionLease;
}

export interface RouterAdmissionOptions {
  hardMaxConcurrent?: number;
  initialConcurrent?: number;
  minConcurrent?: number;
  maxQueue?: number;
  queueWaitMs?: number;
  bodyBudgetBytes?: number;
  memoryHighWaterBytes?: number;
  memoryCriticalWaterBytes?: number;
  sampleIntervalMs?: number;
  autoSample?: boolean;
}

interface Waiter {
  bodyBytes: number;
  workUnits: number;
  resolve: (result: AdmissionResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
  abortHandler: (() => void) | null;
  signal: AbortSignal | null;
  settled: boolean;
}

function positiveInt(value: unknown, fallback: number, max = 1_000_000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function clampBodyBytes(value: number, budget: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), budget);
}

function readContainerMemoryLimit(): number | null {
  for (const path of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (!raw || raw === "max") continue;
      const value = Number(raw);

      if (Number.isFinite(value) && value > 0 && value < 1024 * 1024 * 1024 * 1024) {
        return value;
      }
    } catch {

    }
  }
  return null;
}

export class RouterAdmission {
  readonly hardMaxConcurrent: number;
  readonly minConcurrent: number;
  readonly maxQueue: number;
  readonly queueWaitMs: number;
  readonly bodyBudgetBytes: number;
  readonly sampleIntervalMs: number;

  private targetConcurrent: number;
  private active = 0;
  private activeWorkUnits = 0;
  private bodyBytesInUse = 0;
  private readonly waiters: Waiter[] = [];
  private stopping = false;
  private stableSamples = 0;
  private lastEventLoopLagMs = 0;
  private readonly baselineRss: number;
  private readonly memoryLimitBytes: number | null;
  private readonly memoryHighWaterBytes: number;
  private readonly memoryCriticalWaterBytes: number;
  private sampleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RouterAdmissionOptions = {}) {
    this.hardMaxConcurrent = positiveInt(options.hardMaxConcurrent, env.routerMaxConcurrent, 100_000);
    const initial = positiveInt(options.initialConcurrent, env.routerInitialConcurrent, 100_000);
    this.minConcurrent = Math.min(
      this.hardMaxConcurrent,
      positiveInt(options.minConcurrent, env.routerMinConcurrent, 100_000),
    );
    this.targetConcurrent = Math.max(this.minConcurrent, Math.min(this.hardMaxConcurrent, initial));
    this.maxQueue = positiveInt(options.maxQueue, env.routerMaxQueue, 1_000_000);
    this.queueWaitMs = positiveInt(options.queueWaitMs, env.routerQueueWaitMs, 10 * 60 * 1000);
    this.bodyBudgetBytes = positiveInt(options.bodyBudgetBytes, env.routerBodyBudgetBytes, 16 * 1024 * MIB);
    this.sampleIntervalMs = positiveInt(options.sampleIntervalMs, 2000, 60_000);

    this.baselineRss = this.readRss();
    this.memoryLimitBytes = readContainerMemoryLimit();
    const automaticHigh = this.memoryLimitBytes
      ? Math.floor(this.memoryLimitBytes * 0.70)
      : this.baselineRss + (512 * MIB);
    const automaticCritical = this.memoryLimitBytes
      ? Math.max(automaticHigh + 1, Math.floor(this.memoryLimitBytes * 0.85))
      : this.baselineRss + (768 * MIB);
    this.memoryHighWaterBytes = options.memoryHighWaterBytes
      || env.routerMemoryHighWaterBytes
      || automaticHigh;
    this.memoryCriticalWaterBytes = options.memoryCriticalWaterBytes
      || env.routerMemoryCriticalWaterBytes
      || Math.max(automaticCritical, this.memoryHighWaterBytes + (128 * MIB));

    this.updateMetrics();
    if (options.autoSample !== false) this.armSampler();
  }

  private readRss(): number {
    try {
      return Number(process.memoryUsage?.().rss) || 0;
    } catch {
      return 0;
    }
  }

  private updateMetrics(): void {
    try {
      routerActiveRequests.set({}, this.active);
      routerQueuedRequests.set({}, this.waiters.length);
      routerConcurrencyLimit.set({}, this.targetConcurrent);
      routerBodyBytesInUse.set({}, this.bodyBytesInUse);
    } catch {

    }
  }

  private countReject(reason: AdmissionReason): void {
    try { routerAdmissionRejectsTotal.inc({ reason }); } catch {}
  }

  private armSampler(): void {
    if (this.sampleTimer) return;
    const expectedAt = Date.now() + this.sampleIntervalMs;
    this.sampleTimer = setTimeout(() => {
      this.sampleTimer = null;
      this.lastEventLoopLagMs = Math.max(0, Date.now() - expectedAt);
      this.sample();
      this.armSampler();
    }, this.sampleIntervalMs);
    this.sampleTimer?.unref?.();
  }

  sample(): void {
    const rss = this.readRss();
    const critical = rss >= this.memoryCriticalWaterBytes
      || this.bodyBytesInUse >= this.bodyBudgetBytes * 0.95
      || this.lastEventLoopLagMs >= 750;
    const pressured = rss >= this.memoryHighWaterBytes
      || this.bodyBytesInUse >= this.bodyBudgetBytes * 0.80
      || this.lastEventLoopLagMs >= 250;

    if (critical) {
      this.targetConcurrent = Math.max(this.minConcurrent, Math.floor(this.targetConcurrent * 0.5));
      this.stableSamples = 0;
    } else if (pressured) {
      this.targetConcurrent = Math.max(this.minConcurrent, Math.floor(this.targetConcurrent * 0.75));
      this.stableSamples = 0;
    } else if (this.waiters.length > 0 || this.activeWorkUnits >= this.targetConcurrent * 0.75) {
      this.stableSamples += 1;
      if (this.stableSamples >= 2) {
        this.targetConcurrent = Math.min(
          this.hardMaxConcurrent,
          Math.max(this.targetConcurrent + 1, Math.ceil(this.targetConcurrent * 1.15)),
        );
        this.stableSamples = 0;
      }
    } else {
      this.stableSamples = 0;
    }
    this.updateMetrics();
    this.drain();
  }

  private canClaim(bodyBytes: number, workUnits: number): boolean {
    return !this.stopping
      && this.activeWorkUnits + workUnits <= this.targetConcurrent
      && this.bodyBytesInUse + bodyBytes <= this.bodyBudgetBytes;
  }

  private claim(bodyBytes: number, workUnits: number): AdmissionLease {
    this.active += 1;
    this.activeWorkUnits += workUnits;
    this.bodyBytesInUse += bodyBytes;
    this.updateMetrics();
    let released = false;
    let bodyReleased = bodyBytes === 0;

    return {
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        this.activeWorkUnits = Math.max(0, this.activeWorkUnits - workUnits);
        this.updateMetrics();
        this.drain();
      },
      releaseBody: () => {
        if (bodyReleased) return;
        bodyReleased = true;
        this.bodyBytesInUse = Math.max(0, this.bodyBytesInUse - bodyBytes);
        this.updateMetrics();
        this.drain();
      },
    };
  }

  private removeWaiter(waiter: Waiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.timer = null;
    if (waiter.signal && waiter.abortHandler) {
      waiter.signal.removeEventListener("abort", waiter.abortHandler);
    }
    this.updateMetrics();
  }

  private settleWaiter(waiter: Waiter, result: AdmissionResult): void {
    if (waiter.settled) return;
    waiter.settled = true;
    this.removeWaiter(waiter);
    waiter.abortHandler = null;
    waiter.resolve(result);
  }

  private drain(): void {
    if (this.stopping) return;
    while (this.activeWorkUnits < this.targetConcurrent && this.waiters.length > 0) {

      const index = this.waiters.findIndex((waiter) => (
        this.activeWorkUnits + waiter.workUnits <= this.targetConcurrent
        && this.bodyBytesInUse + waiter.bodyBytes <= this.bodyBudgetBytes
      ));
      if (index < 0) return;
      const waiter = this.waiters[index];
      if (!waiter) return;
      this.settleWaiter(waiter, { ok: true, lease: this.claim(waiter.bodyBytes, waiter.workUnits) });
    }
  }

  acquire(bodyBytes = 0, signal: AbortSignal | null = null, workUnits = 1): Promise<AdmissionResult> {
    const requestedBodyBytes = clampBodyBytes(bodyBytes, this.bodyBudgetBytes);
    const requestedWorkUnits = positiveInt(workUnits, 1, this.hardMaxConcurrent);
    if (bodyBytes > this.bodyBudgetBytes) {
      this.countReject("body_budget");
      return Promise.resolve({ ok: false, reason: "body_budget" });
    }
    if (this.stopping) {
      this.countReject("stopping");
      return Promise.resolve({ ok: false, reason: "stopping" });
    }
    if (signal?.aborted) {
      this.countReject("aborted");
      return Promise.resolve({ ok: false, reason: "aborted" });
    }
    if (this.canClaim(requestedBodyBytes, requestedWorkUnits)) {
      return Promise.resolve({ ok: true, lease: this.claim(requestedBodyBytes, requestedWorkUnits) });
    }
    if (this.waiters.length >= this.maxQueue) {
      this.countReject("queue_full");
      return Promise.resolve({ ok: false, reason: "queue_full" });
    }

    return new Promise((resolve) => {
      const waiter: Waiter = {
        bodyBytes: requestedBodyBytes,
        workUnits: requestedWorkUnits,
        resolve,
        timer: null,
        abortHandler: null,
        signal,
        settled: false,
      };
      waiter.timer = setTimeout(() => this.settleWaiter(waiter, { ok: false, reason: "timeout" }), this.queueWaitMs);
      waiter.abortHandler = () => this.settleWaiter(waiter, { ok: false, reason: "aborted" });
      signal?.addEventListener("abort", waiter.abortHandler, { once: true });
      this.waiters.push(waiter);
      this.updateMetrics();
    });
  }

  stopAccepting(): void {
    this.stopping = true;
    for (const waiter of [...this.waiters]) {
      this.settleWaiter(waiter, { ok: false, reason: "stopping" });
    }
    if (this.sampleTimer) clearTimeout(this.sampleTimer);
    this.sampleTimer = null;
    this.updateMetrics();
  }

  snapshot() {
    return {
      active: this.active,
      activeWorkUnits: this.activeWorkUnits,
      queued: this.waiters.length,
      bodyBytesInUse: this.bodyBytesInUse,
      bodyBudgetBytes: this.bodyBudgetBytes,
      currentLimit: this.targetConcurrent,
      workUnitLimit: this.targetConcurrent,
      hardMaxConcurrent: this.hardMaxConcurrent,
      minConcurrent: this.minConcurrent,
      rssBytes: this.readRss(),
      baselineRssBytes: this.baselineRss,
      memoryLimitBytes: this.memoryLimitBytes,
      memoryHighWaterBytes: this.memoryHighWaterBytes,
      memoryCriticalWaterBytes: this.memoryCriticalWaterBytes,
      eventLoopLagMs: this.lastEventLoopLagMs,
      stopping: this.stopping,
    };
  }
}

export const routerAdmission = new RouterAdmission();

export function wrapResponseWithAdmission(response: Response, release: () => void): Response {
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  if (!response?.body) {
    releaseOnce();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          releaseOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        releaseOnce();
        try { await reader.cancel(error); } catch {}
        try { controller.error(error); } catch {}
      }
    },
    cancel(reason) {
      releaseOnce();
      return reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}
