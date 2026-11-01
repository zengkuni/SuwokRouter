import { describe, expect, test } from "bun:test";
import {
  cleanEntry,
  cleanTemplate,
  cleanTemplates,
  cleanTurns,
  selectPromptInjections,
  MAX_TEMPLATES,
  MAX_TURNS,
} from "./promptInjectRepo.js";

const single = {
  mode: "single",
  content: "PROMPT_AAA",
  position: "append",
  enabled: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("cleanEntry", () => {
  test("keeps a valid single entry", () => {
    const entry = cleanEntry(single);
    expect(entry).toEqual({
      mode: "single",
      content: "PROMPT_AAA",
      turns: [],
      position: "append",
      enabled: true,
      name: null,
      templateName: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("keeps a valid chat entry", () => {
    const entry = cleanEntry({
      mode: "chat",
      turns: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
      position: "prepend",
      enabled: false,
    });
    expect(entry.mode).toBe("chat");
    expect(entry.turns).toHaveLength(2);
    expect(entry.position).toBe("prepend");
    expect(entry.enabled).toBe(false);
    expect(entry.content).toBe("");
  });

  test("rejects empty content", () => {
    expect(cleanEntry({ mode: "single", content: "   " })).toBeNull();
    expect(cleanEntry({ mode: "single" })).toBeNull();
  });

  test("rejects chat mode without usable turns", () => {
    expect(cleanEntry({ mode: "chat", turns: [] })).toBeNull();
    expect(cleanEntry({ mode: "chat", turns: [{ role: "user", content: "  " }] })).toBeNull();
  });

  test("rejects junk and unknown modes", () => {
    expect(cleanEntry(null)).toBeNull();
    expect(cleanEntry("string")).toBeNull();
    expect(cleanEntry({ mode: "soul", content: "x" })).toBeNull();
  });

  test("normalizes unknown position to append and defaults enabled", () => {
    const entry = cleanEntry({ mode: "single", content: "x", position: "middle" });
    expect(entry.position).toBe("append");
    expect(entry.enabled).toBe(true);
  });

  test("reads legacy label as name", () => {
    const entry = cleanEntry({ mode: "single", content: "x", label: "  legacy  " });
    expect(entry.name).toBe("legacy");
  });
});

describe("cleanTurns", () => {
  test("drops invalid roles and empty content", () => {
    expect(cleanTurns([
      { role: "system", content: "nope" },
      { role: "user", content: "ok" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "fine" },
    ])).toEqual([
      { role: "user", content: "ok" },
      { role: "assistant", content: "fine" },
    ]);
  });

  test("caps at MAX_TURNS", () => {
    const many = Array.from({ length: MAX_TURNS + 5 }, (_, i) => ({ role: "user", content: `t${i}` }));
    expect(cleanTurns(many)).toHaveLength(MAX_TURNS);
  });
});

describe("cleanTemplate", () => {
  test("keeps a valid template and normalizes the body", () => {
    const tpl = cleanTemplate({ id: "t1", name: "  Reuse  ", mode: "single", content: "hello", position: "prepend" });
    expect(tpl).toEqual({
      id: "t1",
      name: "Reuse",
      mode: "single",
      content: "hello",
      turns: [],
      position: "prepend",
    });
  });

  test("generates an id when missing", () => {
    const tpl = cleanTemplate({ name: "x", mode: "single", content: "y" });
    expect(typeof tpl.id).toBe("string");
    expect(tpl.id.length).toBeGreaterThan(0);
  });

  test("requires a non-empty name", () => {
    expect(cleanTemplate({ mode: "single", content: "x" })).toBeNull();
    expect(cleanTemplate({ name: "   ", mode: "single", content: "x" })).toBeNull();
  });

  test("rejects an invalid body", () => {
    expect(cleanTemplate({ name: "x", mode: "single", content: "  " })).toBeNull();
    expect(cleanTemplate({ name: "x", mode: "chat", turns: [] })).toBeNull();
  });
});

describe("cleanTemplates", () => {
  test("dedupes by id and caps the list", () => {
    const raw = [
      { id: "a", name: "A", mode: "single", content: "1" },
      { id: "a", name: "A2", mode: "single", content: "2" },
      ...Array.from({ length: MAX_TEMPLATES + 5 }, (_, i) => ({
        id: `t${i}`,
        name: `T${i}`,
        mode: "single",
        content: `${i}`,
      })),
    ];
    const out = cleanTemplates(raw);
    expect(out).toHaveLength(MAX_TEMPLATES);
    expect(out.filter((t) => t.id === "a")).toHaveLength(1);
    expect(out[0].name).toBe("A");
  });

  test("ignores non-arrays and invalid items", () => {
    expect(cleanTemplates(null)).toEqual([]);
    expect(cleanTemplates("nope")).toEqual([]);
    expect(cleanTemplates([null, { name: "", mode: "single", content: "x" }])).toEqual([]);
  });
});

describe("selectPromptInjections", () => {
  const ctx = { apiKeyId: "key-1", requestedModel: "gpt-combo", resolvedModel: "openai/gpt-4o" };

  test("empty state yields no injections", () => {
    expect(selectPromptInjections({}, ctx)).toEqual([]);
  });

  test("stacks global → key → model in order", () => {
    const state = {
      global: single,
      byKey: { "key-1": { mode: "single", content: "KEY_PROMPT", position: "prepend" } },
      byModel: { "openai/gpt-4o": { mode: "single", content: "MODEL_PROMPT", position: "append" } },
    };
    const out = selectPromptInjections(state, ctx);
    expect(out.map((e) => e.text)).toEqual(["PROMPT_AAA", "KEY_PROMPT", "MODEL_PROMPT"]);
    expect(out[0].position).toBe("append");
    expect(out[1].position).toBe("prepend");
    expect(out.every((e) => e.mode === "single")).toBe(true);
  });

  test("chat entries carry turns", () => {
    const state = {
      global: {
        mode: "chat",
        turns: [{ role: "user", content: "q" }],
        position: "append",
      },
    };
    const out = selectPromptInjections(state, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].mode).toBe("chat");
    expect(out[0].turns).toEqual([{ role: "user", content: "q" }]);
  });

  test("disabled entries are skipped", () => {
    const state = {
      global: { ...single, enabled: false },
      byModel: { "openai/gpt-4o": { mode: "single", content: "MODEL_PROMPT" } },
    };
    const out = selectPromptInjections(state, ctx);
    expect(out.map((e) => e.text)).toEqual(["MODEL_PROMPT"]);
  });

  test("per-key scope is silent without apiKeyId", () => {
    const state = { byKey: { "key-1": { mode: "single", content: "KEY_PROMPT" } } };
    expect(selectPromptInjections(state, { resolvedModel: "openai/gpt-4o" })).toEqual([]);
    expect(selectPromptInjections(state, { apiKeyId: "key-2", resolvedModel: "x/y" })).toEqual([]);
  });

  test("resolved provider/model wins over the requested combo name", () => {
    const state = {
      byModel: {
        "gpt-combo": { mode: "single", content: "COMBO_PROMPT" },
        "openai/gpt-4o": { mode: "single", content: "RESOLVED_PROMPT" },
      },
    };
    const out = selectPromptInjections(state, ctx);
    expect(out.map((e) => e.text)).toEqual(["RESOLVED_PROMPT"]);
  });

  test("requested combo name matches when no resolved model entry exists", () => {
    const state = { byModel: { "gpt-combo": { mode: "single", content: "COMBO_PROMPT" } } };
    expect(selectPromptInjections(state, ctx).map((e) => e.text)).toEqual(["COMBO_PROMPT"]);
  });

  test("key+model scope stacks last", () => {
    const state = {
      byKeyModel: {
        "key-1": { "openai/gpt-4o": { mode: "single", content: "KEYMODEL_PROMPT" } },
      },
    };
    const out = selectPromptInjections(state, ctx);
    expect(out.map((e) => e.text)).toEqual(["KEYMODEL_PROMPT"]);
  });

  test("invalid entries in maps are dropped", () => {
    const state = {
      byModel: {
        "broken": { mode: "single", content: "" },
        "openai/gpt-4o": { mode: "single", content: "OK" },
      },
    };
    expect(selectPromptInjections(state, ctx).map((e) => e.text)).toEqual(["OK"]);
  });
});
