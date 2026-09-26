import { DefaultExecutor } from "./default.js";
import { withLeadingSystemMessage } from "./codebuddy-messages.js";

export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = withLeadingSystemMessage(source);

    return transformed;
  }
}

export default CodeBuddyExecutor;
