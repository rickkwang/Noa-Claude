import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { buildDynamicSystemPromptSections } from '../../constants/systemPromptAssemblyHelpers.js'
import {
  ACT_DONT_REDERIVE_SECTION,
  CONTEXT_MANAGEMENT_SECTION,
  CORRECTIONS_SECTION,
  DELIVERING_WORK_SECTION,
  PRONOUNS_SECTION,
} from '../../constants/systemPromptCoreSections.js'
import {
  hasFableMitigations,
  MATCH_SURROUNDING_CODE_SECTION,
} from '../../constants/systemPromptCompact.js'

const LEAN_MODEL = 'claude-opus-5'

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
const VERBOSE_MODEL = 'claude-opus-4-5'
// Lean, but without the prompt bundle — upstream declares that capability for
// Opus 5 alone, so this model takes the other branch of the companion gates.
const UNBUNDLED_LEAN_MODEL = 'claude-fable-5'

function sectionNames(model: string): string[] {
  return buildDynamicSystemPromptSections({
    enabledTools: new Set(['Bash', 'Read']),
    skillToolCommands: [],
    model,
    outputStyleConfig: null,
  }).map(s => s.name)
}

function resolve(model: string, name: string): string | null {
  const section = buildDynamicSystemPromptSections({
    enabledTools: new Set(['Bash', 'Read']),
    skillToolCommands: [],
    model,
    outputStyleConfig: null,
  }).find(s => s.name === name)
  return section ? (section.compute() as string | null) : null
}

describe('sections that ship alongside the compact head', () => {
  test('pronoun guidance is emitted in both prompt modes', () => {
    for (const model of [LEAN_MODEL, VERBOSE_MODEL]) {
      expect(sectionNames(model)).toContain('pronouns')
      expect(resolve(model, 'pronouns')).toBe(PRONOUNS_SECTION)
    }
  })

  test('context management is emitted in both prompt modes', () => {
    for (const model of [LEAN_MODEL, VERBOSE_MODEL]) {
      expect(sectionNames(model)).toContain('context_management')
      expect(resolve(model, 'context_management')).toBe(
        CONTEXT_MANAGEMENT_SECTION,
      )
    }
  })

  test('act-dont-rederive is emitted in both prompt modes', () => {
    for (const model of [LEAN_MODEL, VERBOSE_MODEL]) {
      expect(resolve(model, 'act_dont_rederive')).toBe(
        ACT_DONT_REDERIVE_SECTION,
      )
    }
  })

  // Under the compact head this sentence is the only style guidance there is —
  // the verbose "# Tone and style" section goes away with the long head.
  test('the coding-style line replaces tone-and-style under the compact head', () => {
    expect(resolve(LEAN_MODEL, 'anti_verbosity:L')).toBe(
      MATCH_SURROUNDING_CODE_SECTION,
    )
    expect(resolve(VERBOSE_MODEL, 'anti_verbosity')).toBeNull()
  })

  // Fable/Mythos take upstream's long branch instead, which restates the
  // one-liner as its second-to-last paragraph.
  test('fable-mitigation models take the long branch', () => {
    for (const model of ['claude-fable-5', 'claude-mythos-5']) {
      const section = resolve(model, 'anti_verbosity:fable')
      expect(section).toStartWith('# Communicating with the user\n')
      expect(section).toContain(MATCH_SURROUNDING_CODE_SECTION)
      expect(sectionNames(model)).not.toContain('anti_verbosity:L')
    }
  })

  // getCanonicalName() has no Mythos branch, so Mythos 5 canonicalizes to
  // `claude-mythos`. Matching a versioned id here silently routes it to the
  // wrong branch — which is how it was written before.
  test('Mythos routes by family, not by a versioned id', () => {
    expect(hasFableMitigations('claude-mythos-5')).toBe(true)
    expect(hasFableMitigations('claude-opus-5')).toBe(false)
  })

  test('action caution ships only with the compact head', () => {
    expect(sectionNames(LEAN_MODEL)).toContain('action_caution:L')
    expect(resolve(LEAN_MODEL, 'action_caution:L')).toContain(
      'For actions that are hard to reverse or outward-facing, confirm first',
    )

    expect(sectionNames(VERBOSE_MODEL)).toContain('action_caution')
    expect(resolve(VERBOSE_MODEL, 'action_caution')).toBeNull()
  })

  // Upstream emits it as a dynamic section immediately after the pronoun
  // guidance, not as part of the static head — its wording is model-dependent,
  // so baking it into the cached prefix would serve one model's text to another.
  test('action caution sits where upstream puts it', () => {
    const names = sectionNames(LEAN_MODEL)
    expect(names.indexOf('action_caution:L')).toBe(
      names.indexOf('pronouns') + 1,
    )
  })

  test('delivering-work and corrections ship only with the compact head', () => {
    expect(resolve(LEAN_MODEL, 'delivering_work:L')).toBe(
      DELIVERING_WORK_SECTION,
    )
    expect(resolve(LEAN_MODEL, 'corrections:L')).toBe(CORRECTIONS_SECTION)

    expect(resolve(VERBOSE_MODEL, 'delivering_work')).toBeNull()
    expect(resolve(VERBOSE_MODEL, 'corrections')).toBeNull()
  })

  // The companion sections ride on the prompt bundle, not on the compact head.
  // A lean model without the bundle gets the head and none of them — which is
  // three of the four lean models upstream ships.
  test('a lean model without the prompt bundle gets neither companion', () => {
    expect(resolve(UNBUNDLED_LEAN_MODEL, 'delivering_work')).toBeNull()
    expect(resolve(UNBUNDLED_LEAN_MODEL, 'corrections')).toBeNull()

    // ...but it does get the longer action-caution wording.
    expect(resolve(UNBUNDLED_LEAN_MODEL, 'action_caution:L:nb')).toContain(
      "if what you find contradicts how it was described, or you didn't create it",
    )
  })

  // resolveSystemPromptSections() memoizes on the section name alone, so a
  // model-dependent section that kept one name across a /model switch would
  // serve the previous tier's text for the rest of the session.
  test('mode-dependent sections carry a lean suffix so a model switch busts the cache', () => {
    const lean = sectionNames(LEAN_MODEL)
    const verbose = sectionNames(VERBOSE_MODEL)

    expect(lean).toContain('delivering_work:L')
    expect(lean).toContain('corrections:L')
    expect(verbose).toContain('delivering_work')
    expect(verbose).toContain('corrections')
    expect(verbose).not.toContain('delivering_work:L')
    expect(verbose).not.toContain('corrections:L')
  })

  test('mode-independent sections keep a stable name across a model switch', () => {
    for (const name of [
      'pronouns',
      'act_dont_rederive',
      'context_management',
    ]) {
      expect(sectionNames(LEAN_MODEL)).toContain(name)
      expect(sectionNames(VERBOSE_MODEL)).toContain(name)
    }
  })
})
