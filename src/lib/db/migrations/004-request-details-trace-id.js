export default {
  version: 4,
  name: "request-details-trace-id",
  async up(db) {
    const cols = (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, ['requestdetails'])).map((r) => r.column_name);
    if (!cols.includes("trace_id")) {
      await db.run(`ALTER TABLE requestDetails ADD COLUMN IF NOT EXISTS trace_id TEXT`);
      console.log(`[DB][migrate] +column requestDetails.trace_id`);
    }
    await db.run(`CREATE INDEX IF NOT EXISTS idx_rd_trace ON requestDetails(trace_id)`);
  },
};
