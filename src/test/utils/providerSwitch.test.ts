import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getAllModelBetas } from '../../utils/betas.js'
import {
  getClassifierProbeState,
  tryBeginClassifierProbe,
} from '../../utils/permissions/autoModeState.js'
import { getAgentModel } from '../../utils/model/agent.js'
import {
  getDefaultOpusModel,
  getDefaultSonnetModel,
} from '../../utils/model/model.js'
import {
  _setBedrockInferenceProfileLoaderForTesting,
  ensureModelStringsInitialized,
} from '../../utils/model/modelStrings.js'
import { clearProviderSwitchCaches } from '../../utils/providerSwitch.js'
import { getToolSchemaCache } from '../../utils/toolSchemaCache.js'

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_BEDROCK_REGION_PREFIX',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

beforeEach(() => {
  // getDefaultSonnetModel() prefers ANTHROPIC_DEFAULT_SONNET_MODEL over the
  // built-in default — an ambient value (e.g. from an active provider
  // profile) would replace the 'claude-sonnet-5-5' these tests assert.
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  delete process.env.ANTHROPIC_BEDROCK_REGION_PREFIX
  delete process.env.AWS_DEFAULT_REGION
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
  clearProviderSwitchCaches()
  _setBedrockInferenceProfileLoaderForTesting()
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

  test('invalidates classifier probe state when the provider switches', () => {
    expect(tryBeginClassifierProbe('provider-a:model-a')).toBeDefined()
    expect(getClassifierProbeState()).toBe('probing')

    clearProviderSwitchCaches()

    expect(getClassifierProbeState()).toBe('unprobed')
  })

  test('rebuilds provider-specific model IDs after switching providers', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    clearProviderSwitchCaches()
    expect(getDefaultSonnetModel()).toBe('claude-sonnet-5-5')

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    clearProviderSwitchCaches()
    // Upstream pins every cloud provider's sonnet alias to 4.5, not 4.6.
    expect(getDefaultSonnetModel()).toContain('claude-sonnet-4-5')

    delete process.env.CLAUDE_CODE_USE_BEDROCK
    clearProviderSwitchCaches()
    expect(getDefaultSonnetModel()).toBe('claude-sonnet-5-5')
  })

  test('ignores an in-flight Bedrock cache fill after switching providers', async () => {
    let resolveProfiles!: (profiles: string[]) => void
    let markStarted!: () => void
    const started = new Promise<void>(resolve => {
      markStarted = resolve
    })
    const profiles = new Promise<string[]>(resolve => {
      resolveProfiles = resolve
    })
    _setBedrockInferenceProfileLoaderForTesting(async () => {
      markStarted()
      return profiles
    })

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    clearProviderSwitchCaches()
    const staleInitialization = ensureModelStringsInitialized()
    await started

    delete process.env.CLAUDE_CODE_USE_BEDROCK
    clearProviderSwitchCaches()
    await ensureModelStringsInitialized()
    expect(getDefaultSonnetModel()).toBe('claude-sonnet-5-5')

    resolveProfiles([
      'us.anthropic.claude-sonnet-4-6-v1:0',
      'us.anthropic.claude-opus-4-7-v1:0',
    ])
    await staleInitialization

    expect(getDefaultSonnetModel()).toBe('claude-sonnet-5-5')
  })
})

describe('Bedrock inference profile selection', () => {
  async function useBedrock(region: string, profiles: string[]): Promise<void> {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.AWS_REGION = region
    _setBedrockInferenceProfileLoaderForTesting(async () => profiles)
    clearProviderSwitchCaches()
    await ensureModelStringsInitialized()
  }

  test("prefers the region's profile group", async () => {
    await useBedrock('eu-west-1', [
      'us.anthropic.claude-opus-5-5',
      'eu.anthropic.claude-opus-5-5',
    ])
    expect(getDefaultOpusModel()).toBe('eu.anthropic.claude-opus-5-5')
  })

  test("a subagent keeps its own profile when the parent's group lacks it", async () => {
    await useBedrock('eu-west-1', [
      'eu.anthropic.claude-opus-5-5',
      'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    ])
    expect(getAgentModel('haiku', 'eu.anthropic.claude-opus-5-5')).toBe(
      'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    )
  })

  test("a subagent takes the parent's group when the account has it", async () => {
    await useBedrock('us-east-1', [
      'eu.anthropic.claude-opus-5-5',
      'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    ])
    expect(getAgentModel('haiku', 'eu.anthropic.claude-opus-5-5')).toBe(
      'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    )
  })
})
