import { OPENCODE_GO_MODELS, OPENCODE_USER_AGENT } from "../../utils/opencode.js";

export default {
  id: "opencode-go",
  priority: 210,
  alias: "opencode-go",
  aliases: [
    "ocg",
  ],
  uiAlias: "ocg",
  display: {
    name: "OpenCode Go",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    headers: {
      "User-Agent": OPENCODE_USER_AGENT,
      "x-opencode-client": "desktop",
    },
  },
  models: OPENCODE_GO_MODELS,
  modelsFetcher: {
    url: "https://opencode.ai/zen/go/v1/models",
    type: "openai",
  },
};
