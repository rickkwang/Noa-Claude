import { afterEach, expect, test } from 'bun:test'
import { getMaxToolUseConcurrency } from '../../../services/tools/toolOrchestration.js'
import { all } from '../../../utils/generators.js'

const original = process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
  else process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY = original
})

test.each(['-1', '0', 'NaN', '2.5', '2garbage', '', 'Infinity'])('invalid tool concurrency %s falls back without dropping tools', async value => {
  process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY = value
  expect(getMaxToolUseConcurrency()).toBe(10)
  let started = 0
  async function* tool() { started++; yield started }
  for await (const _ of all([tool(), tool()], getMaxToolUseConcurrency())) {}
  expect(started).toBe(2)
})

test.each(['1', '2', '20'])('positive tool concurrency %s is preserved', value => {
  process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY = value
  expect(getMaxToolUseConcurrency()).toBe(Number(value))
})
