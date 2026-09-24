export default {
  version: 4,
  name: "request-details-trace-id",
  async up(db) {
    const cols = (await db.all(`PRAGMA table_info(requestDetails)`)).map((r) => r.name);
    if (!cols.includes("trace_id")) {
      await db.run(`ALTER TABLE requestDetails ADD COLUMN trace_id TEXT`);
      console.log(`[DB][migrate] +column requestDetails.trace_id`);
    }
    await db.run(`CREATE INDEX IF NOT EXISTS idx_rd_trace ON requestDetails(trace_id)`);
  },
};
