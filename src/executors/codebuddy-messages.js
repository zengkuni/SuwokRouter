const CODEBUDDY_SYSTEM_PROMPT = "You are CodeBuddy, a concise coding assistant. Answer briefly.";

function isSystemMessage(message) {
  return Boolean(message) && ["system", "developer"].includes(message.role);
}

/**
 * CodeBuddy rejects a request whose first message is not a system prompt
 * (upstream error 11128: "first message is not system prompt"). Reorder the
 * system/developer messages to the front and prepend a minimal prompt when the
 * caller sent none, so a bare `[{user}]` request still works.
 */
export function withLeadingSystemMessage(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const system = source.filter(isSystemMessage).map((message) => ({ ...message, role: "system" }));
  const rest = source.filter((message) => message && !isSystemMessage(message));

  if (system.length === 0) {
    system.push({ role: "system", content: CODEBUDDY_SYSTEM_PROMPT });
  }

  return [...system, ...rest.map((message) => ({ ...message }))];
}
