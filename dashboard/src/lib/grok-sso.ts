/** Accepts `sso=<token>`, a bare token, or a whole cookie header line. */
export function sanitizeGrokSsoToken(value: string): string {
  let token = (value || "").trim();
  const assignment = token.indexOf("sso=");
  if (assignment >= 0) {
    token = token.slice(assignment + 4);
    const terminator = token.search(/[;\s]/);
    if (terminator >= 0) token = token.slice(0, terminator);
  }
  return token.replace(/[\r\n\x00]/g, "").trim();
}

export function parseGrokSsoTokens(raw: string): string[] {
  return (raw || "")
    .split(/\r?\n/)
    .map((line) => sanitizeGrokSsoToken(line))
    .filter(Boolean);
}
