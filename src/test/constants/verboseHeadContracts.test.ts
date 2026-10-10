import { describe, expect, test } from 'bun:test'

import { buildStaticSystemPromptSections } from '../../constants/systemPromptAssemblyHelpers.js'
import {
  CONTEXT_MANAGEMENT_SECTION,
  getDoingTasksSection,
  getSimpleIntroSection,
  getSimpleSystemSection,
} from '../../constants/systemPromptCoreSections.js'
import {
  getCompactHeadSection,
  SECURITY_POLICY,
} from '../../constants/systemPromptCompact.js'

const TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite'])

describe('the verbose head follows the output-style gate', () => {
  const head = buildStaticSystemPromptSections({
    enabledTools: TOOLS,
    includeCodingStyleSection: false,
    boundaryMarker: null,
    resolvedDynamicSections: [],
    proactiveSection: null,
    hasOutputStyle: false,
  }).filter((s): s is string => s !== null)

  test('a non-coding style omits Doing tasks', () => {
    expect(head).toHaveLength(5)
    expect(head.slice(1).map(s => s.split('\n')[0])).toEqual([
      '# System',
      '# Executing actions with care',
      '# Using your tools',
      '# Tone and style',
    ])
  })

  test('the intro is the only unheaded section', () => {
    expect(head[0]).not.toContain('\n# ')
    expect(head[0]).toContain('You are Noa Claude')
  })
})

describe('the coding-style gate omits Doing tasks', () => {
  test('the section is not emitted', () => {
    expect(getDoingTasksSection(TOOLS, false)).toBeNull()
  })
})

describe('security policy reaches both prompt tiers', () => {
  // Both placements are byte-level ports from upstream — see the comment on
  // SECURITY_POLICY for the two upstream builders they mirror. What the tests
  // pin is that neither tier drops it: a model on the verbose tier — every
  // Sonnet/Haiku/Opus 4.x model, and every Bedrock/Vertex/Foundry or
  // third-party route regardless of model — must not be the one tier that
  // goes without a security boundary.
  test('the compact head carries it', () => {
    expect(getCompactHeadSection(false)).toContain(SECURITY_POLICY)
  })

  test('the verbose intro carries it', () => {
    expect(getSimpleIntroSection()).toContain(SECURITY_POLICY)
  })

  test('neither tier states it twice', () => {
    for (const head of [getCompactHeadSection(false), getSimpleIntroSection()]) {
      expect(head.split('IMPORTANT: Assist with authorized security testing')).toHaveLength(2)
    }
  })

  test('the verbose intro keeps upstream spacing around it', () => {
    // Upstream's intro is identity line, blank line, then the URL rule on the
    // very next line — a single newline, not a blank one. The policy goes in
    // ahead of the URL rule without disturbing that.
    const intro = getSimpleIntroSection()
    expect(intro).toContain(`\n\n${SECURITY_POLICY}\nIMPORTANT: You must NEVER generate or guess URLs`)
  })
})

describe('both tiers defer to a configured output style', () => {
  // Upstream swaps the same clause in both head builders. Getting it right in
  // only one tier leaves verbose-tier users with a style configured and an
  // identity line that still claims the session is about software engineering.
  const STYLE_CLAUSE = 'according to your "Output Style" below'

  test('compact head', () => {
    expect(getCompactHeadSection(true)).toContain(STYLE_CLAUSE)
    expect(getCompactHeadSection(false)).not.toContain(STYLE_CLAUSE)
  })

  test('verbose intro', () => {
    expect(getSimpleIntroSection(true)).toContain(STYLE_CLAUSE)
    expect(getSimpleIntroSection(false)).not.toContain(STYLE_CLAUSE)
  })

  test('the default stays the software-engineering wording', () => {
    expect(getSimpleIntroSection()).toContain(
      'helps users with software engineering tasks. Use the instructions below',
    )
  })

  test('the style branch keeps the sentence that follows it', () => {
    expect(getSimpleIntroSection(true)).toContain(
      'respond to user queries. Use the instructions below and the tools available to you to assist the user.',
    )
  })

  test('the static assembly threads the flag through', () => {
    const withStyle = buildStaticSystemPromptSections({
      enabledTools: new Set<string>(),
      includeCodingStyleSection: false,
      boundaryMarker: null,
      resolvedDynamicSections: [],
      proactiveSection: null,
      hasOutputStyle: true,
    }).join('\n')
    expect(withStyle).toContain(STYLE_CLAUSE)
  })
})

// The verbose head sections are verbatim ports, pinned by digest in
// portedPromptRegistry.ts and byte-checked against upstream by verify:ports.
// Only the one deliberate deviation is asserted here.
describe('the system section avoids duplicating context management', () => {
  // Upstream's closing compaction claim is the single intentional deviation in
  // this section: dropped as a duplicate of CONTEXT_MANAGEMENT_SECTION, which
  // is emitted unconditionally for every model and says the same thing without
  // over-promising unlimited history.
  const section = getSimpleSystemSection()

  test('the dropped bullet is covered by # Context management instead', () => {
    expect(section).not.toContain('not limited by the context window')
    expect(CONTEXT_MANAGEMENT_SECTION).toContain('current context is summarized')
    expect(CONTEXT_MANAGEMENT_SECTION).toContain(
      "you don't need to wrap up early",
    )
  })
})
