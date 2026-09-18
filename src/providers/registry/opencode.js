import { OPENCODE_FREE_MODELS, OPENCODE_USER_AGENT } from "../../utils/opencode.js";

export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "none",
  authType: "none",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
      "User-Agent": OPENCODE_USER_AGENT,
    },
    forceStream: true,
    noAuth: true,
  },
  models: OPENCODE_FREE_MODELS,
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
