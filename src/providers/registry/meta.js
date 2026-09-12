export default {
  id: "meta",
  priority: 75,
  alias: "meta",
  aliases: ["meta-ai", "muse", "muse-spark"],
  display: {
    name: "Meta AI",
    icon: "auto_awesome",
    color: "#0668E1",
    textIcon: "MA",
    website: "https://dev.meta.ai",
    notice: {
      apiKeyUrl: "https://dev.meta.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
    format: "openai",
    openaiCompatible: true,

    forceStream: false,
  },

  models: [],
  modelsFetcher: {
    url: "https://api.meta.ai/v1/models",
    type: "openai",
  },
  passthroughModels: true,
};
