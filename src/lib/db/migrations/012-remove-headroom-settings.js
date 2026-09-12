import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const RETIRED_KEYS = [
  "headroomEnabled",
  "headroomUrl",
  "headroomProviders",
  "headroomCompressUserMessages",
];

export default {
  version: 12,
  name: "remove-headroom-settings",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;
    const settings = parseJson(row.data, {});
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;

    let changed = false;
    for (const key of RETIRED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        delete settings[key];
        changed = true;
      }
    }
    if (changed) {
      db.run(
        `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stringifyJson(settings)],
      );
    }
  },
};
