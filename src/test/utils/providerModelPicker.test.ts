import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { buildProviderEnv, type ProviderProfile } from '../../utils/providerProfile.js'
import {
  PROVIDER_CONTEXT_WINDOWS_ENV_KEY,
  PROVIDER_EFFORT_LEVELS_ENV_KEY,
  PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY,
  PROVIDER_MODELS_ENV_KEY,
  getActiveProviderModelNames,
  serializeProviderList,
} from '../../utils/model/providerModels.js'
import { getModelOptions } from '../../utils/model/modelOptions.js'

const SAVED = { ...process.env }

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider-model-picker-test',
    name: 'Kimi Code',
    type: 'kimi',
    baseUrl: 'https://api.kimi.com/coding',
    model: 'kimi-for-coding',
    ...overrides,
  }
}

function clearProviderFlags() {
  // An Anthropic-compatible third party sets no CLAUDE_CODE_USE_* flag, so
  // getAPIProvider() reports firstParty — the case the picker used to get
  // wrong.
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
}

function applyKimiEnv(overrides: Partial<ProviderProfile> = {}) {
  for (const [key, value] of Object.entries(
    buildProviderEnv(profile({ models: ['k3', 'k3-256k'], ...overrides })),
  )) {
    process.env[key] = value
  }
}

describe('provider profile model catalogue', () => {
  afterEach(() => {
    process.env = { ...SAVED }
  })

  test('carries the discovered list through the profile env', () => {
    const env = buildProviderEnv(
      profile({ models: ['kimi-for-coding', 'kimi-k2-turbo'] }),
    )

    expect(env[PROVIDER_MODELS_ENV_KEY]).toBe('kimi-for-coding,kimi-k2-turbo')
    // The single default still pins the tier aliases — subagent lookups depend
    // on it resolving to something the endpoint serves.
    expect(env.ANTHROPIC_MODEL).toBe('kimi-for-coding')
  })

  test('omits the key entirely for a profile with no discovered models', () => {
    expect(buildProviderEnv(profile())[PROVIDER_MODELS_ENV_KEY]).toBeUndefined()
    expect(serializeProviderList([])).toBeUndefined()
    expect(serializeProviderList(['  ', ''])).toBeUndefined()
  })

  test('drops blanks, duplicates and unparseable ids on the way out and back', () => {
    expect(
      serializeProviderList(['a', ' a ', '', 'b,c', 'b']),
    ).toBe('a,b')

    process.env[PROVIDER_MODELS_ENV_KEY] = ' a , , b ,a'
    expect(getActiveProviderModelNames()).toEqual(['a', 'b'])
  })
})

describe('/model options for an active provider profile', () => {
  beforeEach(() => {
    clearProviderFlags()
    applyKimiEnv({ models: ['kimi-for-coding', 'kimi-k2-turbo', 'kimi-k2'] })
  })

  afterEach(() => {
    process.env = { ...SAVED }
  })

  test('offers every model the endpoint serves, not just the profile default', () => {
    const values = getModelOptions().map(option => option.value)

    expect(values).toContain('kimi-for-coding')
    expect(values).toContain('kimi-k2-turbo')
    expect(values).toContain('kimi-k2')
  })

  test('replaces the Claude tier rows that all resolve to the one pinned model', () => {
    const values = getModelOptions().map(option => option.value)

    expect(values).not.toContain('sonnet')
    expect(values).not.toContain('opus')
    expect(values).not.toContain('haiku')
    // Default stays: it is the way back to the profile's own default.
    expect(values[0]).toBeNull()
  })

  test('falls back to the built-in list when the profile has no catalogue', () => {
    delete process.env[PROVIDER_MODELS_ENV_KEY]

    const values = getModelOptions().map(option => option.value)
    expect(values.length).toBeGreaterThan(1)
    expect(values).not.toContain('kimi-k2-turbo')
  })
})

describe('model selection under an active provider profile', () => {
  test('a saved /model choice outranks the profile default, a caller env var still wins', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-model-choice-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({ active: true, apiKey: 'sk-kimi-test-token' }),
        ]),
      )

      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        // spawnSync inherits the parent env; scrub anything that would decide
        // the precedence before the code under test does.
        delete process.env.ANTHROPIC_MODEL
        delete process.env.ANTHROPIC_API_KEY
        delete process.env.ANTHROPIC_AUTH_TOKEN

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        await applyActiveProviderProfileEnv()
        if (process.env.ANTHROPIC_MODEL !== 'kimi-for-coding') {
          throw new Error('profile model was not applied')
        }

        const { updateSettingsForSource } =
          await import('./src/utils/settings/settings.ts')
        updateSettingsForSource('userSettings', { model: 'kimi-k2-turbo' })

        const { getUserSpecifiedModelSetting } =
          await import('./src/utils/model/model.ts')
        const saved = getUserSpecifiedModelSetting()
        if (saved !== 'kimi-k2-turbo') {
          throw new Error('profile default overrode the saved model: ' + saved)
        }

        process.env.ANTHROPIC_MODEL = 'caller-model'
        const caller = getUserSpecifiedModelSetting()
        if (caller !== 'caller-model') {
          throw new Error('caller ANTHROPIC_MODEL was ignored: ' + caller)
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})

