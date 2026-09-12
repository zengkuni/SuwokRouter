import { DefaultExecutor } from "./default.js";

function pick(value, fallback) {
  return value || fallback;
}

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
  }

  buildUrl(model, _stream, _urlIndex = 0, credentials = null) {
    const providerData = credentials?.providerSpecificData;
    const azureEndpoint = pick(providerData?.azureEndpoint, pick(process.env.AZURE_ENDPOINT, "https://api.openai.com"));
    const apiVersion = pick(providerData?.apiVersion, pick(process.env.AZURE_API_VERSION, "2024-10-01-preview"));
    const deployment = pick(providerData?.deployment, pick(model, pick(process.env.AZURE_DEPLOYMENT, "gpt-4")));
    const endpoint = azureEndpoint.replace(/\/$/, "");
    return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    const apiKey = pick(credentials?.apiKey, pick(credentials?.accessToken, process.env.OPENAI_API_KEY));

    if (apiKey) {
      headers["api-key"] = apiKey;
    }

    const organization = pick(credentials?.providerSpecificData?.organization, process.env.AZURE_ORGANIZATION);

    if (organization) {
      headers["OpenAI-Organization"] = organization;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  transformRequest(_model, body, _stream, _credentials) {
    return body;
  }
}
