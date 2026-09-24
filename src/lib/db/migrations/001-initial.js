import { SCHEMA_STATEMENTS } from "../schema.pg.js";

export default {
  version: 1,
  name: "initial",
  async up(db) {
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.exec(stmt);
    }
  },
};
