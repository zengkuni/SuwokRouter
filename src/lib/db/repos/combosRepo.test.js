import { describe, expect, test } from "bun:test";
import { createCombo, deleteCombo, getComboById, getCombos, updateCombo } from "./combosRepo.js";

describe("combo group", () => {
  test("stores, moves and clears the group label", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const name = `repo-test-combo-${suffix}`;
    const group = `repo-test-group-${suffix}`;
    const moved = `repo-test-moved-${suffix}`;
    let id = null;

    try {
      const created = await createCombo({ name, models: ["m-a", "m-b"], group });
      id = created.id;
      expect(created.group).toBe(group);

      const readBack = await getComboById(id);
      expect(readBack.group).toBe(group);

      const repointed = await updateCombo(id, { group: moved });
      expect(repointed.group).toBe(moved);

      const cleared = await updateCombo(id, { group: null });
      expect(cleared.group).toBeNull();

      const listed = (await getCombos()).find((c) => c.id === id);
      expect(listed.group).toBeNull();
    } finally {
      if (id) await deleteCombo(id);
    }
  });

  test("leaves the group unset when the caller omits it", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const name = `repo-test-combo-${suffix}`;
    let id = null;

    try {
      const created = await createCombo({ name, models: ["m-a"] });
      id = created.id;
      expect(created.group).toBeNull();
    } finally {
      if (id) await deleteCombo(id);
    }
  });
});

describe("combo disabled models", () => {
  test("stores, clears and intersects the disabled model list", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const name = `repo-test-combo-${suffix}`;
    let id = null;

    try {
      const created = await createCombo({ name, models: ["m-a", "m-b", "m-c"], disabledModels: ["m-b"] });
      id = created.id;
      expect(created.disabledModels).toEqual(["m-b"]);

      const readBack = await getComboById(id);
      expect(readBack.disabledModels).toEqual(["m-b"]);

      const cleared = await updateCombo(id, { disabledModels: ["m-a", "m-c"] });
      expect(cleared.disabledModels).toEqual(["m-a", "m-c"]);

      // Ids no longer in the route are dropped, and omissions keep the stored list.
      const pruned = await updateCombo(id, { models: ["m-a"], disabledModels: ["m-a", "m-c"] });
      expect(pruned.disabledModels).toEqual(["m-a"]);

      const untouched = await updateCombo(id, { name });
      expect(untouched.disabledModels).toEqual(["m-a"]);
    } finally {
      if (id) await deleteCombo(id);
    }
  });
});
