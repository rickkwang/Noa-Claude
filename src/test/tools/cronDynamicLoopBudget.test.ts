import { expect, test } from 'bun:test'
import { buildPromptForMode, parseAndConsumeLoopArgs } from '../../skills/bundled/loopHelpers.js'
import { CronCreateTool } from '../../tools/ScheduleCronTool/CronCreateTool.js'
import {
  releaseDynamicLoopScheduledPrompt,
  reserveDynamicLoopScheduledPrompt,
  validateDynamicLoopScheduledPrompt,
} from '../../utils/dynamicLoopState.js'

function marker(iteration: number, startedAtMs: number): string {
  return Buffer.from(JSON.stringify({ chainId: 'chain-123', iteration, startedAtMs })).toString('base64url')
}

test('CronCreate rejects an unbudgeted dynamic /loop self-schedule', async () => {
  const result = await CronCreateTool.validateInput?.({ cron: '*/5 * * * *', prompt: '/loop check CI', recurring: false, durable: false })
  expect(result).toMatchObject({ result: false, errorCode: 5 })
})

test('CronCreate rejects fixed /loop wrappers that would recursively create jobs', async () => {
  const result = await CronCreateTool.validateInput?.({ cron: '*/5 * * * *', prompt: '/loop 5m check CI', recurring: true, durable: false })
  expect(result).toMatchObject({ result: false, errorCode: 5 })
})

test('CronCreate rejects dynamic /loop state outside its chain budget', async () => {
  const result = await CronCreateTool.validateInput?.({ cron: '*/5 * * * *', prompt: `/loop --noa-loop-state=${marker(2, Date.now() + 60_000)} check CI`, recurring: false, durable: false })
  expect(result).toMatchObject({ result: false, errorCode: 5 })
})

test.each([{ recurring: true, durable: false }, { recurring: false, durable: true }])('CronCreate keeps dynamic /loop one-shot and session-only', async flags => {
  const result = await CronCreateTool.validateInput?.({ cron: '*/5 * * * *', prompt: `/loop --noa-loop-state=${marker(2, Date.now() - 60_000)} check CI`, ...flags })
  expect(result).toMatchObject({ result: false, errorCode: 5 })
})

test('CronCreate rejects a forged but well-shaped dynamic marker', async () => {
  const result = await CronCreateTool.validateInput?.({ cron: '*/5 * * * *', prompt: `/loop --noa-loop-state=${marker(2, Date.now() - 60_000)} check CI`, recurring: false, durable: false })
  expect(result).toMatchObject({ result: false, errorCode: 5 })
})

test('validation is repeatable until execution reserves the continuation', async () => {
  const built = buildPromptForMode(parseAndConsumeLoopArgs('check CI'), { createToken: () => 'issued-token' })
  const scheduledPrompt = built.match(/--- BEGIN SCHEDULED PROMPT ---\n([^\n]+)/)?.[1]
  expect(scheduledPrompt).toBe('/loop --noa-loop-state=issued-token check CI')

  const input = { cron: '*/5 * * * *', prompt: scheduledPrompt!, recurring: false, durable: false }
  expect(await CronCreateTool.validateInput?.(input)).toEqual({ result: true })
  expect(await CronCreateTool.validateInput?.(input)).toEqual({ result: true })
  expect(reserveDynamicLoopScheduledPrompt(input.prompt, false, false)).toBeNull()
  expect(await CronCreateTool.validateInput?.(input)).toMatchObject({ result: false, errorCode: 5 })
  releaseDynamicLoopScheduledPrompt(input.prompt)
  expect(await CronCreateTool.validateInput?.(input)).toEqual({ result: true })
})

test('an unrelated cron error does not consume an issued continuation', async () => {
  const built = buildPromptForMode(parseAndConsumeLoopArgs('check CI'), {
    createToken: () => 'retry-after-invalid-cron',
  })
  const prompt = built.match(/--- BEGIN SCHEDULED PROMPT ---\n([^\n]+)/)?.[1]

  expect(await CronCreateTool.validateInput?.({
    cron: 'not a cron',
    prompt: prompt!,
    recurring: false,
    durable: false,
  })).toMatchObject({ result: false, errorCode: 1 })
  expect(await CronCreateTool.validateInput?.({
    cron: '*/5 * * * *',
    prompt: prompt!,
    recurring: false,
    durable: false,
  })).toEqual({ result: true })
})

test('durability is judged the way call() resolves it, not as the model asked', async () => {
  const built = buildPromptForMode(parseAndConsumeLoopArgs('check CI'), {
    createToken: () => 'durable-gate-probe',
  })
  const prompt = built.match(/--- BEGIN SCHEDULED PROMPT ---\n([^\n]+)/)?.[1]!

  // The kill switch downgrades durable to session-only inside call(), so
  // validateInput has to apply the same downgrade. Judging the raw flag would
  // reject a request that would have executed fine once the gate flipped.
  expect(
    validateDynamicLoopScheduledPrompt(
      prompt,
      false,
      true && /* isDurableCronEnabled() === */ false,
    ),
  ).toBeNull()
  expect(
    validateDynamicLoopScheduledPrompt(prompt, false, true),
  ).toContain('recurring or durable')
})
