import { describe, expect, test } from 'bun:test'

import { buildStaticSystemPromptSections } from '../../constants/systemPromptAssemblyHelpers.js'
import {
  CONTEXT_MANAGEMENT_SECTION,
  getActionsSection,
  getDoingTasksSection,
  getSimpleIntroSection,
  getSimpleSystemSection,
  getSimpleToneAndStyleSection,
  getUsingYourToolsSection,
} from '../../constants/systemPromptCoreSections.js'
import {
  getCompactHeadSection,
  SECURITY_POLICY,
} from '../../constants/systemPromptCompact.js'

/**
 * Behavior pins for the verbose head.
 *
 * The lean head is protected by leanPromptPortIntegrity.test.ts, which digests
 * text ported byte-for-byte from upstream. The verbose head has no such anchor:
 * most of it is authored here, so a well-meaning edit can drop a rule without
 * any test noticing. These pins name the rules that must survive, not the exact
 * wording — rephrasing is allowed, deleting is not.
 *
 * The coding-style bullets are deliberately unexercised: they interpolate
 * MACRO, a build-time global the bundler injects, so anything built here has to
 * pass includeCodingStyleSection: false.
 */

const TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite'])

describe('the verbose head keeps upstream\'s six-section shape', () => {
  // Upstream's verbose head is intro + five `# ` sections. This fork ran nine
  // for a while, with `# Doing tasks` split four ways; folding them back is what
  // these pin. A new top-level heading is a real decision — it competes with the
  // others for attention — so adding one should have to break a test first.
  const head = buildStaticSystemPromptSections({
    enabledTools: TOOLS,
    includeCodingStyleSection: false,
    boundaryMarker: null,
    resolvedDynamicSections: [],
    proactiveSection: null,
    hasOutputStyle: false,
  }).filter((s): s is string => s !== null)

  test('intro plus exactly five headed sections', () => {
    expect(head).toHaveLength(6)
    expect(head.slice(1).map(s => s.split('\n')[0])).toEqual([
      '# System',
      '# Doing tasks',
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

describe('# Doing tasks carries all four folded groups', () => {
  // These were four sibling sections. The heading merge must not have dropped a
  // group — each needle below is from a different one.
  const section = getDoingTasksSection(TOOLS, false)

  const groups: Array<[string, string]> = [
    ['execution guards', 'OWASP top 10 vulnerabilities'],
    ['read before you propose', "do not propose changes to code you haven't read"],
    ['diagnose before switching tactics', 'diagnose why before switching tactics'],
    ['verify before reporting complete', 'verify the actual behavior with an appropriate check'],
    // This section is rendered with includeCodingStyleSection: false, which is
    // the case that matters: the coding-style group's "finish what you
    // implement" is gone here, so the corrective has to stand on its own.
    ['minimalism is not an excuse to stop early', 'no gold-plating, not skipping the finish line'],
    ['research: prefer primary sources', 'Prefer primary or official sources'],
    ['research: resolve conflicts by credibility', 'favor the most credible source'],
    ['research: facts vs inference', 'separate observed facts from inference'],
    ['design is an engineering requirement', 'treat design quality as part of the engineering requirement'],
    ['design: verify in a browser', 'start the dev server and use the feature in a browser'],
  ]

  for (const [name, needle] of groups) {
    test(name, () => {
      expect(section).toContain(needle)
    })
  }

  test('the time-estimates rule lives in tone and style, not here', () => {
    expect(section).not.toContain('time estimates')
  })

  test('the section stays close to upstream length', () => {
    // Upstream's `# Doing tasks` renders 14 lines. This fork runs longer on
    // purpose — the verbose tier serves models that need the extra guardrails —
    // but it was 30 lines once, and that was too many bullets competing in one
    // list. Ungated it should sit in the low twenties; the gated coding group
    // adds the rest.
    const lines = getDoingTasksSection(TOOLS, false).split('\n').length - 1
    expect(lines).toBeLessThanOrEqual(16)
  })

  test('WebSearch guidance appears only when the tool is enabled', () => {
    expect(getDoingTasksSection(TOOLS, false)).not.toContain('for any present-day factual question')
    expect(getDoingTasksSection(new Set([...TOOLS, 'WebSearch']), false)).toContain(
      'for any present-day factual question',
    )
  })
})

describe('the coding-style gate still only drops coding-style bullets', () => {
  // Upstream nulls the whole of `# Doing tasks` when an output style clears
  // keepCodingInstructions. This fork gates only the coding group, so execution,
  // research, and design guidance survives a non-coding output style. Merging
  // the headings was not allowed to quietly adopt upstream's coarser behavior.
  const gatedOff = getDoingTasksSection(TOOLS, false)

  test('the section is still emitted', () => {
    expect(gatedOff.split('\n')[0]).toBe('# Doing tasks')
  })

  test('execution guards survive', () => {
    expect(gatedOff).toContain('OWASP top 10 vulnerabilities')
    expect(gatedOff).toContain('Report outcomes faithfully')
  })

  test('research and design survive', () => {
    expect(gatedOff).toContain('Prefer primary or official sources')
    expect(gatedOff).toContain('treat design quality as part of the engineering requirement')
  })

  test('coding-style bullets do not', () => {
    for (const needle of [
      'Default to writing no comments',
      'Avoid backwards-compatibility hacks',
      'For exploratory questions',
      '/help',
    ]) {
      expect(gatedOff).not.toContain(needle)
    }
  })
})

describe('security policy reaches both prompt tiers', () => {
  // Both placements are byte-level ports from 2.1.220 — see the comment on
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

describe('destructive-action guardrails name concrete commands', () => {
  // Ported from upstream's long action_caution branch. These three were missing
  // here, and they are the ones that survive a weak model's paraphrase: a
  // `git status` precondition is checkable, "be careful" is not. The verbose
  // tier is exactly where that matters, since it serves models whose identity
  // cannot be vouched for.
  const section = getActionsSection()

  test('prefers a reversible step over deleting', () => {
    expect(section).toContain(
      'prefer a reversible step (move it aside, rename it, or stash it) over deleting',
    )
  })

  test("but scratch files the session created are the agent's to clean up", () => {
    expect(section).toContain('are yours to clean up freely')
  })

  test('requires git status before anything that can discard work', () => {
    expect(section).toContain('run `git status` before any command that could discard uncommitted work')
    for (const cmd of ['git checkout/restore/reset/clean', 'rm -rf on a repo path']) {
      expect(section).toContain(cmd)
    }
    expect(section).toContain('stash (with `-u` for untracked) or commit anything you find first')
  })

  test('requires a secrets check before pushing', () => {
    expect(section).toContain('`git status` after a broad `git add`')
    expect(section).toContain("double-check the file's contents before pushing")
  })

  // Survived one compression pass by accident and a second one only because it
  // was put back. All three are concrete where the surrounding prose is
  // general, which is the whole reason this tier keeps them.
  test('names durable instruction files as valid pre-authorization', () => {
    expect(section).toContain('durable instructions like CLAUDE.md')
    expect(section).toContain('does not extend to later actions or broader scope')
  })

  test('names --no-verify as the example of bypassing a safeguard', () => {
    expect(section).toContain('--no-verify')
  })

  test('states why confirming is cheap', () => {
    expect(section).toContain('cost of pausing to confirm is low')
    expect(section).toContain('lost work, unintended messages sent, deleted branches')
  })

  test('the guardrails sit inside the obstacle paragraph, not appended after it', () => {
    const closing = section.split('\n\n').at(-1) ?? ''
    expect(closing).toContain('run `git status` before any command')
    expect(closing).toEndWith('measure twice, cut once.')
  })
})

describe('using-your-tools states the Bash preference exactly once', () => {
  // The section used to open with the same sentence it closed its sub-list
  // with. Upstream states it once, naming the tools in a parenthetical.
  const section = getUsingYourToolsSection(TOOLS)

  test('one sentence carries the preference', () => {
    expect(section.match(/Prefer dedicated tools/g) ?? []).toHaveLength(1)
  })

  test('it still names the tools it prefers', () => {
    for (const name of ['Read', 'Edit', 'Write', 'Glob', 'Grep']) {
      expect(section).toContain(name)
    }
  })

  test('it still says when Bash is the right call', () => {
    expect(section).toContain('shell-only operations')
  })

  test('parallel tool calls guidance survives', () => {
    expect(section).toContain('make all independent tool calls in parallel')
  })
})

describe('tone and style keeps every concrete rule', () => {
  const section = getSimpleToneAndStyleSection()

  // Each entry is a rule that must survive rewording. Framing sentences are
  // deliberately not pinned — merging those is the point of the cleanup.
  const rules: Array<[string, string]> = [
    ['no emojis unless asked', 'Only use emojis if the user explicitly requests it'],
    ['file_path:line_number', 'file_path:line_number'],
    ['owner/repo#123 for issues and PRs', 'owner/repo#123'],
    ['no colon before tool calls', 'Do not use a colon before tool calls'],
    ['no lead-ins that assume a visible tool call', 'assume the user can see the raw tool call'],
    ['apologize once, then move on', 'acknowledge it once and fix it'],
    ["don't hedge when confident", "Don't hedge with"],
    // Moved here from the coding-style group, which means it now survives an
    // output style that clears keepCodingInstructions. Pinned on both sides:
    // present here, absent from # Doing tasks.
    ['no time estimates', 'Avoid giving time estimates'],
    ['write for a person, not a console', 'write for a person, not a console'],
    ['reader lost the thread', 'lost the thread'],
    ['proportionate to the task', 'Match the response to the task'],
    ['clear beats concise', 'Clear first, concise second'],
    ['prose over fragments', 'flowing prose'],
    ['tables only for short facts', 'tables only for short enumerable facts'],
    ['lead with the result', 'Lead with the result'],
    ['none of it applies to code', 'do not apply to code or tool calls'],
  ]

  for (const [name, needle] of rules) {
    test(name, () => {
      expect(section).toContain(needle)
    })
  }

  test('the "write for a person" framing is stated once, not four times', () => {
    // Before the cleanup this idea opened four consecutive paragraphs. What
    // follows the bullets is now two paragraphs plus the one-line
    // does-not-apply-to-code coda, so three is the ceiling.
    const prose = section.split('\n\n').slice(1)
    expect(prose.length).toBeLessThanOrEqual(3)
  })
})

describe('the system section avoids duplicating context management', () => {
  // Upstream 2.1.220 has six bullets here. The sixth was its compaction claim,
  // and it is the single intentional deviation in this section: dropped as a
  // duplicate of CONTEXT_MANAGEMENT_SECTION, which is emitted unconditionally
  // for every model and says the same thing without over-promising unlimited
  // history. Everything else stays a 1:1 port, so any *other* change here is
  // almost certainly a mistake. See getSimpleSystemSection() for the reasoning.
  const section = getSimpleSystemSection()

  test('five bullets', () => {
    expect(section.split('\n - ')).toHaveLength(5 + 1)
  })

  test('the dropped bullet is covered by # Context management instead', () => {
    expect(section).not.toContain('not limited by the context window')
    expect(CONTEXT_MANAGEMENT_SECTION).toContain('current context is summarized')
    expect(CONTEXT_MANAGEMENT_SECTION).toContain(
      "you don't need to wrap up early",
    )
  })

  test('covers permission mode, injected tags, injection, and hooks', () => {
    for (const needle of [
      'user-selected permission mode',
      '<system-reminder>',
      'attempt at prompt injection',
      "Users may configure 'hooks'",
    ]) {
      expect(section).toContain(needle)
    }
  })
})
