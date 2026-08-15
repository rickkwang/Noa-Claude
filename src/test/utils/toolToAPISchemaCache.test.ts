import { afterEach, beforeEach, expect, test } from 'bun:test'
import { z } from 'zod/v4'

import { toolToAPISchema } from '../../utils/api.js'
import {
  clearToolSchemaCache,
  getToolSchemaCache,
} from '../../utils/toolSchemaCache.js'

// The lean/verbose gate judges provider identity from env
// (isUntrustedModelIdentity): an ambient ANTHROPIC_BASE_URL or
// CLAUDE_CODE_USE_* from the dev shell flips every assertion here to the
// verbose branch. Scrub before each test, restore after.
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
  'NOA_CLAUDE_WRITE_REQUIRE_READ',
] as const
const originalProviderEnv = Object.fromEntries(
  PROVIDER_ENV_KEYS.map(k => [k, process.env[k]]),
)
beforeEach(() => {
  for (const k of PROVIDER_ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of PROVIDER_ENV_KEYS) {
    const value = originalProviderEnv[k]
    if (value === undefined) delete process.env[k]
    else process.env[k] = value
  }
})

test('tool schema cache separates lean models with different structured-output support', async () => {
  clearToolSchemaCache()

  const tool = {
    name: 'strict_cache_model_split',
    strict: true,
    inputSchema: z.object({ value: z.string() }),
    async prompt() {
      return 'shared lean description'
    },
  } as never
  const options = {
    getToolPermissionContext: async () => ({}) as never,
    tools: [] as never,
    agents: [] as never,
  }

  await toolToAPISchema(tool, {
    ...options,
    model: 'claude-fable-5',
  })
  await toolToAPISchema(tool, {
    ...options,
    model: 'future-lean-model',
  })

  expect(getToolSchemaCache()).toHaveLength(2)
})

test('a render started before cache invalidation cannot restore stale schema', async () => {
  clearToolSchemaCache()

  let signalStarted!: () => void
  let releasePrompt!: () => void
  const started = new Promise<void>(resolve => { signalStarted = resolve })
  const promptGate = new Promise<void>(resolve => { releasePrompt = resolve })
  const tool = {
    name: 'async_cache_generation',
    inputSchema: z.object({ value: z.string() }),
    async prompt() {
      signalStarted()
      await promptGate
      return 'stale schema'
    },
  } as never

  const pending = toolToAPISchema(tool, {
    getToolPermissionContext: async () => ({}) as never,
    tools: [] as never,
    agents: [] as never,
    model: 'claude-sonnet-4-6',
  })
  await started
  clearToolSchemaCache()
  releasePrompt()
  await pending

  expect(getToolSchemaCache()).toHaveLength(0)
})
