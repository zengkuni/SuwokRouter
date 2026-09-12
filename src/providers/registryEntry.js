export function createRegistryEntry(definition) {
  return definition && typeof definition === "object" ? { ...definition } : definition;
}
