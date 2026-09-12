import { ANTIGRAVITY_OAUTH_CLIENT } from "../shared.js";

export default {
  "id": "antigravity",
  "priority": 20,
  "alias": "ag",
  "uiAlias": "ag",
  "display": {
    "name": "Antigravity",
    "icon": "rocket_launch",
    "color": "#F59E0B",
    "website": "https://antigravity.google",
    "notice": {
      "signupUrl": "https://antigravity.google"
    },
    "deprecated": true,
    "deprecationNotice": "RISK_NOTICE"
  },
  "category": "oauth",
  "thinkingConfig": {
    "options": [
      "auto",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultMode": "auto",
    "modelAware": true
  },
  "transport": {
    "baseUrls": [
      "https://daily-cloudcode-pa.googleapis.com"
    ],
    "format": "antigravity",
    "headers": {
      "User-Agent": "antigravity/ide/2.1.1 darwin/arm64"
    },
    "retry": {
      "429": {
        "attempts": 3
      },
      "500": {
        "attempts": 3
      },
      "503": {
        "attempts": 3
      }
    },
    "usage": {
      "quotaApiUrl": "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
      "loadProjectApiUrl": "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "tokenUrl": "https://oauth2.googleapis.com/token"
    },
    "clientId": ANTIGRAVITY_OAUTH_CLIENT.clientId,
    "clientSecret": ANTIGRAVITY_OAUTH_CLIENT.clientSecret
  },
  "models": [
    {
      "id": "gemini-3.6-flash-high",
      "name": "Gemini 3.6 Flash (High)",
      "upstreamModelId": "gemini-3.6-flash-tiered(high)"
    },
    {
      "id": "gemini-3.6-flash-medium",
      "name": "Gemini 3.6 Flash (Medium)",
      "upstreamModelId": "gemini-3.6-flash-tiered(medium)"
    },
    {
      "id": "gemini-3.6-flash-low",
      "name": "Gemini 3.6 Flash (Low)",
      "upstreamModelId": "gemini-3.6-flash-tiered(low)"
    },
    {
      "id": "gemini-3.5-flash-high",
      "name": "Gemini 3.5 Flash (High)"
    },
    {
      "id": "gemini-3-flash-agent",
      "name": "Gemini 3.5 Flash (High)"
    },
    {
      "id": "gemini-3.5-flash-low",
      "name": "Gemini 3.5 Flash (Medium)"
    },
    {
      "id": "gemini-3.5-flash-extra-low",
      "name": "Gemini 3.5 Flash (Low)"
    },
    {
      "id": "gemini-pro-agent",
      "name": "Gemini 3.1 Pro (High)"
    },
    {
      "id": "gemini-3.1-pro-low",
      "name": "Gemini 3.1 Pro (Low)"
    },
    {
      "id": "claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6 (Thinking)"
    },
    {
      "id": "claude-opus-4-6-thinking",
      "name": "Claude Opus 4.6 (Thinking)"
    },
    {
      "id": "gpt-oss-120b-medium",
      "name": "GPT-OSS 120B (Medium)"
    },
    {
      "id": "gemini-3-flash",
      "name": "Gemini 3 Flash",
      "thinking": false
    }
  ],
  "oauth": {
    "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenUrl": "https://oauth2.googleapis.com/token",
    "userInfoUrl": "https://www.googleapis.com/oauth2/v1/userinfo",
    "scopes": [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs"
    ],
    "apiEndpoint": "https://daily-cloudcode-pa.googleapis.com",
    "apiVersion": "v1internal",
    "loadCodeAssistEndpoint": "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    "onboardUserEndpoint": "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    "loadCodeAssistUserAgent": "antigravity/ide/2.1.1 darwin/arm64",
    "refreshLeadMs": 300000
  },
  "features": {
    "usage": true
  }
};
