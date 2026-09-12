export default {
  id: "perplexity",
  priority: 180,
  alias: "perplexity",
  aliases: [
    "pplx",
  ],
  uiAlias: "pplx",
  display: {
    name: "Perplexity AI",
    icon: "search",
    color: "#20808D",
    textIcon: "PP",
    website: "https://www.perplexity.ai",
    notice: {
      text: "Perplexity Router API provides one API-key connection for OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages.",
      apiKeyUrl: "https://www.perplexity.ai/settings/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.perplexity.ai/router/v1/chat/completions",
    validateUrl: "https://api.perplexity.ai/router/v1/models",
    format: "openai",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.perplexity.ai/router/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.perplexity.ai/router/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.perplexity.ai/router/v1/messages",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  modelsFetcher: {
    url: "https://api.perplexity.ai/router/v1/models",
    type: "openai",
  },
  models: [
    { id: "perplexity/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash" },
    { id: "perplexity/glm-5.2", name: "GLM 5.2" },
    { id: "perplexity/kimi-k3", name: "Kimi K3" },
  ],
  passthroughModels: true,
};
