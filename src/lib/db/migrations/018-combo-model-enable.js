export default {
  version: 18,
  name: "combo-model-enable",
  async up(db) {
    // Per-model enable flag for combos. Stores the ids of models that are kept
    // in the route order but skipped at routing time (JSON array, same encoding
    // as `models`). Older rows have no column -> treated as "none disabled".
    await db.run(`ALTER TABLE combos ADD COLUMN IF NOT EXISTS disabled_models TEXT`);
  },
};
