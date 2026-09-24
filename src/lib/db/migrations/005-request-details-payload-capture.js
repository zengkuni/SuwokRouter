export default {
  version: 5,
  name: "request-details-payload-capture",
  async up(db) {
    const cols = (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, ['requestdetails'])).map((r) => r.column_name);
    if (!cols.includes("payload_capture")) {
      await db.run(`ALTER TABLE requestDetails ADD COLUMN IF NOT EXISTS payload_capture TEXT`);
      console.log(`[DB][migrate] +column requestDetails.payload_capture`);
    }
  },
};
