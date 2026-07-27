import { afterEach, describe, expect, test } from 'bun:test'

// Rendering Bash's git block resolves commit attribution, which walks through
// model defaults into auth. Tests here are self-contained (no preload).
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'

import {
  getCompactHeadSection,
  hasFableMitigations,
  hasOpus5PromptBundle,
  shouldUseCompactSystemPrompt,
} from '../../constants/systemPromptCompact.js'
import { buildStaticSystemPromptSections } from '../../constants/systemPromptAssemblyHelpers.js'
import { getSimplePrompt as getBashPrompt } from '../../tools/BashTool/prompt.js'
import * as compactPrompt from '../../constants/systemPromptCompact.js'

const ENV_KEYS = [
  'NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
  'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

// Extracted from the local official Claude Code 2.1.220 binary
// (sha256: 8addc857f3fe64d5a0368af9ee50321b50afb4a6918ba3ef018ab84f5dbbe081).
// These are effective capability facts, not a claim that Noa's
// product-specific prompt surface is byte-for-byte identical to Claude Code.
const OFFICIAL_2_1_220_PROMPT_CAPABILITIES = {
  'claude-opus-5': {
    leanPrompt: true,
    opus5PromptBundle: true,
    fable5Mitigations: false,
  },
  'claude-fable-5': {
    leanPrompt: true,
    opus5PromptBundle: false,
    fable5Mitigations: true,
  },
  // Mythos 5's manifest row upstream is `capabilities:[]` — empty. Both
  // `true`s here come from upstream's by-name short-circuits, not a manifest
  // declaration: `oug(e)` (the lean gate) has `t==="claude-mythos-5"` ORed in
  // alongside its `LN(t,"lean_prompt")` check, and `W1e(e)` (the fable gate)
  // has the same `||e==="claude-mythos-5"` alongside `LN(e,"fable_5_mitigations")`.
  // Don't "fix" this to `false` by re-checking the manifest row alone.
  'claude-mythos-5': {
    leanPrompt: true,
    opus5PromptBundle: false,
    fable5Mitigations: true,
  },
  'claude-opus-4-8': {
    leanPrompt: true,
    opus5PromptBundle: false,
    fable5Mitigations: false,
  },
  'claude-opus-4-7': {
    leanPrompt: false,
    opus5PromptBundle: false,
    fable5Mitigations: false,
  },
} as const

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('compact system prompt gate', () => {
  test('exposes the official 2.1.220 prompt capability matrix', () => {
    expect('getBuiltInPromptCapabilities' in compactPrompt).toBe(true)

    const getCapabilities = (
      compactPrompt as Record<string, unknown>
    ).getBuiltInPromptCapabilities as (model: string) => unknown

    for (const [model, expected] of Object.entries(
      OFFICIAL_2_1_220_PROMPT_CAPABILITIES,
    )) {
      expect(getCapabilities(model)).toEqual(expected)
    }
  })

  test('lean-trained models get the compact head', () => {
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(true)
    expect(shouldUseCompactSystemPrompt('claude-fable-5')).toBe(true)
    expect(shouldUseCompactSystemPrompt('claude-mythos-5')).toBe(true)
  })

  test('older models keep the verbose head', () => {
    expect(shouldUseCompactSystemPrompt('claude-opus-4-20250514')).toBe(
      false,
    )
    expect(shouldUseCompactSystemPrompt('claude-opus-4-0')).toBe(false)
    expect(shouldUseCompactSystemPrompt('claude-sonnet-5')).toBe(false)
    expect(shouldUseCompactSystemPrompt('claude-haiku-4-5-20251001')).toBe(false)
    expect(shouldUseCompactSystemPrompt('claude-opus-4-7')).toBe(false)
    expect(shouldUseCompactSystemPrompt('claude-3-5-sonnet-20241022')).toBe(
      false,
    )
  })

  test('early-access builds short-circuit to the compact head', () => {
    expect(shouldUseCompactSystemPrompt('claude-opus-6-eap')).toBe(true)
    expect(shouldUseCompactSystemPrompt('claude-opus-6-eap[1m]')).toBe(true)
    // A denylisted family still goes compact when it is an EAP build.
    expect(shouldUseCompactSystemPrompt('claude-sonnet-6-eap')).toBe(true)
    // "eap" inside a longer word must not match.
    expect(shouldUseCompactSystemPrompt('claude-sonnet-5-cheap')).toBe(false)
  })

  test('third-party EAP models require an explicit lean_prompt capability', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.test/anthropic'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'third-party-opus-6-eap'

    expect(shouldUseCompactSystemPrompt('third-party-opus-6-eap')).toBe(false)

    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES =
      'lean_prompt'
    expect(shouldUseCompactSystemPrompt('third-party-opus-6-eap')).toBe(true)
  })

  test('a pinned third-party model can opt in via lean_prompt capability', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'kimi-k2-turbo'
    expect(shouldUseCompactSystemPrompt('kimi-k2-turbo')).toBe(false)

    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'effort,lean_prompt'
    expect(shouldUseCompactSystemPrompt('kimi-k2-turbo')).toBe(true)
  })

  test('a pinned third-party Fable model can opt in via its capability pair', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.test/anthropic'
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'third-party-fable'
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES =
      'lean_prompt,fable_5_mitigations'

    expect(shouldUseCompactSystemPrompt('third-party-fable')).toBe(true)
    expect(hasFableMitigations('third-party-fable')).toBe(true)
  })

  test('a third-party custom model option can declare prompt capabilities', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.test/anthropic'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'third-party-custom'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES =
      'lean_prompt'

    expect(shouldUseCompactSystemPrompt('third-party-custom')).toBe(true)
  })

  test('only Mythos 5 takes the Fable mitigation fallback', () => {
    expect(hasFableMitigations('claude-mythos-5')).toBe(true)
    expect(hasFableMitigations('claude-mythos-6')).toBe(false)
  })

  test('third-party companion capabilities require explicit declarations', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.test/anthropic'

    expect(hasOpus5PromptBundle('claude-opus-5')).toBe(false)
    expect(hasFableMitigations('claude-mythos-5')).toBe(false)
  })

  test('third-party companion capabilities require lean_prompt too', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.test/anthropic'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'third-party-fable'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES =
      'fable_5_mitigations'

    expect(shouldUseCompactSystemPrompt('third-party-fable')).toBe(false)
    expect(hasFableMitigations('third-party-fable')).toBe(false)

    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES =
      'lean_prompt,fable_5_mitigations'
    expect(shouldUseCompactSystemPrompt('third-party-fable')).toBe(true)
    expect(hasFableMitigations('third-party-fable')).toBe(true)
  })

  test('upstream policy trusts official model capabilities on third-party routes', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.test/anthropic'
    process.env.NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY = 'upstream'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'claude-opus-5'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES =
      'lean_prompt'

    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(true)
    // Upstream mode trusts the built-in model facts rather than treating an
    // incomplete third-party declaration as an authoritative deny.
    expect(hasOpus5PromptBundle('claude-opus-5')).toBe(true)
    expect(hasFableMitigations('claude-mythos-5')).toBe(true)
    expect(shouldUseCompactSystemPrompt('third-party-opus-6-eap')).toBe(true)
  })

  test('upstream policy keeps unknown customer cloud models verbose', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY = 'upstream'

    expect(shouldUseCompactSystemPrompt('third-party-random')).toBe(false)
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(true)
    expect(shouldUseCompactSystemPrompt('third-party-opus-6-eap')).toBe(true)
  })

  test('missing model falls back to the verbose head', () => {
    expect(shouldUseCompactSystemPrompt(undefined)).toBe(false)
    expect(shouldUseCompactSystemPrompt('')).toBe(false)
  })

  test('OpenAI-compatible backends keep the verbose head', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(false)
  })

  test('third-party Anthropic-compatible proxies keep the verbose head', () => {
    // Reports provider 'firstParty' but serves a different model behind a
    // Claude-shaped name, so the model id can't be trusted.
    process.env.ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic'
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(false)
  })

  test('customer-run Bedrock, Vertex and Foundry keep the verbose head', () => {
    // Upstream trusts only endpoints Anthropic operates itself. On a
    // customer's own deployment the configured id can be an inference profile
    // or custom ARN, so a Claude-shaped name proves nothing — even when
    // getCanonicalName() happens to normalize it.
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(shouldUseCompactSystemPrompt('us.anthropic.claude-opus-5-v1:0')).toBe(
      false,
    )
    delete process.env.CLAUDE_CODE_USE_BEDROCK

    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(false)
    delete process.env.CLAUDE_CODE_USE_VERTEX

    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(false)
  })

  test('a lean_prompt capability override still opts a Bedrock pin in', () => {
    // The escape hatch for a deployment the operator knows is genuine.
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'us.anthropic.claude-opus-5-v1:0'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'lean_prompt'
    expect(shouldUseCompactSystemPrompt('us.anthropic.claude-opus-5-v1:0')).toBe(
      true,
    )
  })

  // `[1m]` picks the 1M-context variant of a model, not a different model. The
  // capability lookup used to compare raw strings, so pinning the base id left
  // the 1M variant with no way to opt in at all — and since the Bedrock/Vertex
  // tightening above, this pin is their only way in.
  test('a capability override covers the 1M-context variant of the pinned model', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'us.anthropic.claude-opus-5-v1:0'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'lean_prompt'

    expect(
      shouldUseCompactSystemPrompt('us.anthropic.claude-opus-5-v1:0[1m]'),
    ).toBe(true)
    expect(
      shouldUseCompactSystemPrompt('us.anthropic.claude-opus-5-v1:0[1M]'),
    ).toBe(true)
  })

  test('a capability override on a 1M pin covers the base model too', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL =
      'us.anthropic.claude-opus-5-v1:0[1m]'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'lean_prompt'

    expect(shouldUseCompactSystemPrompt('us.anthropic.claude-opus-5-v1:0')).toBe(
      true,
    )
  })

  // Upstream keeps `lean_prompt` and `opus_5_prompt_bundle` as separate
  // per-model capabilities. They agree on every first-party model, so the only
  // way to observe the difference is a pin that declares one and not the other.
  test('the prompt bundle is a separate capability from the lean prompt', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'kimi-k2-turbo'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'lean_prompt'

    expect(shouldUseCompactSystemPrompt('kimi-k2-turbo')).toBe(true)
    expect(hasOpus5PromptBundle('kimi-k2-turbo')).toBe(false)

    // The bullet upstream gates on the bundle, not on the lean prompt.
    expect(getBashPrompt('kimi-k2-turbo')).not.toContain(
      '- Command output is displayed to you, not reliably to the user.',
    )
  })

  test('a pin can declare both capabilities', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'kimi-k2-turbo'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'lean_prompt,opus_5_prompt_bundle'

    expect(hasOpus5PromptBundle('kimi-k2-turbo')).toBe(true)
    expect(getBashPrompt('kimi-k2-turbo')).toContain(
      '- Command output is displayed to you, not reliably to the user.',
    )
  })

  // Upstream's manifest declares `lean_prompt` for Opus 5, Fable 5 and Opus 4.8
  // but `opus_5_prompt_bundle` for Opus 5 alone. Three of the four models on the
  // compact head do not carry the bundle, so the gates cannot proxy each other.
  test('the bundle is Opus 5 only, not every lean model', () => {
    expect(hasOpus5PromptBundle('claude-opus-5')).toBe(true)

    for (const leanButUnbundled of [
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-mythos-5',
    ]) {
      expect(shouldUseCompactSystemPrompt(leanButUnbundled)).toBe(true)
      expect(hasOpus5PromptBundle(leanButUnbundled)).toBe(false)
    }

    expect(hasOpus5PromptBundle('claude-opus-4-5')).toBe(false)
    expect(hasOpus5PromptBundle(undefined)).toBe(false)
  })

  test('the 1M suffix does not make an unrelated model match the pin', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'us.anthropic.claude-opus-5-v1:0'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'lean_prompt'

    expect(shouldUseCompactSystemPrompt('some-other-arn[1m]')).toBe(false)
  })

  test('env override forces the choice in both directions', () => {
    process.env.NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT = '1'
    expect(shouldUseCompactSystemPrompt('claude-sonnet-5')).toBe(true)

    process.env.NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT = '0'
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(false)
  })

  test('legacy CLAUDE_CODE_ env var is still accepted', () => {
    process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT = '1'
    expect(shouldUseCompactSystemPrompt('claude-sonnet-5')).toBe(true)
  })
})

