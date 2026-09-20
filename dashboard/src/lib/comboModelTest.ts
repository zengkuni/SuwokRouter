/**
 * Model probing for the create/edit combo dialog. The dialog lists gateway model
 * ids (`vsllm/*`, combo ids, …), so a probe is a single POST to `/api/models/test`
 * — the same endpoint the CLI uses against any model id — instead of the
 * per-connection `test-models` route the provider page needs.
 *
 * `formatModelTestResult` mirrors the provider page's result shape so both pages
 * render the same `OK · 1234ms` / `Error 503` labels.
 */
import { api } from "@/lib/api";
import axios, { type AxiosError } from "axios";

export type ModelTestStatus = {
  ok: boolean;
  /** Rendered verbatim in the status badge: `OK · 1234ms` or `Error 503`. */
  label: string;
  /** Raw upstream reason; shown in the tooltip. */
  message: string;
  status?: number | string | null;
};

type ProbeResponse = {
  ok?: boolean;
  latencyMs?: number | null;
  error?: string | null;
  status?: number | string | null;
};

function statusCodeOf(status: number | string | null | undefined, message: string): string {
  const raw = status == null ? "" : String(status).trim();
  if (raw && !Number.isNaN(Number(raw))) return raw;
  const http = message.match(/\b(?:HTTP\s+)?(\d{3})\s*[:\s]/i);
  return http ? http[1] : "";
}

/** Turn one probe response (or transport failure) into badge-ready text. */
export function formatModelTestResult(input: {
  ok?: boolean;
  status?: number | string | null;
  error?: string | null;
  latencyMs?: number | null;
}): ModelTestStatus {
  const status = input.status ?? null;
  const message = (input.error || "").trim();
  const latency = input.latencyMs == null ? Number.NaN : Number(input.latencyMs);
  if (input.ok) {
    const label = Number.isFinite(latency) ? `OK · ${Math.round(latency)}ms` : "OK";
    return { ok: true, label, message: label, status };
  }
  const code = statusCodeOf(status, message);
  const label = code ? `Error ${code}` : "Error";
  return { ok: false, label, message: message || label, status };
}

function resultFromTransportError(error: unknown): ModelTestStatus {
  if (!axios.isAxiosError(error)) {
    return formatModelTestResult({ ok: false, error: error instanceof Error ? error.message : "Test failed" });
  }
  const failure = error as AxiosError<{ error?: { message?: string } | string; message?: string }>;
  const data = failure.response?.data;
  const reason = typeof data?.error === "string"
    ? data.error
    : data?.error?.message || data?.message || failure.message;
  return formatModelTestResult({ ok: false, status: failure.response?.status ?? null, error: reason });
}

/** Drop ids that repeat or are blank, so a probe runs once per model. */
export function distinctModelIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

export async function testGatewayModel(model: string, signal?: AbortSignal): Promise<ModelTestStatus> {
  try {
    const { data } = await api.post<ProbeResponse>("/models/test", { model }, { signal });
    return formatModelTestResult(data ?? { ok: false, error: "Empty test response" });
  } catch (error) {
    if (axios.isCancel(error)) throw error;
    return resultFromTransportError(error);
  }
}

export type ModelTestBatch = {
  /** Ids planned for this run, in order — the set the progress counter reports on. */
  targetIds: readonly string[];
  /** Probe one model. Rejections (cancel included) are the caller's business. */
  run: (modelId: string, signal: AbortSignal) => Promise<void>;
  /** Called once per settled probe, successful or not. */
  onProgress: (settled: number) => void;
  signal: AbortSignal;
};

/** Probe every target with a fixed number of workers pulling the next index. */
export async function runModelTests({ targetIds, run, onProgress, signal }: ModelTestBatch): Promise<void> {
  let nextIndex = 0;
  let settled = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= targetIds.length) return;
      try {
        await run(targetIds[index], signal);
      } catch {

      }
      settled += 1;
      onProgress(settled);
    }
  };
  const workers = Math.max(1, Math.min(4, targetIds.length));
  await Promise.all(Array.from({ length: workers }, worker));
}
