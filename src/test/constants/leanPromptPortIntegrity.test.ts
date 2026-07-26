import { describe, expect, test } from 'bun:test'

// Bash's git block resolves commit attribution, which walks through model
// defaults into auth. Tests here are self-contained (no preload), so seed a
// key first.
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'

import {
  ACT_DONT_REDERIVE_SECTION,
  CONTEXT_MANAGEMENT_SECTION,
  CORRECTIONS_SECTION,
  DELIVERING_WORK_SECTION,
  PRONOUNS_SECTION,
} from '../../constants/systemPromptCoreSections.js'
import { getDescription as getGlobDescription } from '../../tools/GlobTool/prompt.js'
import { getDescription as getGrepDescription } from '../../tools/GrepTool/prompt.js'
import { getEditToolDescription } from '../../tools/FileEditTool/prompt.js'
import { getWriteToolDescription } from '../../tools/FileWriteTool/prompt.js'
import { getTodoWritePrompt } from '../../tools/TodoWriteTool/prompt.js'
import { LEAN_DESCRIPTION as WEB_FETCH_LEAN_DESCRIPTION } from '../../tools/WebFetchTool/prompt.js'
import { getSimplePrompt as getBashPrompt } from '../../tools/BashTool/prompt.js'
import { getWebSearchPrompt } from '../../tools/WebSearchTool/prompt.js'
import { getAskUserQuestionPrompt } from '../../tools/AskUserQuestionTool/prompt.js'
import { getCompactHeadSection } from '../../constants/systemPromptCompact.js'

const LEAN_MODEL = 'claude-opus-5'

/**
 * These strings are verbatim ports from the upstream Claude Code binary
 * (@anthropic-ai/claude-code 2.1.220), not text authored here. Every line was
 * matched byte-for-byte against that binary; the handful of intentional
 * deviations are commented at their definition.
 *
 * Reword one and the model silently gets prompt text nobody validated. The
 * digests below exist to make that impossible to do by accident: a failure
 * here is not a stale-snapshot annoyance, it means someone edited a ported
 * string. The fix is to re-verify the new wording against upstream and only
 * then update the digest — never the other way around.
 */
const PORTED_DIGESTS: Record<string, string> = {
  PRONOUNS_SECTION: '3fcd2b200896a716',
  ACT_DONT_REDERIVE_SECTION: '4e4e48fb23ceb764',
  CONTEXT_MANAGEMENT_SECTION: '9856a95edb9c2bdb',
  DELIVERING_WORK_SECTION: '7e908e68a04f6843',
  CORRECTIONS_SECTION: '4593459b100aad5e',
  'WebFetch.LEAN_DESCRIPTION': '7db6b3cae057d3c9',
  'TodoWrite lean': '863d3a2d90b3c43e',
  'Glob lean': '33fb1e4be95ad7cf',
  'Grep lean': 'dde2d0b4701de45b',
  'Write lean': 'c5d31bd0010938b8',
  'Edit lean': '2eaaa8e08e0b58bc',
}

function digest(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 16)
}

describe('ported lean prompt text is not edited by accident', () => {
  const subjects: Record<string, string> = {
    PRONOUNS_SECTION,
    ACT_DONT_REDERIVE_SECTION,
    CONTEXT_MANAGEMENT_SECTION,
    DELIVERING_WORK_SECTION,
    CORRECTIONS_SECTION,
    'WebFetch.LEAN_DESCRIPTION': WEB_FETCH_LEAN_DESCRIPTION,
    'TodoWrite lean': getTodoWritePrompt(LEAN_MODEL),
    'Glob lean': getGlobDescription(LEAN_MODEL),
    'Grep lean': getGrepDescription(LEAN_MODEL),
    'Write lean': getWriteToolDescription(LEAN_MODEL),
    'Edit lean': getEditToolDescription(LEAN_MODEL),
  }

  for (const [name, expected] of Object.entries(PORTED_DIGESTS)) {
    test(`${name} matches its upstream port`, () => {
      expect(subjects[name]).toBeDefined()
      expect(digest(subjects[name] as string)).toBe(expected)
    })
  }

  test('every pinned digest has a subject and vice versa', () => {
    expect(Object.keys(subjects).sort()).toEqual(
      Object.keys(PORTED_DIGESTS).sort(),
    )
  })
})

/**
 * The remaining lean descriptions interpolate runtime values (timeouts, the
 * current month, tool names, the agent list), so a whole-string digest would
 * fail for reasons that have nothing to do with the port. Pin the sentences
 * that carry no interpolation instead — these were verified verbatim.
 */
describe('ported lean text inside interpolated descriptions', () => {
  test('Bash keeps its upstream sentences', () => {
    const bash = getBashPrompt(LEAN_MODEL)
    expect(bash).toStartWith(
      'Executes a bash command and returns its output.',
    )
    expect(bash).toContain(
      "- Working directory persists between calls, but prefer absolute paths — `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.",
    )
    expect(bash).toContain(
      '- Command output is displayed to you, not reliably to the user.',
    )
    // Upstream's lean git block drops the safety protocol rather than
    // compressing it; these three lines are the whole of it.
    expect(bash).toContain(
      '- Interactive flags (`-i`, e.g. `git rebase -i`, `git add -i`) are not supported in this environment.',
    )
    expect(bash).toContain(
      '- Use the `gh` CLI for GitHub operations (PRs, issues, API).',
    )
    expect(bash).toContain(
      '- Commit or push only when the user asks. If on the default branch, branch first.',
    )
  })

  test('WebSearch keeps its upstream sentences', () => {
    const search = getWebSearchPrompt(LEAN_MODEL)
    expect(search).toStartWith(
      'Search the web. Returns result blocks with titles and URLs. US-only.',
    )
    expect(search).toContain(
      '- `allowed_domains` / `blocked_domains` filter results.',
    )
    expect(search).toContain(
      '- After answering from results, end with a "Sources:" list of the URLs you used as markdown links.',
    )
  })

  // The only inverse case: upstream's lean variant ADDS a paragraph rather
  // than shortening the description.
  test('AskUserQuestion lean adds the blocking-decisions paragraph', () => {
    const lean = getAskUserQuestionPrompt(LEAN_MODEL)
    const verbose = getAskUserQuestionPrompt('claude-opus-4-5')
    expect(lean.length).toBeGreaterThan(verbose.length)
    expect(lean).toContain(
      "Reserve this for decisions where the user's answer changes what you do next — not for choices with a conventional default or facts you can verify in the codebase yourself.",
    )
    expect(verbose).not.toContain('Reserve this for decisions')
  })

  test('the compact head keeps its upstream Harness block', () => {
    const head = getCompactHeadSection(false)
    expect(head).toContain(
      '# Harness\n - Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.',
    )
    expect(head).toContain(
      "- Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.",
    )
    // Upstream's lean Harness block ends here. Anything appended below this
    // line is a local addition and needs the same provenance check as the rest.
    expect(head).toContain(
      " - Reference code as `file_path:line_number` — it's clickable.",
    )
    expect(head).toEndWith(
      'when something is done and verified, state it plainly without hedging.',
    )
  })
})
