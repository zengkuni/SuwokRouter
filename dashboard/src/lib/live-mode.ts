export function isForceMock(): boolean {
  return false;
}

export function probeEnabled(): boolean {
  return true;
}

export function applyLiveProbe(
  setUseMock: (v: boolean) => void,
  probe: { isSuccess: boolean; isError: boolean }
): void {
  if (probe.isSuccess || probe.isError) setUseMock(false);
}