describe('effort support for provider profile models', () => {
  beforeEach(() => {
    clearProviderFlags()
    delete process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT
    applyKimiEnv({ models: ['kimi-for-coding', 'k3', 'k3-256k'] })
  })

  afterEach(() => {
    process.env = { ...SAVED }
  })

  test('the declared levels reach every model in the catalogue, not just the pinned default', async () => {
    const { getSupportedEffortLevelsForModel } = await import(
      '../../utils/effort.js'
    )

    // k3 is not any of the four pinned tier ids — the case that used to render
    // "Effort not supported for k3".
    expect(getSupportedEffortLevelsForModel('k3')).toEqual(['low', 'high', 'max'])
    expect(getSupportedEffortLevelsForModel('k3-256k')).toEqual([
      'low',
      'high',
      'max',
    ])
  })

  test('a model documented as taking no effort parameter is declared as such', async () => {
    const { getSupportedEffortLevelsForModel } = await import(
      '../../utils/effort.js'
    )

    // K2.7 Code is `Thinking:ON` with no reasoning_effort — the same endpoint,
    // a different answer from K3's.
    expect(getSupportedEffortLevelsForModel('kimi-for-coding')).toEqual([])
  })

  test('offers exactly the levels the platform documents, skipping medium and xhigh', async () => {
    const { getSupportedEffortLevelsForModel, resolveAppliedEffort } =
      await import('../../utils/effort.js')

    const levels = getSupportedEffortLevelsForModel('k3')
    expect(levels).not.toContain('medium')
    expect(levels).not.toContain('xhigh')

    // Anything off the ladder is clamped down to a documented level rather than
    // sent through as a value K3 never defined.
    expect(resolveAppliedEffort('k3', 'medium')).toBe('low')
    expect(resolveAppliedEffort('k3', 'xhigh')).toBe('high')
    expect(resolveAppliedEffort('k3', 'max')).toBe('max')
  })

  test('a model the profile does not serve gets nothing from it', async () => {
    const { getSupportedEffortLevelsForModel } = await import(
      '../../utils/effort.js'
    )

    expect(getSupportedEffortLevelsForModel('some-other-model')).toEqual([])
  })

  test('a kimi profile gets the type default without being re-created', () => {
    // No `effortLevels` on the profile — the shape every profile saved before
    // the field existed still has on disk.
    const env = buildProviderEnv(profile({ models: ['k3'] }))
    expect(env[PROVIDER_EFFORT_LEVELS_ENV_KEY]).toBe(
      'k3=low:high:max,k3-256k=low:high:max,kimi-for-coding=,kimi-for-coding-highspeed=',
    )
  })

  test('an explicit empty list opts one model out without touching the others', async () => {
    applyKimiEnv({ models: ['k3'], effortLevels: { k3: [] } })
    const { getSupportedEffortLevelsForModel } = await import(
      '../../utils/effort.js'
    )

    expect(getSupportedEffortLevelsForModel('k3')).toEqual([])
    expect(getSupportedEffortLevelsForModel('k3-256k')).toEqual([
      'low',
      'high',
      'max',
    ])
  })

  test('a type with no verified effort support declares none', () => {
    const env = buildProviderEnv(
      profile({ type: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] }),
    )
    expect(env[PROVIDER_EFFORT_LEVELS_ENV_KEY]).toBeUndefined()
  })

  test('the [1m] variant of a declared model keeps its effort ladder', async () => {
    // `[1m]` picks a context variant, not another model, so the declarations
    // keyed by model id still apply. Kimi's own Claude Code guide pins `k3[1m]`.
    applyKimiEnv({ models: ['k3'] })
    const { getSupportedEffortLevelsForModel } = await import(
      '../../utils/effort.js'
    )

    expect(getSupportedEffortLevelsForModel('k3[1m]')).toEqual([
      'low',
      'high',
      'max',
    ])
  })
})

