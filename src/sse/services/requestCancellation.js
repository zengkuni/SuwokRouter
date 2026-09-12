/** @param {{ requestSignal?: AbortSignal | null, status?: number | string | null }} [options] */
export function isCallerCancellation({ requestSignal = null, status = null } = {}) {
  return Boolean(requestSignal?.aborted) || Number(status) === 499;
}
