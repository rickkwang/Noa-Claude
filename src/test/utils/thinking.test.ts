import { afterEach, describe, expect, test } from 'bun:test'
import {
  modelOmitsThinkingByDefault,
  effortRejectedWithDisabledThinking,
  MAX_EFFORT_WITH_DISABLED_THINKING,
  modelRejectsSamplingParams,
  modelRequiresExplicitThinkingDisable,
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
} from '../../utils/thinking.js'

const PROVIDER_ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
] as const

const original = Object.fromEntries(
  PROVIDER_ENV_KEYS.map(k => [k, process.env[k]]),
)

afterEach(() => {
  for (const k of PROVIDER_ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('modelSupportsAdaptiveThinking', () => {
  test('supports adaptive thinking for Bedrock Opus 4.7', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'

    expect(modelSupportsAdaptiveThinking('anthropic.claude-opus-4-7')).toBe(
      true,
    )
  })
})

describe('Fable 5 — shares the Opus 4.8 request surface', () => {
  test('uses adaptive thinking on first-party', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(modelSupportsAdaptiveThinking('claude-fable-5')).toBe(true)
  })

  test('omits thinking content by default (needs display: summarized)', () => {
    expect(modelOmitsThinkingByDefault('claude-fable-5')).toBe(true)
  })

  test('rejects sampling params (temperature/top_p/top_k)', () => {
    expect(modelRejectsSamplingParams('claude-fable-5')).toBe(true)
  })
})

describe('Sonnet 5 — Opus 4.7/4.8 request surface, but adaptive-by-default', () => {
  test('uses adaptive thinking on first-party', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(modelSupportsAdaptiveThinking('claude-sonnet-5')).toBe(true)
  })

  test('omits thinking content by default (needs display: summarized)', () => {
    expect(modelOmitsThinkingByDefault('claude-sonnet-5')).toBe(true)
  })

  test('rejects sampling params (temperature/top_p/top_k)', () => {
    expect(modelRejectsSamplingParams('claude-sonnet-5')).toBe(true)
  })

  test('requires an explicit {type: "disabled"} to actually turn thinking off', () => {
    expect(modelRequiresExplicitThinkingDisable('claude-sonnet-5')).toBe(true)
  })

  test('other models do not require the explicit disable', () => {
    expect(modelRequiresExplicitThinkingDisable('claude-opus-4-8')).toBe(false)
    expect(modelRequiresExplicitThinkingDisable('claude-fable-5')).toBe(false)
    expect(modelRequiresExplicitThinkingDisable('claude-sonnet-4-6')).toBe(
      false,
    )
  })
})

describe('effort cap alongside explicitly disabled thinking', () => {
  test('Opus 5 and Sonnet 5 require an explicit {type: "disabled"}', () => {
    expect(modelRequiresExplicitThinkingDisable('claude-opus-5')).toBe(true)
    expect(modelRequiresExplicitThinkingDisable('claude-sonnet-5')).toBe(true)
  })

  test('xhigh and max are rejected alongside disabled thinking', () => {
    expect(effortRejectedWithDisabledThinking('xhigh')).toBe(true)
    expect(effortRejectedWithDisabledThinking('max')).toBe(true)
  })

  test('high and below are accepted, and an unset effort is a no-op', () => {
    expect(effortRejectedWithDisabledThinking('high')).toBe(false)
    expect(effortRejectedWithDisabledThinking('medium')).toBe(false)
    expect(effortRejectedWithDisabledThinking('low')).toBe(false)
    expect(effortRejectedWithDisabledThinking(undefined)).toBe(false)
  })

  // The rule is a property of the disabled-thinking request shape, not of one
  // model: upstream guards its clamp on the resolved thinking type and the
  // effort rank only. Scoping this to Opus 5 previously left Sonnet 5 — the
  // other model that gets an explicit {type:'disabled'} — sending xhigh with
  // thinking off and taking the 400.
  test('is not scoped to a single model', () => {
    expect(MAX_EFFORT_WITH_DISABLED_THINKING).toBe('high')
  })
})

describe('modelOmitsThinkingByDefault', () => {
  test('Opus 4.7/4.8 omit thinking by default (need display: summarized)', () => {
    expect(modelOmitsThinkingByDefault('claude-opus-4-7')).toBe(true)
    expect(modelOmitsThinkingByDefault('claude-opus-4-8')).toBe(true)
    expect(modelOmitsThinkingByDefault('anthropic.claude-opus-4-8')).toBe(true)
  })

  test('Opus 4.6 / Sonnet 4.6 already default to summarized — no opt-in', () => {
    expect(modelOmitsThinkingByDefault('claude-opus-4-6')).toBe(false)
    expect(modelOmitsThinkingByDefault('claude-sonnet-4-6')).toBe(false)
  })
})

describe('modelSupportsThinking — third-party Anthropic-compatible', () => {
  test('direct first-party (no custom base URL) enables thinking for Claude 4+', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(modelSupportsThinking('claude-opus-4-8')).toBe(true)
  })

  test('does NOT assume thinking for a 3P model behind a custom base URL', () => {
    // kimi/minimax route through getAPIProvider()==='firstParty' with a custom
    // ANTHROPIC_BASE_URL. Before the fix this returned true (optimistic 1P
    // default) and sent an Anthropic thinking payload the endpoint may reject.
    process.env.ANTHROPIC_BASE_URL = 'https://api.kimi.com/coding'
    expect(modelSupportsThinking('kimi-for-coding')).toBe(false)
  })

  test('a 3P endpoint can still opt in via SUPPORTED_CAPABILITIES override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.kimi.com/coding'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'kimi-for-coding'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES = 'thinking'
    expect(modelSupportsThinking('kimi-for-coding')).toBe(true)
  })

  test('a real Claude model proxied through a custom base URL still requires override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    expect(modelSupportsThinking('claude-opus-4-8')).toBe(false)
  })

  test('Claude Haiku 4.5 behind a custom proxy can opt in via override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-haiku-4-5'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES = 'thinking'
    expect(modelSupportsThinking('claude-haiku-4-5')).toBe(true)
  })
})
