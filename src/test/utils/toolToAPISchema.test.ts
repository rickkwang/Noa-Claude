import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { toolToAPISchema } from '../../utils/api.js'
import { shouldUseCompactSystemPrompt } from '../../constants/systemPromptCompact.js'
import type { Tool } from '../../Tool.js'

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

// Minimal MCP-like tool whose schema is supplied as raw JSON Schema via
// inputJSONSchema (the branch real MCP tools take). The cache in
// toolToAPISchema is keyed on name + schema, so each case uses a unique name.
function makeMcpTool(name: string, inputJSONSchema: unknown): Tool {
  return {
    name,
    inputJSONSchema,
    inputSchema: undefined,
    async prompt() {
      return `desc for ${name}`
    },
  } as unknown as Tool
}

const options = {
  getToolPermissionContext: async () => ({}) as never,
  tools: [] as never,
  agents: [] as never,
}

describe('toolToAPISchema input_schema normalization', () => {
  test('defaults a missing top-level type to "object"', async () => {
    const tool = makeMcpTool('mcp__loose__no_type', {
      properties: { q: { type: 'string' } },
      required: ['q'],
    })
    const result = await toolToAPISchema(tool, options)
    expect((result as { input_schema: { type?: unknown } }).input_schema.type).toBe(
      'object',
    )
  })

  test('leaves a well-formed object schema untouched', async () => {
    const tool = makeMcpTool('mcp__ok__has_type', {
      type: 'object',
      properties: { q: { type: 'string' } },
    })
    const result = await toolToAPISchema(tool, options)
    const schema = (result as { input_schema: Record<string, unknown> })
      .input_schema
    expect(schema.type).toBe('object')
    expect(schema.properties).toEqual({ q: { type: 'string' } })
  })

  test('flattens a top-level anyOf into a merged object (required dropped)', async () => {
    const tool = makeMcpTool('mcp__union__anyof', {
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    const result = await toolToAPISchema(tool, options)
    const schema = (result as { input_schema: Record<string, unknown> })
      .input_schema
    expect(schema.type).toBe('object')
    expect(schema.anyOf).toBeUndefined()
    expect(schema.properties).toEqual({
      a: { type: 'string' },
      b: { type: 'number' },
    })
    // A field required by only one branch isn't required overall.
    expect(schema.required).toBeUndefined()
  })

  test('flattens a top-level allOf and unions required', async () => {
    const tool = makeMcpTool('mcp__intersection__allof', {
      type: 'object',
      allOf: [
        { properties: { a: { type: 'string' } }, required: ['a'] },
        { properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    const result = await toolToAPISchema(tool, options)
    const schema = (result as { input_schema: Record<string, unknown> })
      .input_schema
    expect(schema.type).toBe('object')
    expect(schema.allOf).toBeUndefined()
    expect(schema.properties).toEqual({
      a: { type: 'string' },
      b: { type: 'number' },
    })
    expect((schema.required as string[]).sort()).toEqual(['a', 'b'])
  })

  test('flattens a top-level oneOf', async () => {
    const tool = makeMcpTool('mcp__union__oneof', {
      oneOf: [
        { type: 'object', properties: { x: { type: 'string' } } },
        { type: 'object', properties: { y: { type: 'string' } } },
      ],
    })
    const result = await toolToAPISchema(tool, options)
    const schema = (result as { input_schema: Record<string, unknown> })
      .input_schema
    expect(schema.type).toBe('object')
    expect(schema.oneOf).toBeUndefined()
    expect(schema.properties).toEqual({
      x: { type: 'string' },
      y: { type: 'string' },
    })
  })

  test('leaves nested anyOf inside a property untouched', async () => {
    const tool = makeMcpTool('mcp__nested__anyof', {
      type: 'object',
      properties: {
        val: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
    })
    const result = await toolToAPISchema(tool, options)
    const schema = (result as { input_schema: Record<string, unknown> })
      .input_schema
    expect(schema.properties).toEqual({
      val: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    })
  })
})

describe('toolToAPISchema per-session cache and the lean/verbose split', () => {
  // toolToAPISchema memoizes its result for the rest of the process (see
  // toolSchemaCache.ts) to keep the tool block byte-stable against
  // GrowthBook flips. tool.prompt() now also branches on `model` (lean vs
  // verbose description) — the cache key must include that split, or a
  // mid-session /model switch between a lean-tier and a verbose-tier model
  // would keep serving the first model's rendered description forever.
  function makeModelAwareTool(name: string): Tool {
    return {
      name,
      inputSchema: z.object({}),
      async prompt({ model }: { model?: string }) {
        return shouldUseCompactSystemPrompt(model)
          ? 'lean description'
          : 'verbose description'
      },
    } as unknown as Tool
  }

  test('switching from a verbose-tier to a lean-tier model re-renders the description', async () => {
    const tool = makeModelAwareTool('cache_split_verbose_then_lean')
    const verbose = await toolToAPISchema(tool, { ...options, model: 'claude-sonnet-5' })
    const lean = await toolToAPISchema(tool, { ...options, model: 'claude-opus-5' })
    expect((verbose as { description: string }).description).toBe('verbose description')
    expect((lean as { description: string }).description).toBe('lean description')
  })

  test('re-rendering with the same lean/verbose tier still hits the cache', async () => {
    const tool = makeModelAwareTool('cache_split_stable')
    const first = await toolToAPISchema(tool, { ...options, model: 'claude-opus-5' })
    const second = await toolToAPISchema(tool, { ...options, model: 'claude-fable-5' })
    // Both are lean-tier models — same cache entry, same rendered text.
    expect((first as { description: string }).description).toBe('lean description')
    expect((second as { description: string }).description).toBe('lean description')
  })
})
