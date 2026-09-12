import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(_model, _stream, _urlIndex = 0, credentials = null) {
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }
}

export default OllamaLocalExecutor;
