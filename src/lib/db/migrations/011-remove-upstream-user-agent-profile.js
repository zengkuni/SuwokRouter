export default {
  version: 11,
  name: "remove-upstream-user-agent-profile",
  async up(db) {
    const settingsRow = await db.get(`SELECT data FROM settings WHERE id = 1`);
    if (settingsRow?.data) {
      try {
        const settings = JSON.parse(settingsRow.data);
        if (settings && typeof settings === "object" && !Array.isArray(settings)) {
          delete settings.upstreamUserAgent;
          await db.run(`UPDATE settings SET data = ? WHERE id = 1`, [JSON.stringify(settings)]);
        }
      } catch {

      }
    }

    for (const row of await db.all(`SELECT id, data FROM providerConnections`)) {
      if (!row?.data) continue;
      try {
        const connection = JSON.parse(row.data);
        if (!connection || typeof connection !== "object" || Array.isArray(connection)) continue;
        const providerSpecificData = connection.providerSpecificData;
        if (
          providerSpecificData &&
          typeof providerSpecificData === "object" &&
          !Array.isArray(providerSpecificData)
        ) {
          delete providerSpecificData.upstreamUserAgent;
          delete providerSpecificData.userAgentProfile;
          await db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [
            JSON.stringify(connection),
            row.id,
          ]);
        }
      } catch {

      }
    }
  },
};
