import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export default {
  version: 14,
  name: "normalize-fill-first-routing",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;

    const settings = parseJson(row.data, {});
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;

    let changed = false;
    if (settings.fallbackStrategy === "least-inflight") {
      settings.fallbackStrategy = "fill-first";
      changed = true;
    }

    if (settings.providerStrategies && typeof settings.providerStrategies === "object" && !Array.isArray(settings.providerStrategies)) {
      for (const [provider, strategy] of Object.entries(settings.providerStrategies)) {
        if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) continue;
        if (strategy.fallbackStrategy !== "least-inflight") continue;
        settings.providerStrategies[provider] = {
          ...strategy,
          fallbackStrategy: "fill-first",
        };
        changed = true;
      }
    }

    if (!changed) return;
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(settings)],
    );
  },
};
