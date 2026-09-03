import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildPortedSubjects,
  PORTED_DIGESTS,
  PROVIDER_ENV_KEYS,
} from './portedPromptRegistry.js'
import { getActionCautionSection, getCompactHeadSection } from '../../constants/systemPromptCompact.js'
import { getSimplePrompt as getBashPrompt } from '../../tools/BashTool/prompt.js'
import { getWebSearchPrompt } from '../../tools/WebSearchTool/prompt.js'
import { getAskUserQuestionPrompt } from '../../tools/AskUserQuestionTool/prompt.js'

// Bash's git block resolves commit attribution, which walks through model
// defaults into auth. Tests here are self-contained (no preload), so seed a
// key first.
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'

// PROVIDER_ENV_KEYS and the subject/digest tables live in the registry so that
// `verify:ports` checks exactly what this file pins — see the note there.
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

const LEAN_MODEL = 'claude-opus-5'

/**
 * Lean-trained, but without the prompt bundle — upstream declares
 * `opus_5_prompt_bundle` for Opus 5 alone, so Fable 5 takes the other branch of
 * every gate that reads it.
 */
const UNBUNDLED_MODEL = 'claude-fable-5'

function digest(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 16)
}

describe('ported lean prompt text is not edited by accident', () => {
  for (const [name, expected] of Object.entries(PORTED_DIGESTS)) {
    test(`${name} matches its upstream port`, () => {
      const subjects = buildPortedSubjects()
      expect(subjects[name]).toBeDefined()
      expect(digest(subjects[name] as string)).toBe(expected)
    })
  }

  test('every pinned digest has a subject and vice versa', () => {
    expect(Object.keys(buildPortedSubjects()).sort()).toEqual(
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
