import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export default {
  version: 13,
  name: "default-fill-first-routing",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;

    const settings = parseJson(row.data, {});
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;

    if (settings.fallbackStrategy !== "least-inflight") return;
    settings.fallbackStrategy = "fill-first";
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(settings)],
    );
  },
};
