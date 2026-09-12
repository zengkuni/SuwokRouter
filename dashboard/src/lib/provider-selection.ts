export function providerSelectionChanged(
  currentId: string | null,
  nextId: string | null,
): boolean {
  return currentId !== nextId;
}
