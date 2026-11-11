import { expect, test } from "bun:test"
import { migrateAppearance } from "../src/lib/appearanceMigration"

// Saved preferences from before the motion setting became a three-way choice must keep their meaning.
test("stored reduceMotion carries over to motion", () => {
  expect(migrateAppearance({ reduceMotion: true }).motion).toBe("reduced")
  expect(migrateAppearance({ reduceMotion: false }).motion).toBe("system")
  expect("reduceMotion" in migrateAppearance({ reduceMotion: true })).toBe(false)
})

test("an explicit motion value wins over the legacy boolean", () => {
  expect(migrateAppearance({ reduceMotion: true, motion: "system" }).motion).toBe("system")
})
