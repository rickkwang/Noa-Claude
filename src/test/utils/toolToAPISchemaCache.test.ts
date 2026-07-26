import { expect, test } from 'bun:test'
import { z } from 'zod/v4'

import { toolToAPISchema } from '../../utils/api.js'
import {
  clearToolSchemaCache,
  getToolSchemaCache,
} from '../../utils/toolSchemaCache.js'

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
