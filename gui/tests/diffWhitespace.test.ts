import { describe, expect, test } from "bun:test"
import { hideWhitespaceChanges } from "../src/lib/diffWhitespace"

// Ways the "Hide whitespace changes" rewrite could go wrong: hide a real edit, keep a pure re-indent,
// lose line-number alignment (a removed line turned into context must keep the added line's text),
// treat a newline-at-EOF change as whitespace, or stall on a huge run instead of passing it through.
describe("hideWhitespaceChanges", () => {
  test("a re-indented run becomes context and leaves no real change", () => {
    const result = hideWhitespaceChanges([" a", "-  b", "-  c", "+    b", "+    c", " d"])
    expect(result).toEqual({ lines: [" a", "     b", "     c", " d"], changed: false, altered: true })
  })

  test("trailing blanks and tabs are ignored", () => {
    expect(hideWhitespaceChanges(["-x = 1", "+x = 1 \t"]).changed).toBe(false)
  })

  test("a real edit inside a whitespace-only run is kept and the rest becomes context", () => {
    const result = hideWhitespaceChanges(["-  one", "-  two", "+    one", "+    TWO"])
    expect(result.changed).toBe(true)
    expect(result.lines).toEqual(["     one", "-  two", "+    TWO"])
  })

  test("interior whitespace still counts as a change", () => {
    expect(hideWhitespaceChanges(["-a b", "+a  b"]).changed).toBe(true)
  })

  test("adding or removing the final newline is a real change", () => {
    const result = hideWhitespaceChanges(["-end", "\\ No newline at end of file", "+end"])
    expect(result.changed).toBe(true)
    expect(result.lines).toEqual(["-end", "\\ No newline at end of file", "+end"])
  })

  test("runs past the comparison bounds pass through untouched", () => {
    const run = [...Array.from({ length: 1001 }, (_, i) => `-  ${i}`), ...Array.from({ length: 1001 }, (_, i) => `+  ${i} `)]
    expect(hideWhitespaceChanges(run).changed).toBe(false)
    const mismatched = [...Array.from({ length: 1001 }, (_, i) => `-${i}`), ...Array.from({ length: 1000 }, (_, i) => `+${i}`)]
    const result = hideWhitespaceChanges(mismatched)
    expect(result.changed).toBe(true)
    expect(result.lines).toEqual(mismatched)
  })
})
