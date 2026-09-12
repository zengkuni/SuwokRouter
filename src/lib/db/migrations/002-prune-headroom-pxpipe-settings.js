import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const STALE_KEYS = [
  "headroomEnabled",
  "headroomUrl",
  "headroomCompressUserMessages",
  "pxpipeEnabled",
  "pxpipeAutoInstall",
  "pxpipeMinChars",
  "pxpipeTimeoutMs",
];

export default {
  version: 2,
  name: "prune-headroom-pxpipe-settings",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;
    const settings = parseJson(row.data, {});
    if (!settings || typeof settings !== "object") return;
    let changed = false;
    for (const k of STALE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(settings, k)) {
        delete settings[k];
        changed = true;
      }
    }
    if (changed) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(settings)]);
    }
  },
};
