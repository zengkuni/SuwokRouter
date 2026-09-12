export function getTunnelEnableError(settings) {
  if (settings?.requireApiKey !== true) {
    return 'Enable "Require API key" before activating the tunnel.';
  }
  if (settings?.requireLogin !== true) {
    return 'Enable "Require login" before activating the tunnel.';
  }
  if (!settings?.password) {
    return "Set a custom dashboard password before activating the tunnel.";
  }
  return null;
}
