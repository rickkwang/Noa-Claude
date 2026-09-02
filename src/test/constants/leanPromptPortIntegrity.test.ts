import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// Bash's git block resolves commit attribution, which walks through model
// defaults into auth. Tests here are self-contained (no preload), so seed a
// key first.
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'

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
  'NOA_CLAUDE_WRITE_REQUIRE_READ',
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

import {
  ACT_DONT_REDERIVE_SECTION,
  AUTONOMY_SECTION,
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
import {
  getBackgroundUsageNote as getPowerShellBackgroundNote,
  getEditionSection as getPowerShellEditionSection,
  getSleepGuidance as getPowerShellSleepGuidance,
  renderPrompt as renderPowerShellPrompt,
} from '../../tools/PowerShellTool/prompt.js'
import { getAskUserQuestionPrompt } from '../../tools/AskUserQuestionTool/prompt.js'
import {
  getActionCautionSection,
  getAntiVerbositySection,
  getCompactHeadSection,
  MATCH_SURROUNDING_CODE_SECTION,
  TURN_UPDATES_SECTION,
} from '../../constants/systemPromptCompact.js'

const LEAN_MODEL = 'claude-opus-5'

/**
 * Lean-trained, but without the prompt bundle — upstream declares
 * `opus_5_prompt_bundle` for Opus 5 alone, so Fable 5 takes the other branch of
 * every gate that reads it.
 */
const UNBUNDLED_MODEL = 'claude-fable-5'

/**
 * These strings are verbatim ports from the upstream Claude Code binary
 * (@anthropic-ai/claude-code 2.1.220 unless noted), not text authored here.
 * Every line was matched byte-for-byte against that binary; the handful of
 * intentional deviations are commented at their definition.
 *
 * AUTONOMY_SECTION was matched against 2.1.226 instead — it postdates the
 * 2.1.220 sweep. Its prompt text is identical in 2.1.223: the whole assembly
 * module was diffed line-by-line between the two builds and every difference
 * was minifier renaming, not prompt wording.
 *
 * Reword one and the model silently gets prompt text nobody validated. The
 * digests below exist to make that impossible to do by accident: a failure
 * here is not a stale-snapshot annoyance, it means someone edited a ported
 * string. The fix is to re-verify the new wording against upstream and only
 * then update the digest — never the other way around.
 *
 * "Byte-for-byte" includes whitespace. AUTONOMY_SECTION and the anti_verbosity
 * fable branch both shipped once with their blank-line paragraph breaks
 * collapsed to single newlines, and both digests were computed from the
 * collapsed text — so the pins certified the deviation instead of catching it.
 * Diff whitespace against the binary, not just words, and pin the digest to
 * what upstream ships rather than to what is already in the file.
 *
 * `bun run verify:ports` does that diff against a real binary when one is on
 * the machine. Run it when adding a port or bumping the reference version; a
 * digest alone cannot tell a faithful transcription from a confident wrong one.
 */
const PORTED_DIGESTS: Record<string, string> = {
  PRONOUNS_SECTION: '3fcd2b200896a716',
  ACT_DONT_REDERIVE_SECTION: '4e4e48fb23ceb764',
  CONTEXT_MANAGEMENT_SECTION: '9856a95edb9c2bdb',
  MATCH_SURROUNDING_CODE_SECTION: 'ee43af37398581e9',
  'anti_verbosity fable branch': '1ffd574f62004f0b',
  // The branch checked ahead of the fable one; Fable 5.1 / Mythos 5.1 get this
  // instead of the long section.
  TURN_UPDATES_SECTION: 'f73794d3e72b5616',
  DELIVERING_WORK_SECTION: '7e908e68a04f6843',
  CORRECTIONS_SECTION: '4593459b100aad5e',
  AUTONOMY_SECTION: '07f554da420e0445',
  'WebFetch.LEAN_DESCRIPTION': '7db6b3cae057d3c9',
  'TodoWrite lean': '863d3a2d90b3c43e',
  'Glob lean': '33fb1e4be95ad7cf',
  'Grep lean': 'dde2d0b4701de45b',
  'Write lean': 'c5d31bd0010938b8',
  'Edit lean': '2eaaa8e08e0b58bc',
  // 2.1.228 drops the pre-read line for models allowed to overwrite an unread
  // file. Both variants are pinned: the skip is a second ported branch, not a
  // replacement for the one above.
  'Write lean (pre-read skipped)': 'db96dfd3a76a57ab',
  'Edit lean (pre-read skipped)': '5f160e3e9fb9ef6e',
  // Upstream ships one tier for PowerShell — there is no lean branch to pin, so
  // the single description is the port. Refreshed against 2.1.258; the earlier
  // transcription predated it and had drifted (a wrong 5.1 encoding default, a
  // missing Unix-equivalents section, a locally added sleep duration).
  'PowerShell edition (desktop)': 'b84252846b69ab41',
  'PowerShell edition (core)': 'b911baef6ada701e',
  'PowerShell edition (unknown)': '029e116530be9302',
  'PowerShell description': '770183cff1c206af',
}

function withPreReadRequired<T>(render: () => T): T {
  process.env.NOA_CLAUDE_WRITE_REQUIRE_READ = '1'
  try {
    return render()
  } finally {
    delete process.env.NOA_CLAUDE_WRITE_REQUIRE_READ
  }
}

function digest(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 16)
}

