/**
 * The single registry of ported prompt strings: for each one, how to render it
 * and the digest it must hash to.
 *
 * Two things check these ports, and they used to keep separate lists:
 * `leanPromptPortIntegrity.test.ts` hashes each string, and `verify:ports`
 * byte-diffs it against an upstream binary. Only the first is enforced (a test
 * goes red); registering with the second was a manual step guarded by a comment.
 * So a port could be digest-pinned and never actually verified — which is what
 * happened, and is why six transcription errors in `anti_verbosity` and
 * `AUTONOMY_SECTION` survived behind green digests. A digest hashes whatever
 * shipped; only the binary knows whether that was right.
 *
 * With one list, adding an entry here reaches both checks and the drift is gone
 * by construction.
 *
 * What this still does NOT catch: a port that is never registered at all. The
 * PowerShell description sat unregistered in both lists for exactly that reason.
 * Nothing can detect "this string was copied from upstream" automatically — when
 * you port text, add it here.
 *
 * Lives under src/test/ because it is verification-only: the bundle entrypoint
 * never reaches it, so it is tree-shaken out of dist/.
 */
import {
  ACT_DONT_REDERIVE_SECTION,
  AUTONOMY_SECTION,
  CONTEXT_MANAGEMENT_SECTION,
  CORRECTIONS_SECTION,
  DELIVERING_WORK_SECTION,
  PRONOUNS_SECTION,
} from '../../constants/systemPromptCoreSections.js'
import {
  getAntiVerbositySection,
  MATCH_SURROUNDING_CODE_SECTION,
  TURN_UPDATES_SECTION,
} from '../../constants/systemPromptCompact.js'
import { getDescription as getGlobDescription } from '../../tools/GlobTool/prompt.js'
import { getDescription as getGrepDescription } from '../../tools/GrepTool/prompt.js'
import { getEditToolDescription } from '../../tools/FileEditTool/prompt.js'
import { getWriteToolDescription } from '../../tools/FileWriteTool/prompt.js'
import { getTodoWritePrompt } from '../../tools/TodoWriteTool/prompt.js'
import { LEAN_DESCRIPTION as WEB_FETCH_LEAN_DESCRIPTION } from '../../tools/WebFetchTool/prompt.js'
import {
  getBackgroundUsageNote as getPowerShellBackgroundNote,
  getEditionSection as getPowerShellEditionSection,
  getSleepGuidance as getPowerShellSleepGuidance,
  renderPrompt as renderPowerShellPrompt,
} from '../../tools/PowerShellTool/prompt.js'

/**
 * The lean/verbose gate judges provider identity from the environment
 * (isUntrustedModelIdentity), so an ambient ANTHROPIC_BASE_URL or
 * CLAUDE_CODE_USE_* from a dev shell routes every gate below to the verbose
 * branch and renders the wrong strings. Both callers scrub these first.
 */
export const PROVIDER_ENV_KEYS = [
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

const LEAN_MODEL = 'claude-opus-5'

/**
 * Lean-trained, but without the prompt bundle — upstream declares
 * `opus_5_prompt_bundle` for Opus 5 alone, so Fable 5 takes the other branch of
 * every gate that reads it.
 */
const UNBUNDLED_MODEL = 'claude-fable-5'

function withPreReadRequired(render: () => string): string {
  process.env.NOA_CLAUDE_WRITE_REQUIRE_READ = '1'
  try {
    return render()
  } finally {
    delete process.env.NOA_CLAUDE_WRITE_REQUIRE_READ
  }
}

/**
 * Rendered lazily, never at module scope: the tool descriptions resolve through
 * the lean/verbose gate, and a module-scope construction would judge provider
 * identity on whatever env happened to be set at import time — before either
 * caller has scrubbed it.
 */
export function buildPortedSubjects(): Record<string, string> {
  return {
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
  }
}

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
 * The same two later turned out to have had upstream's commas, colons and one
 * parenthetical restyled into em-dash asides, likewise certified. Diff against
 * the binary, not just against what is already in the file.
 *
 * `bun run verify:ports` does that diff against a real binary when one is on
 * the machine. Run it when adding a port or bumping the reference version; a
 * digest alone cannot tell a faithful transcription from a confident wrong one.
 */
export const PORTED_DIGESTS: Record<string, string> = {
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
