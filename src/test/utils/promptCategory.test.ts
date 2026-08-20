import { describe, expect, test } from 'bun:test'
import { OUTPUT_STYLE_CONFIG } from '../../constants/outputStyles.js'

// getQuerySourceForREPL reads live settings, which a self-contained test cannot
// stage without touching the user's config. The classification it depends on is
// the part that was wrong, so pin that directly: `in` walks the prototype chain,
// Object.hasOwn does not.
describe('built-in output style classification', () => {
  test('recognizes the built-in styles', () => {
    for (const style of ['Proactive', 'Concise', 'Explanatory', 'Learning']) {
      expect(Object.hasOwn(OUTPUT_STYLE_CONFIG, style)).toBe(true)
    }
  })

  test('does not mistake Object.prototype keys for built-in styles', () => {
    // A custom style file may legally be named toString.md. With `in`, that
    // classified as built-in and produced a querySource naming a style that
    // does not exist ('repl_main_thread:outputStyle:toString').
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__']) {
      expect(Object.hasOwn(OUTPUT_STYLE_CONFIG, key)).toBe(false)
      expect(key in OUTPUT_STYLE_CONFIG).toBe(true)
    }
  })
})
