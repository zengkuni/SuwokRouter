/**
 * Dialog rules for the create/edit combo form.
 *
 * `comboNameError` mirrors the gateway's own validation in
 * `src/routes/api/combos/route.js` (POST) and `[id]/route.js` (PUT), so the
 * dialog reports what the API would reject instead of failing on save.
 * Keep both sides in step when either changes.
 *
 * `toggleComboModel` / `moveComboModel` back the ordered "In combo" column:
 * the stored order is the priority the gateway walks, so it is edited in place
 * instead of being re-sorted.
 */

/** Letters, numbers, `-`, `_` and `.` only; a combo name is also a model id. */
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

const NAME_REQUIRED = "Name is required";
const NAME_CHARSET = "Name can only contain letters, numbers, -, _ and .";
const NAME_TAKEN = "Combo name already exists";

/**
 * Explain why a combo name cannot be used, or "" when it can.
 *
 * @param name    Raw input; the dialog saves it trimmed, so it is validated trimmed.
 * @param takenNames Names of the other combos; callers must exclude the combo being
 *   edited. The database enforces uniqueness case-sensitively, so this does too.
 */
export function comboNameError(name: string, takenNames: readonly string[]): string {
  const trimmed = name.trim();
  if (!trimmed) return NAME_REQUIRED;
  if (!VALID_NAME_REGEX.test(trimmed)) return NAME_CHARSET;
  if (takenNames.includes(trimmed)) return NAME_TAKEN;
  return "";
}

/**
 * Add or remove a model id; new picks go last so the column keeps click order.
 *
 * @param selected Current ordered model ids.
 * @param id       Model id to add or drop. An empty id is ignored.
 */
export function toggleComboModel(selected: readonly string[], id: string): string[] {
  if (!id) return [...selected];
  return selected.includes(id)
    ? selected.filter((model) => model !== id)
    : [...selected, id];
}

/**
 * Move the entry at `from` to `to`, shifting the entries between them.
 * Indices outside the list, or a move onto itself, leave the order untouched.
 */
export function moveComboModel(
  selected: readonly string[],
  from: number,
  to: number,
): string[] {
  const next = [...selected];
  if (from === to) return next;
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}