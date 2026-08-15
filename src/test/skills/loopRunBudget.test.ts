import { expect, test } from 'bun:test'
import { buildPromptForMode, parseAndConsumeLoopArgs } from '../../skills/bundled/loopHelpers.js'
import { consumeDynamicLoopState, issueDynamicLoopState, reserveDynamicLoopState } from '../../utils/dynamicLoopState.js'

const STARTED_AT_MS = Date.UTC(2026, 7, 16, 0, 0, 0)
function state(iteration: number, startedAtMs = STARTED_AT_MS): string {
  return Buffer.from(JSON.stringify({ chainId: 'chain-123', iteration, startedAtMs })).toString('base64url')
}

let tokenID = 0
function scheduledState(iteration: number, startedAtMs = STARTED_AT_MS): string {
  const token = `scheduled-${iteration}-${tokenID++}`
  issueDynamicLoopState(
    { chainId: 'chain-123', iteration, startedAtMs },
    () => token,
    startedAtMs,
  )
  expect(reserveDynamicLoopState(token, startedAtMs)).toBeNull()
  return token
}

test('dynamic loop carries one chain budget into the next scheduled invocation', () => {
  const prompt = buildPromptForMode(parseAndConsumeLoopArgs('check CI'), { nowMs: STARTED_AT_MS, createChainId: () => 'chain-123' })
  expect(prompt).toContain('/loop --noa-loop-state=')
  expect(prompt).toContain('iteration 1 of 24')
})

test('dynamic loop executes its final iteration without scheduling another one', () => {
  const prompt = buildPromptForMode(parseAndConsumeLoopArgs(`--noa-loop-state=${scheduledState(24)} check CI`), { nowMs: STARTED_AT_MS + 60_000 })
  expect(prompt).toContain('final allowed iteration 24 of 24')
  expect(prompt).not.toContain('CronCreate')
})

test('dynamic loop expires before work at its wall-clock budget', () => {
  const prompt = buildPromptForMode(parseAndConsumeLoopArgs(`--noa-loop-state=${scheduledState(2)} check CI`), { nowMs: STARTED_AT_MS + 24 * 60 * 60 * 1000 })
  expect(prompt).toContain('24-hour wall-clock budget')
  expect(prompt).not.toContain('CronCreate')
})

test.each([
  '--noa-loop-state=not-valid-state check CI',
  '--noa-loop-state= check CI',
  '--noa-loop-state=!!!! check CI',
  '--noa-loop-state= 5m',
  '--noa-loop-state=!!!! 5m',
])('dynamic loop fails closed for malformed state: %s', args => {
  const prompt = buildPromptForMode(parseAndConsumeLoopArgs(args), { nowMs: STARTED_AT_MS, createChainId: () => 'must-not-reset' })
  expect(prompt).toContain('chain state is invalid')
  expect(prompt).not.toContain('CronCreate')
})

test.each(['check CI', '5m'])('dynamic loop fails closed for future state before: %s', remainder => {
  const prompt = buildPromptForMode(parseAndConsumeLoopArgs(`--noa-loop-state=${state(2, STARTED_AT_MS + 1)} ${remainder}`), { nowMs: STARTED_AT_MS })
  expect(prompt).toContain('chain state is invalid')
  expect(prompt).not.toContain('CronCreate')
  expect(prompt).not.toContain('fixed recurring interval')
})

test('dynamic loop refuses to invoke another /loop as its effective prompt', () => {
  const prompt = buildPromptForMode(parseAndConsumeLoopArgs('/loop check CI'), { nowMs: STARTED_AT_MS, createChainId: () => 'nested-loop' })
  expect(prompt).toContain('nested /loop prompts are not allowed')
  expect(prompt).not.toContain('CronCreate')
})

test.each(['5m /loop check CI', '/loop check CI every 5m'])(
  'fixed loop refuses nested /loop prompt: %s',
  args => {
    const prompt = buildPromptForMode(parseAndConsumeLoopArgs(args), {
      nowMs: STARTED_AT_MS,
    })
    expect(prompt).toContain('nested /loop prompts are not allowed')
    expect(prompt).not.toContain('CronCreate')
  },
)

test('the chain id reported to the user is never a live scheduling token', () => {
  const prompt = buildPromptForMode(parseAndConsumeLoopArgs('check CI'), {
    nowMs: STARTED_AT_MS,
  })
  const token = prompt.match(/--noa-loop-state=([A-Za-z0-9_-]+)/)?.[1]
  const chainId = prompt.match(/chain ([^;]+);/)?.[1]

  expect(token).toBeTruthy()
  expect(chainId).toBeTruthy()
  // The token grants re-entry into the chain; the chain id gets printed back to
  // the user. Sharing one value would publish a live capability.
  expect(chainId).not.toBe(token)
})

test('the chain id survives unchanged across iterations while the token rotates', () => {
  const first = buildPromptForMode(parseAndConsumeLoopArgs('check CI'), {
    nowMs: STARTED_AT_MS,
  })
  const firstToken = first.match(/--noa-loop-state=([A-Za-z0-9_-]+)/)![1]!
  expect(reserveDynamicLoopState(firstToken, STARTED_AT_MS)).toBeNull()

  const second = buildPromptForMode(
    parseAndConsumeLoopArgs(`--noa-loop-state=${firstToken} check CI`),
    { nowMs: STARTED_AT_MS + 60_000 },
  )
  const secondToken = second.match(/--noa-loop-state=([A-Za-z0-9_-]+)/)![1]!

  expect(first.match(/chain ([^;]+);/)![1]).toBe(
    second.match(/chain ([^;]+);/)![1],
  )
  expect(secondToken).not.toBe(firstToken)
})

test('size-cap eviction never drops a chain that already has a cron job', () => {
  const now = STARTED_AT_MS
  const scheduled = issueDynamicLoopState(
    { chainId: 'chain-pending', iteration: 2, startedAtMs: now },
    () => 'token-with-a-pending-cron-job',
    now,
  )
  expect(reserveDynamicLoopState(scheduled, now)).toBeNull()

  // Well past MAX_PENDING_STATES, so the cap is exercised many times over.
  for (let i = 0; i < 400; i++) {
    issueDynamicLoopState({ iteration: 2, startedAtMs: now }, undefined, now)
  }

  expect(consumeDynamicLoopState(scheduled)).toMatchObject({
    chainId: 'chain-pending',
    iteration: 2,
  })
})
