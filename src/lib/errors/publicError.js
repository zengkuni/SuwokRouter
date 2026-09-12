const SAFE_MESSAGES = new Map([
  ["auth", "Authentication failed"],
  ["login", "Login failed"],
  ["database_import", "Failed to import database"],
  ["database_export", "Failed to export database"],
  ["provider", "Provider request failed"],
  ["oauth", "OAuth request failed"],
  ["tunnel", "Tunnel operation failed"],
  ["deployment", "Deployment failed"],
]);

export function publicError(kind, fallback = "Request failed") {
  return SAFE_MESSAGES.get(kind) || fallback;
}

export function logRouteError(scope, error) {
  console.error(`[${scope}]`, error);
}
