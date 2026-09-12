import os from "node:os";
import { readFileSync } from "node:fs";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export type ResourceProfileName = "low-memory" | "balanced" | "throughput";

export interface ResourceCapacity {
  memoryBytes: number;
  cpuCount: number;
}

export interface ResourceProfile {
  name: ResourceProfileName;
  memoryBytes: number;
  cpuCount: number;
  initialConcurrent: number;
  minConcurrent: number;
  maxConcurrent: number;
  maxConcurrentPerProvider: number;
  maxQueue: number;
  queueWaitMs: number;
  bodyBudgetMb: number;
  upstreamMaxAttempts: number;
}

function readCgroupMemoryLimit(): number | null {
  for (const path of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (!raw || raw === "max") continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 256 * MIB && value < 1024 * GIB) return value;
    } catch {
      // Not running in a cgroup with a readable memory limit.
    }
  }
  return null;
}

export function detectResourceCapacity(): ResourceCapacity {
  const memoryBytes = readCgroupMemoryLimit() ?? os.totalmem();
  let cpuCount = 1;
  try {
    cpuCount = Math.max(1, Number(os.availableParallelism?.() || os.cpus().length || 1));
  } catch {
    cpuCount = Math.max(1, os.cpus().length || 1);
  }
  return { memoryBytes, cpuCount };
}

function profileNameFor(memoryBytes: number, requested: string | undefined): ResourceProfileName {
  if (requested === "low-memory" || requested === "balanced" || requested === "throughput") {
    return requested;
  }
  if (memoryBytes <= 2.5 * GIB) return "low-memory";
  if (memoryBytes <= 8 * GIB) return "balanced";
  return "throughput";
}

export function deriveResourceProfile(
  capacity: ResourceCapacity = detectResourceCapacity(),
  requestedProfile?: string,
): ResourceProfile {
  const name = profileNameFor(capacity.memoryBytes, requestedProfile);
  const base = {
    "low-memory": {
      initialConcurrent: 24,
      minConcurrent: 8,
      maxConcurrent: 96,
      maxConcurrentPerProvider: 32,
      maxQueue: 64,
      queueWaitMs: 15_000,
      bodyBudgetMb: 48,
      upstreamMaxAttempts: 3,
    },
    balanced: {
      initialConcurrent: 48,
      minConcurrent: 12,
      maxConcurrent: 192,
      maxConcurrentPerProvider: 64,
      maxQueue: 128,
      queueWaitMs: 20_000,
      bodyBudgetMb: 96,
      upstreamMaxAttempts: 4,
    },
    throughput: {
      initialConcurrent: 96,
      minConcurrent: 16,
      maxConcurrent: 384,
      maxConcurrentPerProvider: 96,
      maxQueue: 256,
      queueWaitMs: 30_000,
      bodyBudgetMb: 128,
      upstreamMaxAttempts: 5,
    },
  }[name];

  // A single vCPU benefits from a smaller starting window, while 2+ vCPUs
  // can use the profile defaults without making users tune concurrency.
  const cpuScale = capacity.cpuCount <= 1 ? 0.5 : 1;
  const initialConcurrent = Math.max(base.minConcurrent, Math.round(base.initialConcurrent * cpuScale));
  const maxConcurrent = Math.max(initialConcurrent, Math.round(base.maxConcurrent * cpuScale));
  const minConcurrent = Math.min(initialConcurrent, base.minConcurrent);
  const maxConcurrentPerProvider = Math.max(
    minConcurrent,
    Math.round(base.maxConcurrentPerProvider * cpuScale),
  );

  return {
    name,
    memoryBytes: capacity.memoryBytes,
    cpuCount: capacity.cpuCount,
    initialConcurrent,
    minConcurrent,
    maxConcurrent,
    maxConcurrentPerProvider: Math.min(maxConcurrent, maxConcurrentPerProvider),
    maxQueue: base.maxQueue,
    queueWaitMs: base.queueWaitMs,
    bodyBudgetMb: base.bodyBudgetMb,
    upstreamMaxAttempts: base.upstreamMaxAttempts,
  };
}
