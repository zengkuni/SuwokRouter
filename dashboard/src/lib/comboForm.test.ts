import { describe, expect, test } from "bun:test";
import { comboGroupError, comboNameError, moveComboModel, toggleComboModel } from "@/lib/comboForm";

const CHARSET_MESSAGE = "Name can only contain letters, numbers, -, _ and .";

describe("combo name validation", () => {
  test("accepts every character the gateway accepts", () => {
    for (const name of ["smart", "suwok-v2", "a.b_c-d", "9router", "A1", "a_b.c-d"]) {
      expect(comboNameError(name, [])).toBe("");
    }
  });

  test("requires a name", () => {
    expect(comboNameError("", [])).toBe("Name is required");
    expect(comboNameError("   ", [])).toBe("Name is required");
  });

  test("rejects characters outside letters, numbers, -, _ and .", () => {
    for (const name of ["smart combo", "smart/combo", "smart:combo", "smart,combo", "smärt", "Smart!"]) {
      expect(comboNameError(name, [])).toBe(CHARSET_MESSAGE);
    }
  });

  test("validates the trimmed name the dialog actually saves", () => {
    expect(comboNameError("  smart  ", [])).toBe("");
    expect(comboNameError("  smart name  ", [])).toBe(CHARSET_MESSAGE);
    expect(comboNameError("  smart  ", ["smart"])).toBe("Combo name already exists");
  });

  test("rejects a name another combo already owns", () => {
    expect(comboNameError("smart", ["fast"])).toBe("");
    expect(comboNameError("fast", ["fast"])).toBe("Combo name already exists");
  });

  test("treats names differing only by case as distinct, as the database does", () => {
    expect(comboNameError("Fast", ["fast"])).toBe("");
  });

  test("reports a missing name before a duplicate", () => {
    expect(comboNameError("", ["smart"])).toBe("Name is required");
  });
});

describe("combo group validation", () => {
  test("accepts labels the gateway accepts", () => {
    for (const group of ["gpt", "gpt-5", "my group", "a_b.c-d", "A1", "9router"]) {
      expect(comboGroupError(group)).toBe("");
    }
  });

  test("treats an empty label as ungrouped", () => {
    expect(comboGroupError("")).toBe("");
    expect(comboGroupError("   ")).toBe("");
  });

  test("rejects labels longer than 64 characters", () => {
    expect(comboGroupError("a".repeat(64))).toBe("");
    expect(comboGroupError("a".repeat(65))).toBe("Group must be 64 characters or fewer");
  });

  test("rejects characters outside letters, numbers, spaces, -, _ and .", () => {
    for (const group of ["gpt/5", "gpt:5", "gpt,5", "grüp", "group!"]) {
      expect(comboGroupError(group)).toBe("Group can only contain letters, numbers, spaces, -, _ and .");
    }
  });

  test("validates the trimmed label the dialog actually saves", () => {
    expect(comboGroupError("  gpt  ")).toBe("");
    expect(comboGroupError("  gpt 5  ")).toBe("");
  });
});

describe("combo model order", () => {
  test("appends new picks so the list keeps click order", () => {
    expect(toggleComboModel([], "vsllm/glm-5.2")).toEqual(["vsllm/glm-5.2"]);
    expect(toggleComboModel(["vsllm/glm-5.2"], "vsllm/kimi-k3")).toEqual([
      "vsllm/glm-5.2",
      "vsllm/kimi-k3",
    ]);
  });

  test("drops a pick wherever it sits in the order", () => {
    expect(toggleComboModel(["a/1", "b/2", "c/3"], "b/2")).toEqual(["a/1", "c/3"]);
    expect(toggleComboModel(["a/1"], "a/1")).toEqual([]);
  });

  test("never stores an empty id", () => {
    expect(toggleComboModel(["a/1"], "")).toEqual(["a/1"]);
    expect(toggleComboModel([], "")).toEqual([]);
  });

  test("moves an entry down and up, shifting the entries it passes", () => {
    expect(moveComboModel(["a/1", "b/2", "c/3"], 0, 1)).toEqual(["b/2", "a/1", "c/3"]);
    expect(moveComboModel(["a/1", "b/2", "c/3"], 2, 0)).toEqual(["c/3", "a/1", "b/2"]);
  });

  test("leaves the order alone for moves the list cannot make", () => {
    const models = ["a/1", "b/2"];
    for (const [from, to] of [[0, 0], [-1, 1], [0, 2], [2, 0], [1, -1]]) {
      expect(moveComboModel(models, from, to)).toEqual(models);
    }
  });

  test("does not mutate the caller's list", () => {
    const models = ["a/1", "b/2"];
    moveComboModel(models, 0, 1);
    expect(models).toEqual(["a/1", "b/2"]);
  });
});