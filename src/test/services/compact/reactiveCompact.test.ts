import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import reactiveCompact, {
  isReactiveCompactEnabled,
  isReactiveOnlyMode,
  isWithheldMediaSizeError,
  isWithheldPromptTooLong,
  reactiveCompactOnPromptTooLong,
  tryReactiveCompact,
} from '../../../services/compact/reactiveCompact.js'
import type { Message } from '../../../types/message.js'

// Reactive compaction is compiled in only under feature('REACTIVE_COMPACT')
// and additionally gated at runtime (default off). These tests exercise the
// runtime gate + guard early-returns without hitting the summary API.

const ENV_KEY = 'NOA_CLAUDE_REACTIVE_COMPACT'
const originalEnv = process.env[ENV_KEY]

function ptlMessage(): Message {
  return {
    type: 'assistant',
    uuid: 'ptl',
    isApiErrorMessage: true,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Prompt is too long: 210000 > 200000' }],
    },
  } as unknown as Message
}

function mediaMessage(): Message {
  return {
    type: 'assistant',
    uuid: 'media',
    isApiErrorMessage: true,
    errorDetails: 'image exceeds 5 MB maximum: 5316852 bytes > 5242880 bytes',
    message: { role: 'assistant', content: [{ type: 'text', text: 'API Error' }] },
  } as unknown as Message
}

function plainError(): Message {
  return {
    type: 'assistant',
    uuid: 'err',
    isApiErrorMessage: true,
    message: { role: 'assistant', content: [{ type: 'text', text: 'API Error' }] },
  } as unknown as Message
}

function enable(): void {
  process.env[ENV_KEY] = '1'
}
function disable(): void {
  delete process.env[ENV_KEY]
}

beforeEach(disable)
afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = originalEnv
})

describe('reactiveCompact runtime gate', () => {
  test('disabled by default (baseline-safe)', () => {
    expect(isReactiveCompactEnabled()).toBe(false)
  })

  test('enabled via env', () => {
    enable()
    expect(isReactiveCompactEnabled()).toBe(true)
  })

  test('reactive-only mode stays off so /compact never reroutes', () => {
    expect(isReactiveOnlyMode()).toBe(false)
  })
})

describe('withhold predicates', () => {
  test('never withhold when disabled (identical to baseline)', () => {
    expect(isWithheldPromptTooLong(ptlMessage())).toBe(false)
    expect(isWithheldMediaSizeError(mediaMessage())).toBe(false)
  })

  test('withhold prompt-too-long only when enabled', () => {
    enable()
    expect(isWithheldPromptTooLong(ptlMessage())).toBe(true)
    expect(isWithheldPromptTooLong(plainError())).toBe(false)
    expect(isWithheldPromptTooLong(undefined)).toBe(false)
  })

  test('withhold media-size errors only when enabled', () => {
    enable()
    expect(isWithheldMediaSizeError(mediaMessage())).toBe(true)
    expect(isWithheldMediaSizeError(plainError())).toBe(false)
    expect(isWithheldMediaSizeError(undefined)).toBe(false)
  })
})

describe('tryReactiveCompact guards (no API call)', () => {
  const dummyParams = {
    querySource: 'repl_main_thread' as const,
    messages: [ptlMessage()],
    cacheSafeParams: {} as never,
  }

  test('returns null when disabled', async () => {
    expect(
      await tryReactiveCompact({
        ...dummyParams,
        hasAttempted: false,
        aborted: false,
      }),
    ).toBeNull()
  })

  test('returns null when aborted (single-shot, before touching context)', async () => {
    enable()
    expect(
      await tryReactiveCompact({
        ...dummyParams,
        hasAttempted: false,
        aborted: true,
      }),
    ).toBeNull()
  })

  test('returns null when already attempted this turn', async () => {
    enable()
    expect(
      await tryReactiveCompact({
        ...dummyParams,
        hasAttempted: true,
        aborted: false,
      }),
    ).toBeNull()
  })

  test('bails when there are too few groups to compact', async () => {
    enable()
    // A single error message → fewer than MIN_GROUPS_TO_COMPACT groups.
    expect(
      await tryReactiveCompact({
        querySource: 'repl_main_thread',
        messages: [ptlMessage()],
        cacheSafeParams: {} as never,
        hasAttempted: false,
        aborted: false,
      }),
    ).toBeNull()
  })
})

describe('reactiveCompactOnPromptTooLong guards', () => {
  function ctxParams(aborted: boolean) {
    const abortController = new AbortController()
    if (aborted) abortController.abort()
    return {
      toolUseContext: { options: {}, abortController },
    } as never
  }

  test('reports aborted', async () => {
    const outcome = await reactiveCompactOnPromptTooLong(
      [ptlMessage()],
      ctxParams(true),
      { customInstructions: undefined, trigger: 'manual' },
    )
    expect(outcome).toEqual({ ok: false, reason: 'aborted' })
  })

  test('reports too_few_groups', async () => {
    const outcome = await reactiveCompactOnPromptTooLong(
      [ptlMessage()],
      ctxParams(false),
      { customInstructions: undefined, trigger: 'manual' },
    )
    expect(outcome).toEqual({ ok: false, reason: 'too_few_groups' })
  })
})

describe('default export', () => {
  test('mirrors the named exports', () => {
    expect(reactiveCompact.isReactiveCompactEnabled).toBe(
      isReactiveCompactEnabled,
    )
    expect(reactiveCompact.tryReactiveCompact).toBe(tryReactiveCompact)
  })
})
