const LEGACY_MODELS = [
  "default-model-lite",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gemini-3.0-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "deepseek-v3-2-volc",
  "glm-5.0",
];

export default {
  version: 16,
  name: "prune-legacy-codebuddy-intl-models",
  up(db) {
    for (const modelId of LEGACY_MODELS) {
      db.run(
        "DELETE FROM kv WHERE scope = 'customModels' AND key = ?",
        [`codebuddy-intl|${modelId}|llm`],
      );
    }
  },
};
