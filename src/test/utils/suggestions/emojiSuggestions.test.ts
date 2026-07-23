import { describe, expect, test } from 'bun:test'
import {
  applyEmojiSuggestion,
  EMOJI_INLINE_RE,
  EMOJI_SHORTCODES,
  EMOJI_TRIGGER_RE,
  getEmoji,
  getEmojiSuggestions,
  resolveInlineEmojiReplacement,
} from '../../../utils/suggestions/emojiSuggestions.js'

describe('EMOJI_TRIGGER_RE', () => {
  const matches = (s: string) => {
    const m = s.match(EMOJI_TRIGGER_RE)
    return m ? m[2] : null
  }

  test('fires at start of input', () => {
    expect(matches(':smi')).toBe('smi')
  })

  test('fires after whitespace', () => {
    expect(matches('lgtm :fi')).toBe('fi')
  })

  test('does NOT fire inside a URL', () => {
    expect(matches('see http://example')).toBeNull()
  })

  test('does NOT fire on a time like 12:30', () => {
    expect(matches('meet at 12:30')).toBeNull()
  })

  test('does NOT fire inside an @server:resource token', () => {
    expect(matches('@github:issues')).toBeNull()
  })

  test('does NOT fire on a lone colon or single char', () => {
    expect(matches('hi :')).toBeNull()
    expect(matches('hi :a')).toBeNull()
  })

  test('does NOT fire once a closing space is typed', () => {
    expect(matches('TODO: fix')).toBeNull()
  })

  test('allows + and - and digits in the query', () => {
    expect(matches(':+1')).toBe('+1')
    expect(matches(':star2')).toBe('star2')
  })
})

describe('getEmojiSuggestions', () => {
  test('returns nothing for an empty query', () => {
    expect(getEmojiSuggestions('')).toEqual([])
  })

  test('finds an exact shortcode and carries the glyph in metadata', () => {
    const items = getEmojiSuggestions('fire')
    const fire = items.find(i => i.id === 'emoji-fire')
    expect(fire).toBeDefined()
    expect((fire!.metadata as { emoji: string }).emoji).toBe('🔥')
    // Row layout mirrors upstream: glyph in the name column, :shortcode: as desc.
    expect(fire!.displayText).toBe('🔥')
    expect(fire!.description).toBe(':fire:')
  })

  test('ranks prefix matches above substring matches', () => {
    // "smi" is a prefix of smile/smiley/smirk; heart_eyes etc. never contain it.
    const items = getEmojiSuggestions('smi')
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]!.id.startsWith('emoji-smi')).toBe(true)
  })

  test('a substring-only match ranks below a prefix match for the same query', () => {
    // "face" is a prefix of nothing common but a substring of *_face entries.
    const items = getEmojiSuggestions('face')
    // All results contain "face"; ensure prefixed ones (if any) come first.
    const firstPrefixed = items.findIndex(i =>
      i.id.replace('emoji-', '').startsWith('face'),
    )
    const firstSubstring = items.findIndex(
      i => !i.id.replace('emoji-', '').startsWith('face'),
    )
    if (firstPrefixed !== -1 && firstSubstring !== -1) {
      expect(firstPrefixed).toBeLessThan(firstSubstring)
    }
    expect(items.length).toBeGreaterThan(0)
  })

  test('caps the result count at the upstream limit (20)', () => {
    // "a" appears in many names; ensure we never flood the dropdown.
    const items = getEmojiSuggestions('a')
    expect(items.length).toBeLessThanOrEqual(20)
  })

  test('every table entry has a non-empty glyph', () => {
    for (const [name, glyph] of Object.entries(EMOJI_SHORTCODES)) {
      expect(glyph.length).toBeGreaterThan(0)
      expect(name).toMatch(/^[a-z0-9_+-]+$/)
    }
  })
})

