import { afterEach, describe, expect, test } from 'bun:test'
import { getAllModelBetas, clearBetasCaches } from '../../utils/betas.js'
import { clearProviderSwitchCaches } from '../../utils/providerSwitch.js'
import { getToolSchemaCache } from '../../utils/toolSchemaCache.js'

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
  clearBetasCaches()
  getToolSchemaCache().clear()
})

describe('provider switch cache clearing', () => {
  test('drops stale 1P beta decisions when switching to a custom base URL', () => {
    const model = 'claude-opus-4-8-provider-switch-cache'
    process.env.ANTHROPIC_API_KEY = 'sk-test-provider-switch'
    delete process.env.ANTHROPIC_BASE_URL

    expect(getAllModelBetas(model)).toContain('claude-code-20250219')

    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    clearProviderSwitchCaches()

    expect(getAllModelBetas(model)).not.toContain('claude-code-20250219')
  })

  test('clears rendered tool schemas that may contain provider-gated fields', () => {
    getToolSchemaCache().set('ExampleTool', {
      name: 'ExampleTool',
      description: 'cached schema',
      input_schema: { type: 'object' },
      strict: true,
    })

    clearProviderSwitchCaches()

    expect(getToolSchemaCache().size).toBe(0)
  })
})
