import { expect, test } from "bun:test"
import { bindingFromEvent, defaultShortcuts, findShortcutConflict, matchesShortcut } from "../src/lib/shortcuts"

const key = (code: string, mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent

// The terminal default is literal Ctrl, so it matches the same way on every platform.
test("literal Ctrl shortcut matches its physical key only with exactly that modifier", () => {
  expect(matchesShortcut(key("Backquote", { ctrlKey: true }), defaultShortcuts.terminal)).toBe(true)
  expect(matchesShortcut(key("Backquote", { ctrlKey: true, shiftKey: true }), defaultShortcuts.terminal)).toBe(false)
  expect(matchesShortcut(key("Backquote"), defaultShortcuts.terminal)).toBe(false)
})

test("a cleared binding matches nothing", () => {
  expect(matchesShortcut(key("Backquote", { ctrlKey: true }), "")).toBe(false)
})

test("recording ignores bare modifiers and keys without a modifier", () => {
  expect(bindingFromEvent(key("ShiftLeft", { shiftKey: true }))).toBeNull()
  expect(bindingFromEvent(key("KeyA"))).toBeNull()
  expect(bindingFromEvent(key("KeyA", { shiftKey: true }))).toBeNull()
})

test("conflicts are found against other shortcuts but not against the same one", () => {
  expect(findShortcutConflict(defaultShortcuts, "findTasks", defaultShortcuts.newTask)).toBe("newTask")
  expect(findShortcutConflict(defaultShortcuts, "newTask", defaultShortcuts.newTask)).toBeNull()
  expect(findShortcutConflict(defaultShortcuts, "newTask", "")).toBeNull()
})
