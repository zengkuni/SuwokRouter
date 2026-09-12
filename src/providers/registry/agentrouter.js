import {
  AGENTROUTER_ANTHROPIC_AUTH,
  AGENTROUTER_ANTHROPIC_HEADERS,
  AGENTROUTER_MODELS_URL,
  AGENTROUTER_OPENAI_HEADERS,
} from "../shared.js";

export default {
  id: "agentrouter",
  priority: 90,
  alias: "agentrouter",
  display: {
    name: "Agent Router",
    icon: "sway",
    color: "#7C5CFC",
    textIcon: "SW",
    website: "https://agentrouter.org",
    notice: {
      apiKeyUrl: "https://agentrouter.org",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://agentrouter.org/v1/chat/completions",
    validateUrl: AGENTROUTER_MODELS_URL,
    format: "openai",
    headers: { ...AGENTROUTER_OPENAI_HEADERS },
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
      headers: { ...AGENTROUTER_OPENAI_HEADERS },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
      headers: { ...AGENTROUTER_ANTHROPIC_HEADERS },
      auth: AGENTROUTER_ANTHROPIC_AUTH,
    },
  ],
  models: [],
  modelsFetcher: {
    url: AGENTROUTER_MODELS_URL,
    type: "openai",
  },
  passthroughModels: true,
};
