export default {
  version: 8,
  name: "account-model-locks",
  async up(db) {
    await db.run(
      `CREATE TABLE IF NOT EXISTS account_model_locks(
        connectionId TEXT NOT NULL,
        modelId TEXT NOT NULL,
        tier TEXT,
        reason TEXT,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (connectionId, modelId)
      )`
    );

    await db.run(`CREATE INDEX IF NOT EXISTS idx_aml_model_expires ON account_model_locks(modelId, expiresAt)`);

    await db.run(`CREATE INDEX IF NOT EXISTS idx_aml_conn ON account_model_locks(connectionId)`);
  },
};
