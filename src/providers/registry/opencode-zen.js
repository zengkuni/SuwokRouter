import { OPENCODE_USER_AGENT } from "../../utils/opencode.js";

export default {
  id: "opencode-zen",
  priority: 205,
  alias: "ocz",
  uiAlias: "ocz",
  display: {
    name: "OpenCode Zen",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Zen PAYG: connect an API key from your OpenCode workspace.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "User-Agent": OPENCODE_USER_AGENT,
      "x-opencode-client": "desktop",
    },
  },
  modelsFetcher: {
    url: "https://opencode.ai/zen/v1/models",
    type: "opencode-all",
  },
  passthroughModels: true,
};
