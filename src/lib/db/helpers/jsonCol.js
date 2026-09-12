function isMissing(value) {
  return value === null || value === undefined;
}

export function parseJson(value, fallback = null) {
  if (isMissing(value)) return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function stringifyJson(value) {
  return JSON.stringify(isMissing(value) ? null : value);
}
