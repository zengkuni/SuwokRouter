import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export default {
  version: 7,
  name: "headroom-readd-settings",
  up(db) {

    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;
    const settings = parseJson(row.data, {});
    if (!settings || typeof settings !== "object") return;

    let changed = false;
    if (
      typeof settings.headroomUrl === "string" &&
      settings.headroomUrl.trim() &&
      !Array.isArray(settings.headroomProviders)
    ) {
      settings.headroomProviders = [settings.headroomUrl.trim()];
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(settings, "headroomUrl")) {
      delete settings.headroomUrl;
      changed = true;
    }

    if (changed) {
      db.run(
        `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stringifyJson(settings)],
      );
    }
  },
};
