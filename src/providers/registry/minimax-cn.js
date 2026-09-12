export default {
  "id": "minimax-cn",
  "priority": 190,
  "alias": "minimax-cn",
  "display": {
    "name": "Minimax (China)",
    "icon": "memory",
    "color": "#DC2626",
    "textIcon": "MC",
    "website": "https://www.minimaxi.com",
    "notice": {
      "apiKeyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.minimaxi.com/anthropic/v1/messages",
    "format": "claude",
    "urlSuffix": "?beta=true",
    "headers": {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    },
    "quirks": {
      "dropOutputConfig": true
    },
    "reasoningInject": {
      "scope": "all"
    },
    "auth": {
      "combined": true,
      "header": "x-api-key",
      "scheme": "raw"
    },
    "usage": {
      "urls": [
        "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
        "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains"
      ]
    }
  },
  "transports": [
    {
      "format": "openai",
      "baseUrl": "https://api.minimaxi.com/v1/chat/completions",
      "auth": {
        "combined": true,
        "header": "Authorization",
        "scheme": "bearer"
      }
    },
    {
      "format": "claude",
      "baseUrl": "https://api.minimaxi.com/anthropic/v1/messages",
      "urlSuffix": "?beta=true",
      "headers": {
        "Anthropic-Version": "2023-06-01",
        "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
      },
      "auth": {
        "combined": true,
        "header": "x-api-key",
        "scheme": "raw"
      }
    }
  ],
  "models": [
    {
      "id": "MiniMax-M3",
      "name": "MiniMax M3",
      "targetFormat": "claude"
    },
    {
      "id": "MiniMax-M2.7",
      "name": "MiniMax M2.7"
    },
    {
      "id": "MiniMax-M2.5",
      "name": "MiniMax M2.5"
    },
    {
      "id": "MiniMax-M2.1",
      "name": "MiniMax M2.1"
    }
  ],
  "features": {
    "usage": true,
    "usageApikey": true
  }
};