describe('compact head content', () => {
  test('keeps upstream blank-line separators between head sections', () => {
    const head = getCompactHeadSection(false)
    expect(head).toContain(
      'software engineering tasks.\n\nIMPORTANT: Assist with authorized security testing',
    )
    expect(head).toContain(
      'security research, or defensive use cases.\n\n# Harness',
    )
  })

  test('keeps the security policy and harness section', () => {
    const head = getCompactHeadSection(false)
    expect(head).toContain('# Harness')
    expect(head).toContain('authorized security testing')
    expect(head).toContain('Noa Claude')
    expect(head).toContain('file_path:line_number')
  })

  test('defers to the output style when one is configured', () => {
    expect(getCompactHeadSection(true)).toContain('"Output Style"')
    expect(getCompactHeadSection(false)).toContain(
      'software engineering tasks',
    )
  })
})

describe('static section assembly', () => {
  // getCodingStyleAndWorkflowSection() interpolates MACRO, a build-time global
  // the bundler injects, so the verbose head can only be built with it off.
  const base = {
    enabledTools: new Set<string>(),
    includeCodingStyleSection: false,
    boundaryMarker: null,
    resolvedDynamicSections: ['# Memory\nremembered thing'],
    proactiveSection: null,
  }

  test('compact mode collapses the static head to one section', () => {
    const verbose = buildStaticSystemPromptSections(base).filter(
      s => s !== null,
    )
    const compact = buildStaticSystemPromptSections({
      ...base,
      useCompactPrompt: true,
    }).filter(s => s !== null)

    expect(compact.length).toBeLessThan(verbose.length)
    expect(compact.join('\n').length).toBeLessThan(
      verbose.join('\n').length / 2,
    )
  })

  test('dynamic sections survive the swap unchanged', () => {
    const compact = buildStaticSystemPromptSections({
      ...base,
      useCompactPrompt: true,
    })
    expect(compact).toContain('# Memory\nremembered thing')
  })

  test('boundary marker still precedes dynamic sections', () => {
    const sections = buildStaticSystemPromptSections({
      ...base,
      useCompactPrompt: true,
      boundaryMarker: '__BOUNDARY__',
    }).filter(s => s !== null)

    expect(sections.indexOf('__BOUNDARY__')).toBe(1)
    expect(sections.indexOf('# Memory\nremembered thing')).toBe(2)
  })
})