describe('context window for provider profile models', () => {
  beforeEach(() => {
    clearProviderFlags()
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  })

  afterEach(() => {
    process.env = { ...SAVED }
  })

  test('k3 reports the 1M window its endpoint documents, not the 200k default', async () => {
    applyKimiEnv()
    const { getContextWindowForModel } = await import('../../utils/context.js')

    expect(getContextWindowForModel('k3')).toBe(1_048_576)
  })

  test('the 256k models report 256k, not k3 window and not the 200k default', async () => {
    applyKimiEnv()
    const { getContextWindowForModel } = await import('../../utils/context.js')

    expect(getContextWindowForModel('k3-256k')).toBe(262_144)
    expect(getContextWindowForModel('kimi-for-coding')).toBe(262_144)
  })

  test('an undocumented model stays on the conservative default rather than a guess', async () => {
    applyKimiEnv()
    const { getContextWindowForModel } = await import('../../utils/context.js')

    // Under-reporting only costs an early compact; over-reporting overflows.
    expect(getContextWindowForModel('some-unlisted-model')).toBe(200_000)
  })

  test('a profile entry overrides one model without dropping the type defaults', async () => {
    applyKimiEnv({ contextWindows: { 'k3-256k': 131_072 } })
    const { getContextWindowForModel } = await import('../../utils/context.js')

    expect(getContextWindowForModel('k3-256k')).toBe(131_072)
    expect(getContextWindowForModel('k3')).toBe(1_048_576)
  })

  test('CLAUDE_CODE_DISABLE_1M_CONTEXT still caps a declared window', async () => {
    applyKimiEnv()
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    const { getContextWindowForModel } = await import('../../utils/context.js')

    expect(getContextWindowForModel('k3')).toBe(200_000)
  })

  test('drops entries that would be unparseable or nonsensical', () => {
    // A type with no defaults of its own, so this sees the serializer alone.
    const env = buildProviderEnv(
      profile({
        type: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        contextWindows: {
          'a=b': 100,
          'c,d': 100,
          ' ': 100,
          negative: -1,
          fractional: 1.5,
          good: 300_000,
        },
      }),
    )

    expect(env[PROVIDER_CONTEXT_WINDOWS_ENV_KEY]).toBe('good=300000')
  })
})

describe('max output tokens for provider profile models', () => {
  beforeEach(() => {
    clearProviderFlags()
    applyKimiEnv()
  })

  afterEach(() => {
    process.env = { ...SAVED }
  })

  test('k3 uses the documented 131k default and 1M ceiling, not the 32k/64k fallback', async () => {
    const { getModelMaxOutputTokens } = await import('../../utils/context.js')

    expect(getModelMaxOutputTokens('k3')).toEqual({
      default: 131_072,
      upperLimit: 1_048_576,
    })
  })

  test('an undocumented model keeps the built-in fallback', async () => {
    const { getModelMaxOutputTokens } = await import('../../utils/context.js')

    expect(getModelMaxOutputTokens('k3-256k')).toEqual({
      default: 32_000,
      upperLimit: 64_000,
    })
  })

  test('a profile entry overrides one model without dropping the type defaults', () => {
    const env = buildProviderEnv(
      profile({
        maxOutputTokens: { 'k3-256k': { default: 8_192, upperLimit: 16_384 } },
      }),
    )

    expect(env[PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY]).toBe(
      'k3=131072:1048576,k3-256k=8192:16384',
    )
  })

  test('drops entries that would be sent as an invalid max_tokens', () => {
    const env = buildProviderEnv(
      profile({
        type: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        maxOutputTokens: {
          // default above the ceiling would be rejected as max_tokens
          inverted: { default: 100, upperLimit: 50 },
          negative: { default: -1, upperLimit: 100 },
          fractional: { default: 1.5, upperLimit: 100 },
          'a:b': { default: 100, upperLimit: 100 },
          good: { default: 100, upperLimit: 200 },
        },
      }),
    )

    expect(env[PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY]).toBe('good=100:200')
  })
})

describe('endpoint-scoped fields', () => {
  test('a [1m] model still resolves its declared output limits', async () => {
    applyKimiEnv({ models: ['k3'] })
    try {
      const { getModelMaxOutputTokens } = await import('../../utils/context.js')

      expect(getModelMaxOutputTokens('k3[1m]')).toEqual({
        default: 131_072,
        upperLimit: 1_048_576,
      })
    } finally {
      process.env = { ...SAVED }
    }
  })

  test('pointing a profile at another endpoint drops everything read from the old one', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-endpoint-change-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        const m = await import('./src/utils/providerProfile.ts')
        const created = await m.addProviderProfile({
          name: 'Local',
          type: 'openai',
          baseUrl: 'https://first.example.test/v1',
          apiKey: 'sk-first-endpoint',
          model: 'a',
          models: ['a', 'b'],
          effortLevels: { a: ['low', 'high'] },
          contextWindows: { a: 300000 },
          maxOutputTokens: { a: { default: 8192, upperLimit: 16384 } },
        })

        const renamed = await m.updateProviderProfile(created.id, { name: 'Local 2' })
        for (const key of ['apiKey', 'models', 'effortLevels', 'contextWindows', 'maxOutputTokens']) {
          if (renamed[key] === undefined) {
            throw new Error(key + ' dropped without an endpoint change')
          }
        }

        const moved = await m.updateProviderProfile(created.id, {
          baseUrl: 'https://second.example.test/v1',
        })
        for (const key of ['apiKey', 'models', 'effortLevels', 'contextWindows', 'maxOutputTokens']) {
          if (moved[key] !== undefined) {
            throw new Error(key + ' survived an endpoint change')
          }
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
