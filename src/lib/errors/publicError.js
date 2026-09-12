const SAFE_MESSAGES = new Map([
  ["auth", "Authentication failed"],
  ["login", "Login failed"],
  ["oidc_start", "Unable to start OIDC sign-in"],
  ["oidc_callback", "OIDC sign-in failed"],
  ["oidc_test", "OIDC test failed"],
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
