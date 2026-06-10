import { afterEach, describe, expect, test } from 'bun:test'
import { buildQueryConfig } from '../../query/config.js'

const ENV_KEY = 'NOA_CLAUDE_STREAMING_TOOL_EXECUTION'
const originalValue = process.env[ENV_KEY]

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = originalValue
  }
})

describe('buildQueryConfig streamingToolExecution gate', () => {
  test('defaults to false (GrowthBook hard-disabled, no inert-gate surprise)', () => {
    delete process.env[ENV_KEY]
    expect(buildQueryConfig().gates.streamingToolExecution).toBe(false)
  })

  test('NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1 opts in', () => {
    process.env[ENV_KEY] = '1'
    expect(buildQueryConfig().gates.streamingToolExecution).toBe(true)
  })
})
