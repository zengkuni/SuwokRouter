const VALID_GROUP_REGEX = /^[a-zA-Z0-9_.\- ]+$/;

/**
 * Explain why a combo group label cannot be used, or "" when it can.
 *
 * Mirrors `comboGroupError` in `dashboard/src/lib/comboForm.ts` — the dialog
 * validates the same trimmed value and the API stays the final authority.
 * Empty / whitespace-only / missing means "ungrouped" and is always valid.
 */
export function comboGroupError(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "Group must be a string";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 64) return "Group must be 64 characters or fewer";
  if (!VALID_GROUP_REGEX.test(trimmed)) {
    return "Group can only contain letters, numbers, spaces, -, _ and .";
  }
  return "";
}

/** Normalize a group label for storage: trimmed, empty (or absent) → null. */
export function normalizeComboGroup(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
