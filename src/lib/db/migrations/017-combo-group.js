export default {
  version: 17,
  name: "combo-group",
  async up(db) {
    // `group` is a reserved word in Postgres — the identifier must stay quoted.
    await db.run(`ALTER TABLE combos ADD COLUMN IF NOT EXISTS "group" TEXT`);
  },
};
