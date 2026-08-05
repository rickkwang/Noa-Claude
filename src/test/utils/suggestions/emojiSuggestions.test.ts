import { describe, expect, test } from 'bun:test'
import {
  EMOJI_ALIASES,
  EMOJI_INLINE_RE,
  EMOJI_SHORTCODES,
  EMOJI_TABLE,
  EMOJI_TRIGGER_RE,
  getEmoji,
  getEmojiSuggestions,
  resolveInlineEmojiReplacement,
} from '../../../utils/suggestions/emojiSuggestions.js'
import { applyTriggerSuggestion } from '../../../hooks/useTypeahead.js'

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

  test('finds an exact shortcode and puts the glyph in displayText', () => {
    const items = getEmojiSuggestions('fire')
    const fire = items.find(i => i.id === 'emoji-fire')
    expect(fire).toBeDefined()
    // Row layout mirrors upstream: glyph in the name column, :shortcode: as
    // desc. The glyph living in displayText is also what the accept path reads.
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
    for (const [name, glyph] of EMOJI_TABLE) {
      expect(glyph.length).toBeGreaterThan(0)
      expect(name).toMatch(/^[a-z0-9_+-]+$/)
    }
  })

  test('surfaces aliases as their own rows, glyph shared with the canonical', () => {
    const items = getEmojiSuggestions('thumbs')
    const byId = new Map(items.map(i => [i.id, i]))
    for (const name of ['thumbsup', 'thumbs_up']) {
      expect(byId.get(`emoji-${name}`)?.displayText).toBe('👍')
      expect(byId.get(`emoji-${name}`)?.description).toBe(`:${name}:`)
    }
    for (const name of ['thumbsdown', 'thumbs_down']) {
      expect(byId.get(`emoji-${name}`)?.displayText).toBe('👎')
    }
  })
})

describe('EMOJI_ALIASES (upstream 2.1.221 alias layer)', () => {
  test('every alias resolves to a glyph the base table defines', () => {
    for (const [alias, canonical] of Object.entries(EMOJI_ALIASES)) {
      const glyph = EMOJI_SHORTCODES[canonical]
      expect(glyph).toBeDefined()
      expect(getEmoji(alias)).toBe(glyph)
    }
  })

  test('an alias never shadows an existing base entry', () => {
    // thumbsup/thumbsdown are base names here, so their aliases are no-ops.
    for (const alias of Object.keys(EMOJI_ALIASES)) {
      if (Object.hasOwn(EMOJI_SHORTCODES, alias)) {
        expect(EMOJI_TABLE.get(alias)).toBe(EMOJI_SHORTCODES[alias])
      }
    }
  })

  test('the seven aliases missing from the base table are now resolvable', () => {
    expect(getEmoji('plus_one')).toBe('👍')
    expect(getEmoji('minus_one')).toBe('👎')
    expect(getEmoji('thumbs_up')).toBe('👍')
    expect(getEmoji('thumbs_down')).toBe('👎')
    expect(getEmoji('love')).toBe('❤️')
    expect(getEmoji('celebrate')).toBe('🎉')
    expect(getEmoji('hundred')).toBe('💯')
  })
})

describe('accept path (upstream routes emoji through applyTriggerSuggestion)', () => {
  // Exercises the REAL helper from useTypeahead — the one the two emoji accept
  // branches call — not a copy of it.
  function accept(input: string, cursor: number, query: string) {
    const suggestion = getEmojiSuggestions(query).find(
      i => i.description === `:${query}:`,
    )
    expect(suggestion).toBeDefined()
    let newInput = ''
    let newCursor = -1
    applyTriggerSuggestion(
      suggestion!,
      input,
      cursor,
      EMOJI_TRIGGER_RE,
      v => (newInput = v),
      o => (newCursor = o),
    )
    return { newInput, newCursor }
  }

  test('replaces the :query token with the glyph plus a trailing space', () => {
    // Upstream `bUr` always appends " " and lands the cursor past it.
    const input = 'ship it :fir'
    const { newInput, newCursor } = accept(input, input.length, 'fire')
    expect(newInput).toBe('ship it 🔥 ')
    expect(newCursor).toBe('ship it 🔥 '.length)
  })

  test('preserves text after the cursor', () => {
    const input = 'a :smi z'
    const cursor = 'a :smi'.length // cursor right after "smi", before " z"
    const { newInput } = accept(input, cursor, 'smile')
    expect(newInput).toBe('a 😄  z')
  })

  test('replaces at start of input', () => {
    const input = ':tada'
    const { newInput, newCursor } = accept(input, input.length, 'tada')
    expect(newInput).toBe('🎉 ')
    expect(newCursor).toBe('🎉 '.length)
  })

  test('does nothing when there is no trigger before the cursor', () => {
    const input = 'no trigger here'
    const { newInput, newCursor } = accept(input, input.length, 'fire')
    expect(newInput).toBe('')
    expect(newCursor).toBe(-1)
  })

  test('suggestion rows carry no metadata (upstream shape)', () => {
    for (const item of getEmojiSuggestions('fire')) {
      expect(item).toEqual({
        id: item.id,
        displayText: item.displayText,
        description: item.description,
      })
    }
  })

  test('an accepted alias inserts the canonical glyph', () => {
    const input = 'nice :plus_on'
    const { newInput } = accept(input, input.length, 'plus_one')
    expect(newInput).toBe('nice 👍 ')
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

  test('does not leak Object.prototype members', () => {
    // Both spellings satisfy the trigger charset [a-z0-9_+-]+, so an object
    // lookup would hand back Object / Object.prototype here.
    expect(getEmoji('constructor')).toBeUndefined()
    expect(getEmoji('__proto__')).toBeUndefined()
    expect(getEmoji('valueof')).toBeUndefined()
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

  test('does NOT convert an Object.prototype member name', () => {
    // Regression: with an object-literal lookup this spliced the source of
    // `Object` into the prompt.
    expect(
      resolveInlineEmojiReplacement('hi :constructor:', 'hi :constructor', 16),
    ).toBeNull()
    expect(
      resolveInlineEmojiReplacement('hi :__proto__:', 'hi :__proto__', 14),
    ).toBeNull()
  })

  test('converts an alias', () => {
    expect(resolveInlineEmojiReplacement(':plus_one:', ':plus_one', 10)).toEqual({
      newInput: '👍',
      newCursor: '👍'.length,
    })
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
