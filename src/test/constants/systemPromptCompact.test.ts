import { afterEach, describe, expect, test } from 'bun:test'
import {
  getCompactHeadSection,
  shouldUseCompactSystemPrompt,
} from '../../constants/systemPromptCompact.js'
import { buildStaticSystemPromptSections } from '../../constants/systemPromptAssemblyHelpers.js'

const ENV_KEYS = [
  'NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('compact system prompt gate', () => {
  test('lean-trained models get the compact head', () => {
    expect(shouldUseCompactSystemPrompt('claude-opus-5')).toBe(true)
    expect(shouldUseCompactSystemPrompt('claude-fable-5')).toBe(true)
    expect(shouldUseCompactSystemPrompt('claude-mythos-5')).toBe(true)
  })

  test('older models keep the verbose head', () => {
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

  test('a pinned third-party model can opt in via lean_prompt capability', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'kimi-k2-turbo'
    expect(shouldUseCompactSystemPrompt('kimi-k2-turbo')).toBe(false)

    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'effort,lean_prompt'
    expect(shouldUseCompactSystemPrompt('kimi-k2-turbo')).toBe(true)
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
