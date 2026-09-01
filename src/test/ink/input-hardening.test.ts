import { describe, expect, test } from 'bun:test'
import {
  INITIAL_STATE,
  type ParsedKey,
  parseMultipleKeypresses,
  SGR_MOUSE_PARTIAL_RE,
} from '../../ink/parse-keypress.js'
import { createTokenizer } from '../../ink/termio/tokenize.js'

describe('tokenizer sequence length caps', () => {
  test('runaway CSI aborts to text and clears the buffer', () => {
    const tokenizer = createTokenizer({ x10Mouse: true })
    // 5000 param bytes, no final byte — over the 4096 cap
    tokenizer.feed('\x1b[' + '1'.repeat(5000))
    // Post-abort state is ground: the buffer is always empty, no stale prefix
    expect(tokenizer.buffer()).toBe('')
    // Parser stays responsive: a following plain key parses normally
    const tokens = tokenizer.feed('a')
    expect(tokens.some(t => t.type === 'text' && t.value.includes('a'))).toBe(
      true,
    )
  })

  test('terminator-less OSC over the cap is discarded', () => {
    const tokenizer = createTokenizer({ x10Mouse: true })
    tokenizer.feed('\x1b]8;;http://x' + 'y'.repeat(17 * 1024 * 1024))
    expect(tokenizer.buffer()).toBe('')
    // State recovered to ground: next sequence parses cleanly
    const tokens = tokenizer.feed('\x1b[A')
    expect(
      tokens.some(t => t.type === 'sequence' && t.value === '\x1b[A'),
    ).toBe(true)
  })

  test('runaway escape-intermediate sequence aborts as text', () => {
    const tokenizer = createTokenizer({ x10Mouse: true })
    // ESC ( followed by endless intermediate bytes (0x20-0x2F), no final byte
    tokenizer.feed('\x1b(' + ' '.repeat(1000))
    expect(tokenizer.buffer()).toBe('')
    const tokens = tokenizer.feed('a')
    expect(tokens.some(t => t.type === 'text' && t.value.includes('a'))).toBe(
      true,
    )
  })

  test('terminated OSC under the cap still parses', () => {
    const tokenizer = createTokenizer({ x10Mouse: true })
    const tokens = tokenizer.feed('\x1b]8;;http://example.com\x07')
    expect(tokens).toEqual([
      { type: 'sequence', value: '\x1b]8;;http://example.com\x07' },
    ])
    expect(tokenizer.buffer()).toBe('')
  })
})

describe('paste buffer cap', () => {
  test('paste over 64MB force-emits and leaves paste mode', () => {
    const big = 'x'.repeat(64 * 1024 * 1024)
    const [keys, state] = parseMultipleKeypresses(
      INITIAL_STATE,
      '\x1b[200~' + big,
    )
    expect(state.mode).toBe('NORMAL')
    expect(state.pasteBuffer).toBe('')
    const paste = keys.find((k): k is ParsedKey => k.kind === 'key' && k.isPasted)
    expect(paste).toBeDefined()
    expect(paste!.sequence!.length).toBeGreaterThanOrEqual(64 * 1024 * 1024)

    // Documented tradeoff: content after the cap is live keystrokes (a lost
    // PASTE_END means remaining bytes ARE interactive input by then).
    const [liveKeys, liveState] = parseMultipleKeypresses(state, 'a')
    expect(liveState.mode).toBe('NORMAL')
    expect(
      liveKeys.some(k => k.kind === 'key' && !k.isPasted && k.sequence === 'a'),
    ).toBe(true)

    // A late real PASTE_END after force-emit emits an extra empty paste key —
    // intentional; the parser already emits empty pastes by design.
    const [endKeys] = parseMultipleKeypresses(liveState, '\x1b[201~')
    expect(
      endKeys.some(k => k.kind === 'key' && k.isPasted && k.sequence === ''),
    ).toBe(true)
  })

  test('normal paste still buffers until PASTE_END', () => {
    const [keys, state] = parseMultipleKeypresses(
      INITIAL_STATE,
      '\x1b[200~hello',
    )
    expect(keys).toEqual([])
    expect(state.mode).toBe('IN_PASTE')
    expect(state.pasteBuffer).toBe('hello')
  })
})

describe('SGR mouse partial detection', () => {
  test('matches in-progress SGR mouse report prefixes', () => {
    expect(SGR_MOUSE_PARTIAL_RE.test('\x1b[<')).toBe(true)
    expect(SGR_MOUSE_PARTIAL_RE.test('\x1b[<35;20')).toBe(true)
    expect(SGR_MOUSE_PARTIAL_RE.test('\x1b[<35;20;5')).toBe(true)
  })

  test('rejects complete reports and other sequences', () => {
    expect(SGR_MOUSE_PARTIAL_RE.test('\x1b[<35;20;5M')).toBe(false)
    expect(SGR_MOUSE_PARTIAL_RE.test('\x1b[1;2')).toBe(false)
    expect(SGR_MOUSE_PARTIAL_RE.test('\x1b')).toBe(false)
  })

  test('split mouse report stays buffered in the parser', () => {
    const [keys, state] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[<35;20')
    expect(keys).toEqual([])
    expect(state.incomplete).toBe('\x1b[<35;20')
    expect(SGR_MOUSE_PARTIAL_RE.test(state.incomplete)).toBe(true)
  })
})
