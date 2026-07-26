import { describe, expect, test } from 'bun:test'
import { buildDynamicSystemPromptSections } from '../../constants/systemPromptAssemblyHelpers.js'
import {
  ACT_DONT_REDERIVE_SECTION,
  CORRECTIONS_SECTION,
  DELIVERING_WORK_SECTION,
  PRONOUNS_SECTION,
} from '../../constants/systemPromptCoreSections.js'

const LEAN_MODEL = 'claude-opus-5'
const VERBOSE_MODEL = 'claude-opus-4-5'

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

  test('act-dont-rederive is emitted in both prompt modes', () => {
    for (const model of [LEAN_MODEL, VERBOSE_MODEL]) {
      expect(resolve(model, 'act_dont_rederive')).toBe(
        ACT_DONT_REDERIVE_SECTION,
      )
    }
  })

  test('delivering-work and corrections ship only with the compact head', () => {
    expect(resolve(LEAN_MODEL, 'delivering_work:L')).toBe(
      DELIVERING_WORK_SECTION,
    )
    expect(resolve(LEAN_MODEL, 'corrections:L')).toBe(CORRECTIONS_SECTION)

    expect(resolve(VERBOSE_MODEL, 'delivering_work')).toBeNull()
    expect(resolve(VERBOSE_MODEL, 'corrections')).toBeNull()
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
    for (const name of ['pronouns', 'act_dont_rederive']) {
      expect(sectionNames(LEAN_MODEL)).toContain(name)
      expect(sectionNames(VERBOSE_MODEL)).toContain(name)
    }
  })
})
