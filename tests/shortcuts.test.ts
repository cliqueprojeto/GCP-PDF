import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeShortcut,
  shortcutFromEvent,
  shortcutConflict,
  resolveShortcut,
  DEFAULT_SHORTCUTS,
  DEFAULT_HOME_ACTIONS,
} from "../src/shared/shortcuts";
test("normalizes equivalent keyboard combinations and rejects modifier-only input", () => {
  assert.equal(normalizeShortcut("shift + control + s"), "Ctrl+Shift+S");
  assert.equal(normalizeShortcut("Ctrl++"), "Ctrl+Plus");
  assert.equal(normalizeShortcut("Ctrl"), "");
  assert.equal(normalizeShortcut("Del"), "Delete");
});
test("detects remapping collisions without conflicting with disabled shortcuts", () => {
  assert.equal(shortcutConflict(DEFAULT_SHORTCUTS, "find", "Ctrl+S"), "save");
  assert.equal(shortcutConflict(DEFAULT_SHORTCUTS, "find", ""), undefined);
});
test("resolves remapped commands and page Delete with no text-field assumptions", () => {
  const event = {
    key: "Delete",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  assert.equal(resolveShortcut(event, DEFAULT_SHORTCUTS), "delete-pages");
  assert.equal(
    shortcutFromEvent({ ...event, key: "s", ctrlKey: true }),
    "Ctrl+S",
  );
  assert.equal(
    resolveShortcut(
      { ...event, key: "g", ctrlKey: true },
      { ...DEFAULT_SHORTCUTS, find: "Ctrl+G" },
    ),
    "find",
  );
  assert.equal(
    DEFAULT_HOME_ACTIONS.join(","),
    "highlight,shapes,edit-all,add-text,ocr,compress,find,ai",
  );
});
