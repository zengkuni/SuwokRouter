export function connectionCtaLabel(
  authType?: string,
  noAuth?: boolean
): string {
  if (noAuth) return "Connect";
  const a = (authType || "apikey").toLowerCase();
  if (
    a.includes("oauth") ||
    a.includes("device") ||
    a.includes("import") ||
    a === "local"
  ) {
    return "Connect";
  }
  return "Add connection";
}

export function connectionCtaShort(authType?: string, noAuth?: boolean): string {
  const full = connectionCtaLabel(authType, noAuth);
  return full === "Add connection" ? "Add" : "Connect";
}