describe('applyEmojiSuggestion', () => {
  function apply(input: string, cursor: number, name: string) {
    let newInput = ''
    let newCursor = -1
    const suggestion = {
      id: `emoji-${name}`,
      displayText: `${EMOJI_SHORTCODES[name]} :${name}:`,
      metadata: { emoji: EMOJI_SHORTCODES[name] },
    }
    applyEmojiSuggestion(
      suggestion,
      input,
      cursor,
      v => (newInput = v),
      o => (newCursor = o),
    )
    return { newInput, newCursor }
  }

  test('replaces the :query token with the glyph, no trailing space', () => {
    const input = 'ship it :fir'
    const { newInput, newCursor } = apply(input, input.length, 'fire')
    expect(newInput).toBe('ship it 🔥')
    expect(newCursor).toBe('ship it 🔥'.length)
  })

  test('preserves text after the cursor', () => {
    const input = 'a :smi z'
    const cursor = 'a :smi'.length // cursor right after "smi", before " z"
    const { newInput } = apply(input, cursor, 'smile')
    expect(newInput).toBe('a 😄 z')
  })

  test('replaces at start of input', () => {
    const input = ':tada'
    const { newInput, newCursor } = apply(input, input.length, 'tada')
    expect(newInput).toBe('🎉')
    expect(newCursor).toBe('🎉'.length)
  })

  test('does nothing when there is no trigger before the cursor', () => {
    const input = 'no trigger here'
    const { newInput, newCursor } = apply(input, input.length, 'fire')
    expect(newInput).toBe('')
    expect(newCursor).toBe(-1)
  })

  test('does nothing when metadata has no emoji', () => {
    let called = false
    applyEmojiSuggestion(
      { id: 'emoji-x', displayText: ':x:', metadata: {} },
      ':fir',
      4,
      () => (called = true),
      () => (called = true),
    )
    expect(called).toBe(false)
  })
})

describe('getEmoji', () => {
  test('returns the glyph for a known shortcode', () => {
    expect(getEmoji('fire')).toBe('🔥')
    expect(getEmoji('tada')).toBe('🎉')
  })
  test('returns undefined for an unknown shortcode', () => {
    expect(getEmoji('definitely_not_a_shortcode')).toBeUndefined()
  })
})

describe('EMOJI_INLINE_RE', () => {
  const name = (s: string) => s.match(EMOJI_INLINE_RE)?.[2] ?? null
  test('matches a complete :name: at the cursor', () => {
    expect(name(':fire:')).toBe('fire')
    expect(name('ship it :tada:')).toBe('tada')
  })
  test('requires the closing colon', () => {
    expect(name(':fire')).toBeNull()
  })
  test('respects the word boundary', () => {
    expect(name('http://x:')).toBeNull()
  })
})

describe('resolveInlineEmojiReplacement (upstream YtS + KtS)', () => {
  test('converts when the just-typed char is the closing colon', () => {
    // prev "see :fire" → user types ":" → "see :fire:", cursor at end.
    const res = resolveInlineEmojiReplacement('see :fire:', 'see :fire', 10)
    expect(res).toEqual({ newInput: 'see 🔥', newCursor: 'see 🔥'.length })
  })

  test('converts at start of input', () => {
    const res = resolveInlineEmojiReplacement(':tada:', ':tada', 6)
    expect(res).toEqual({ newInput: '🎉', newCursor: '🎉'.length })
  })

  test('does NOT convert an unknown shortcode', () => {
    expect(
      resolveInlineEmojiReplacement(':nope_x:', ':nope_x', 8),
    ).toBeNull()
  })

  test('does NOT convert on deletion (only additions ending in colon)', () => {
    // prev longer than input → a delete; must not fire.
    expect(
      resolveInlineEmojiReplacement(':fire:', ':fire:x', 6),
    ).toBeNull()
  })

  test('does NOT convert when the inserted chunk is not colon-terminated', () => {
    // Typed a letter, not the closing colon.
    expect(
      resolveInlineEmojiReplacement('see :firex', 'see :fire', 10),
    ).toBeNull()
  })

  test('does NOT convert when a whole :name: is pasted in one edit', () => {
    // Upstream guard: inserted chunk must match ^[a-z0-9_+-]*:$ — a leading
    // colon in the insert fails it, so a full ":fire:" paste is left literal.
    expect(
      resolveInlineEmojiReplacement('see :fire:', 'see ', 10),
    ).toBeNull()
  })

  test('does nothing without a previous input', () => {
    expect(resolveInlineEmojiReplacement(':fire:', undefined, 6)).toBeNull()
  })

  test('preserves text after the cursor', () => {
    // prev "a :fire z" is wrong shape; construct: prev "a :fire z" → type ':'
    // between "fire" and " z": input "a :fire: z", cursor after the new colon.
    const res = resolveInlineEmojiReplacement('a :fire: z', 'a :fire z', 8)
    expect(res).toEqual({ newInput: 'a 🔥 z', newCursor: 'a 🔥'.length })
  })
})
