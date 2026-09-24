export default {
  version: 5,
  name: "request-details-payload-capture",
  async up(db) {
    const cols = (await db.all(`PRAGMA table_info(requestDetails)`)).map((r) => r.name);
    if (!cols.includes("payload_capture")) {
      await db.run(`ALTER TABLE requestDetails ADD COLUMN payload_capture TEXT`);
      console.log(`[DB][migrate] +column requestDetails.payload_capture`);
    }
  },
};
