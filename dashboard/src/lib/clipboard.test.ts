import { afterEach, describe, expect, test } from "bun:test";
import { copyText } from "./clipboard";

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

type ExecCommandStub = (commandId: string) => boolean;

function stubDom({ hasClipboard, execResult }: { hasClipboard: boolean; execResult: boolean }) {
  const written: string[] = [];
  const selected: string[] = [];
  const removed: unknown[] = [];
  const appended: unknown[] = [];
  let command: string | null = null;

  const area = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: () => {},
    select() {
      selected.push(this.value);
    },
    setSelectionRange: () => {},
  };

  const execCommand: ExecCommandStub = (commandId) => {
    command = commandId;
    return execResult;
  };

  const documentStub = {
    createElement: () => area,
    body: {
      appendChild: (node: unknown) => appended.push(node),
      removeChild: (node: unknown) => removed.push(node),
    },
    execCommand,
  };

  const navigatorStub = hasClipboard
    ? {
        clipboard: {
          writeText: async (text: string) => {
            written.push(text);
          },
        },
      }
    : {};

  Object.defineProperty(globalThis, "navigator", { value: navigatorStub, configurable: true });
  Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true });

  return {
    written,
    selected,
    appended,
    removed,
    executed: () => command,
    area,
  };
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
  Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
});

describe("copyText", () => {
  test("uses the async clipboard when it is available", async () => {
    const dom = stubDom({ hasClipboard: true, execResult: false });

    const asyncCopied = await copyText("https://codebuddy.ai/auth");
    expect(asyncCopied).toBe(true);
    expect(dom.written).toEqual(["https://codebuddy.ai/auth"]);
    expect(dom.executed()).toBeNull();
    expect(dom.appended).toHaveLength(0);
  });

  test("falls back to execCommand on an insecure origin (Docker over HTTP)", async () => {
    const dom = stubDom({ hasClipboard: false, execResult: true });

    const fallbackCopied = await copyText("https://codebuddy.ai/auth");
    expect(fallbackCopied).toBe(true);
    expect(dom.executed()).toBe("copy");
    expect(dom.selected).toEqual(["https://codebuddy.ai/auth"]);
    expect(dom.appended).toHaveLength(1);
    expect(dom.removed).toHaveLength(1);
  });

  test("reports failure when neither path works", async () => {
    stubDom({ hasClipboard: false, execResult: false });

    const failed = await copyText("token");
    expect(failed).toBe(false);
  });

  test("returns false for an empty value without touching the DOM", async () => {
    const dom = stubDom({ hasClipboard: false, execResult: true });

    const empty = await copyText("");
    expect(empty).toBe(false);
    expect(dom.executed()).toBeNull();
  });
});
