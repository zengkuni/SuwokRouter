import REGISTRY from "./registry/index.js";
import { PROVIDER_DEFAULTS } from "./schema.js";
import { normalizeModel } from "./models/schema.js";

const OAUTH_INJECT_FIELDS = ["clientId", "clientSecret", "tokenUrl"];

function buildTransport(transport, oauth) {
  const t = { ...transport };
  if (!t.format) t.format = PROVIDER_DEFAULTS.format;
  if (oauth) {
    for (const f of OAUTH_INJECT_FIELDS) {
      if (t[f] === undefined && oauth[f] !== undefined) t[f] = oauth[f];
    }
  }
  return t;
}
export const PROVIDERS = {};
export const PROVIDER_MODELS = {};
export const PROVIDER_OAUTH = {};
for (const entry of REGISTRY) {
  if (entry.transport) {
    PROVIDERS[entry.id] = buildTransport(entry.transport, entry.oauth);
    if (entry.transports) PROVIDERS[entry.id].transports = entry.transports;
  }
  if (entry.models !== undefined) PROVIDER_MODELS[entry.alias || entry.id] = entry.models.map(normalizeModel);
  if (entry.oauth) PROVIDER_OAUTH[entry.id] = entry.oauth;
}
