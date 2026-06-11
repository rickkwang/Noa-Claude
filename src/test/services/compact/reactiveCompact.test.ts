import { describe, expect, test } from 'bun:test'
import reactiveCompact, {
  isReactiveCompactEnabled,
  isReactiveOnlyMode,
  isWithheldMediaSizeError,
  isWithheldPromptTooLong,
  reactiveCompactOnPromptTooLong,
  tryReactiveCompact,
} from '../../../services/compact/reactiveCompact.js'
import type { Message } from '../../../types/message.js'

// query.ts requires this module under feature('REACTIVE_COMPACT') and the
// flag is in build.ts's accepted list — the module must exist and no-op in
// this distribution (same pattern as snipCompact.ts), or a
// --feature=REACTIVE_COMPACT build crashes at require time.

const errorMessage = {
  type: 'assistant',
  uuid: 'x',
  isApiErrorMessage: true,
  message: { role: 'assistant', content: [{ type: 'text', text: 'API Error' }] },
} as unknown as Message

describe('reactiveCompact stub', () => {
  test('is disabled in this build', () => {
    expect(isReactiveCompactEnabled()).toBe(false)
  })

  test('never withholds messages', () => {
    expect(isWithheldPromptTooLong(errorMessage)).toBe(false)
    expect(isWithheldPromptTooLong(undefined)).toBe(false)
    expect(isWithheldMediaSizeError(errorMessage)).toBe(false)
    expect(isWithheldMediaSizeError(undefined)).toBe(false)
  })

  test('tryReactiveCompact resolves null without compacting', async () => {
    const result = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl_main_thread',
      aborted: false,
      messages: [errorMessage],
      cacheSafeParams: {} as never,
    })
    expect(result).toBeNull()
  })

  test('reactive-only mode is off so /compact never routes here', () => {
    expect(isReactiveOnlyMode()).toBe(false)
  })

  test('reactiveCompactOnPromptTooLong reports failure without compacting', async () => {
    const outcome = await reactiveCompactOnPromptTooLong(
      [errorMessage],
      {} as never,
      { customInstructions: undefined, trigger: 'manual' },
    )
    expect(outcome.ok).toBe(false)
  })

  test('default export mirrors the named exports (snipCompact pattern)', () => {
    expect(reactiveCompact.isReactiveCompactEnabled).toBe(
      isReactiveCompactEnabled,
    )
    expect(reactiveCompact.tryReactiveCompact).toBe(tryReactiveCompact)
  })
})