describe('ported lean prompt text is not edited by accident', () => {
  // Built lazily inside each test: the tool descriptions resolve through the
  // lean/verbose gate, and describe callbacks run before beforeEach, so a
  // module-scope construction would judge provider identity on ambient env.
  const buildSubjects = (): Record<string, string> => ({
    PRONOUNS_SECTION,
    ACT_DONT_REDERIVE_SECTION,
    CONTEXT_MANAGEMENT_SECTION,
    MATCH_SURROUNDING_CODE_SECTION,
    'anti_verbosity fable branch': getAntiVerbositySection(
      UNBUNDLED_MODEL,
    ) as string,
    TURN_UPDATES_SECTION,
    DELIVERING_WORK_SECTION,
    CORRECTIONS_SECTION,
    AUTONOMY_SECTION,
    'WebFetch.LEAN_DESCRIPTION': WEB_FETCH_LEAN_DESCRIPTION,
    'TodoWrite lean': getTodoWritePrompt(LEAN_MODEL),
    'Glob lean': getGlobDescription(LEAN_MODEL),
    'Grep lean': getGrepDescription(LEAN_MODEL),
    'Write lean': withPreReadRequired(() =>
      getWriteToolDescription(LEAN_MODEL),
    ),
    'Edit lean': withPreReadRequired(() => getEditToolDescription(LEAN_MODEL)),
    'Write lean (pre-read skipped)': getWriteToolDescription(LEAN_MODEL),
    'Edit lean (pre-read skipped)': getEditToolDescription(LEAN_MODEL),
    'PowerShell edition (desktop)': getPowerShellEditionSection('desktop'),
    'PowerShell edition (core)': getPowerShellEditionSection('core'),
    'PowerShell edition (unknown)': getPowerShellEditionSection(null),
    // Rendered at the unknown edition: getPrompt()'s probe returns null off
    // Windows, and the edition text is pinned separately above.
    'PowerShell description': renderPowerShellPrompt(
      null,
      getPowerShellBackgroundNote(),
      getPowerShellSleepGuidance(),
    ),
  })

  for (const [name, expected] of Object.entries(PORTED_DIGESTS)) {
    test(`${name} matches its upstream port`, () => {
      const subjects = buildSubjects()
      expect(subjects[name]).toBeDefined()
      expect(digest(subjects[name] as string)).toBe(expected)
    })
  }

  test('every pinned digest has a subject and vice versa', () => {
    expect(Object.keys(buildSubjects()).sort()).toEqual(
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

  // Upstream promoted this bullet from opus_5_prompt_bundle-gated (2.1.222) to
  // unconditional on the lean prompt (2.1.224) — assert it survives even for a
  // lean model that does NOT carry the bundle, so a regression back to the old
  // gate would fail here.
  test('Bash output-visibility bullet is unconditional on the lean prompt', () => {
    const unbundled = getBashPrompt(UNBUNDLED_MODEL)
    expect(unbundled).toContain(
      '- Command output is displayed to you, not reliably to the user.',
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
    // Upstream separates these with blank lines. The Noa identity sentence
    // ahead of them is this fork's one addition to the block.
    expect(head).toStartWith('\nYou are Noa Claude,')
    expect(head).toContain(
      'You are an interactive agent that helps users with software engineering tasks.\n\nIMPORTANT: Assist with authorized security testing',
    )
    expect(head).toContain('defensive use cases.\n\n# Harness')
    expect(head).toContain(
      "- Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.",
    )
    // Upstream's lean head ends with this bullet. Anything appended past it is
    // a local addition and needs the same provenance check as the rest.
    expect(head).toEndWith(
      " - Reference code as `file_path:line_number` — it's clickable.",
    )
  })

  test('action caution keeps its upstream sentences in both bundle states', () => {
    const withBundle = getActionCautionSection(LEAN_MODEL)
    expect(withBundle).toStartWith(
      'For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking; approval in one context doesn\'t extend to the next.',
    )
    expect(withBundle).toContain(
      'Sending content to an external service publishes it; it may be cached or indexed even if later deleted. Before deleting or overwriting, look at the target. Report outcomes faithfully:',
    )
    expect(withBundle).toEndWith(
      'when something is done and verified, state it plainly without hedging.',
    )

    // The clause upstream adds for lean models that lack the prompt bundle.
    const withoutBundle = getActionCautionSection(UNBUNDLED_MODEL)
    expect(withoutBundle).toContain(
      "Before deleting or overwriting, look at the target — if what you find contradicts how it was described, or you didn't create it, surface that instead of proceeding. Report outcomes faithfully:",
    )
  })
})
