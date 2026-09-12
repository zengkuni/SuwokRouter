export function decloakToolNames(body, toolNameMap) {
  if (!toolNameMap?.size || !Array.isArray(body?.content)) return body;
  const content = body.content.map(block => {
    if (block?.type === "tool_use" && toolNameMap.has(block.name)) {
      return { ...block, name: toolNameMap.get(block.name) };
    }
    return block;
  });
  return { ...body, content };
}
