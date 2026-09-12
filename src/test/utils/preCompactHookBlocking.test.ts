import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearRegisteredHooks,
  registerHookCallbacks,
  setSessionTrustAccepted,
} from '../../bootstrap/state.js'
import { executePreCompactHooks } from '../../utils/hooks.js'

// A PreCompact hook that declines the compaction must be reported as a veto,
// never folded into the summary's custom instructions — a JSON hook blocks
// with exit code 0, so "do not compact this" used to reach the summarizer as
// guidance.

type HookOutput = { decision?: 'block'; systemMessage?: string }

function registerPreCompact(...outputs: HookOutput[]): void {
  registerHookCallbacks({
    PreCompact: outputs.map(output => ({
      hooks: [
        {
          type: 'callback' as const,
          callback: async () => output as never,
        },
      ],
    })),
  })
}

beforeEach(() => {
  clearRegisteredHooks()
  setSessionTrustAccepted(true)
})

afterEach(() => {
  clearRegisteredHooks()
})

describe('executePreCompactHooks', () => {
  test('a blocking hook reports its reason as a veto, not as instructions', async () => {
    registerPreCompact({
      decision: 'block',
      systemMessage: 'not while the release build is running',
    })

    const result = await executePreCompactHooks({
      trigger: 'manual',
      customInstructions: null,
    })

    expect(result.blockedBy).toBe(
      '[callback]: not while the release build is running',
    )
    expect(result.newCustomInstructions).toBeUndefined()
    expect(result.userDisplayMessage).toBe(
      'PreCompact [callback] blocked compaction: not while the release build is running',
    )
  })

  test('one hook blocking does not discard another hook’s instructions', async () => {
    registerPreCompact(
      { systemMessage: 'keep the migration notes' },
      { decision: 'block', systemMessage: 'busy' },
    )

    const result = await executePreCompactHooks({
      trigger: 'auto',
      customInstructions: null,
    })

    expect(result.newCustomInstructions).toBe('keep the migration notes')
    expect(result.blockedBy).toBe('[callback]: busy')
  })

  test('hooks that only add context report no veto', async () => {
    registerPreCompact({ systemMessage: 'keep the migration notes' })

    const result = await executePreCompactHooks({
      trigger: 'manual',
      customInstructions: null,
    })

    expect(result.blockedBy).toBeUndefined()
    expect(result.newCustomInstructions).toBe('keep the migration notes')
  })
})
