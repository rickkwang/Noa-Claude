import { join } from 'path'
import type { ToolUseContext } from '../../Tool.js'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { EFFORT_LEVELS, isEffortLevel } from '../../utils/effort.js'
import { registerBundledSkill } from '../bundledSkills.js'

type ReviewEffort = (typeof EFFORT_LEVELS)[number]

// Default finding caps per effort level; `--max-findings` overrides them.
const DEFAULT_MAX_FINDINGS: Record<ReviewEffort, number> = {
  low: 4,
  medium: 8,
  high: 10,
  xhigh: 15,
  max: 15,
}
const DEFAULT_EFFORT: ReviewEffort = 'medium'

type MaxFindingsFlag = number | 'all' | 'default'
type ParsedArgs = {
  ultra: boolean
  explicitEffort?: ReviewEffort
  unrecognizedEffort?: string
  maxFindings?: MaxFindingsFlag
  maxFindingsIgnored: boolean
  fix: boolean
  comment: boolean
  target: string
}

// Same prefix rule as upstream: a leading word that starts with a level name
// is read as an effort, even when it is not a valid level.
const EFFORT_WORD = /^(low|med|hig|xhi|max)[a-z]*$/i

function parseCodeReviewArgs(raw: string): ParsedArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const parsed: ParsedArgs = { ultra: false, maxFindingsIgnored: false, fix: false, comment: false, target: '' }
  if (tokens[0]?.toLowerCase() === 'ultra') {
    parsed.ultra = true
    tokens.shift()
  }
  const first = tokens[0]
  if (first !== undefined && EFFORT_WORD.test(first)) {
    tokens.shift()
    const level = first.toLowerCase()
    if (isEffortLevel(level)) {
      parsed.explicitEffort = level as ReviewEffort
    } else {
      parsed.unrecognizedEffort = first
    }
  }
  const rest: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === '--fix') {
      parsed.fix = true
    } else if (token === '--comment') {
      parsed.comment = true
    } else if (token === '--max-findings' || token.startsWith('--max-findings=')) {
      const next = tokens[i + 1]
      const value = token.includes('=')
        ? token.slice(token.indexOf('=') + 1)
        : next !== undefined && !next.startsWith('--') ? tokens[++i] : undefined
      if (value === 'all' || value === 'default') {
        parsed.maxFindings = value
      } else if (value !== undefined && /^[1-9]\d*$/.test(value)) {
        parsed.maxFindings = Number(value)
      } else {
        parsed.maxFindingsIgnored = true
      }
    } else {
      rest.push(token)
    }
  }
  parsed.target = rest.join(' ')
  return parsed
}

const ANGLE_LINE_SCAN = `### Angle A — line-by-line diff scan
Read every hunk in the diff, line by line. Then read the enclosing function for each hunk: bugs in unchanged lines of a touched function are in scope, because the change may re-expose or fail to fix them. For every line ask what input, state, timing, or platform makes it wrong: inverted or wrong conditions, off-by-one, null/undefined dereference, missing \`await\`, falsy-zero checks, wrong-variable copy-paste, errors swallowed in a catch, unescaped regex metacharacters.`

const ANGLE_REMOVED_BEHAVIOR = `### Angle B — removed-behavior auditor
For every line the diff deletes or replaces, name the invariant or behavior it enforced, then search the new code for where that invariant is re-established. If you cannot find it, that is a candidate: a removed guard, a dropped error path, a narrowed validation, a deleted test covering a real case.`

const ANGLE_CROSS_FILE = `### Angle C — cross-file tracer
For each function the diff changes, find its callers (Grep for the symbol) and check whether the change breaks a call site: a new precondition, a changed return shape, a new exception, a timing or ordering dependency. Also check callees: does a parallel change in the same diff make a call unsafe?`

const ANGLE_PITFALLS = `### Angle D — language-pitfall specialist
Scan for the classic pitfalls of the diff's language and framework: JS falsy-zero, \`==\` coercion, closure-captured loop variables; Python mutable default arguments and late-binding closures; Go nil-map writes and range-variable capture; SQL injection; timezone and DST drift; float equality. Flag any instance the diff introduces.`

const ANGLE_WRAPPER = `### Angle E — wrapper/proxy correctness
When the diff adds or modifies a type that wraps another (cache, proxy, decorator, adapter), check that every method routes to the wrapped instance and not back through a registry, session, or global. A caching provider that resolves IDs via \`session.get(...)\` instead of \`delegate.get(...)\` re-enters the cache or recurses. Also check that the wrapper forwards every method its callers use.`

const ANGLE_REUSE = `### Reuse
Flag new code that re-implements something the codebase already has. Grep shared and utility modules and files adjacent to the change, and name the existing helper to call instead.`

const ANGLE_SIMPLIFICATION = `### Simplification
Flag unnecessary complexity the diff adds: redundant or derivable state, copy-paste with slight variation, deep nesting, dead code left behind. Name the simpler form that does the same job. Also flag long-lived objects built from closures or captured environments that keep a large enclosing scope alive; prefer a class or struct that copies only the fields it needs.`

const ANGLE_EFFICIENCY = `### Efficiency
Flag wasted work the diff introduces: redundant computation or repeated I/O, independent operations run sequentially, blocking work added to startup or hot paths, and state updates inside loops or handlers that fire unconditionally without a change guard.`

const conventionsAngle = (userRules: string) => `### Conventions (CLAUDE.md)
Find the CLAUDE.md files that govern the changed code: the user-level ${userRules}, the repo-root CLAUDE.md, and any CLAUDE.md or CLAUDE.local.md in a directory that is an ancestor of a changed file (it applies only to files at or below it). Flag a violation only when you can quote the exact rule and the exact line that breaks it. No style preferences and no "spirit of the doc" inferences. Name the CLAUDE.md path and quote the rule in the finding. If no CLAUDE.md applies, return nothing for this angle.`

const ANGLE_ALTITUDE = `### Altitude
Check that each change fixes the root cause at the right depth rather than patching a symptom with a fragile bandaid. Special cases layered on shared infrastructure are a sign the fix is not deep enough: prefer the simpler, more general change to the underlying mechanism, and name it.`

const CORRECTNESS_ANGLES = [
  ANGLE_LINE_SCAN,
  ANGLE_REMOVED_BEHAVIOR,
  ANGLE_CROSS_FILE,
  ANGLE_PITFALLS,
  ANGLE_WRAPPER,
]
const cleanupAngles = (userRules: string) => [
  ANGLE_REUSE,
  ANGLE_SIMPLIFICATION,
  ANGLE_EFFICIENCY,
  ANGLE_ALTITUDE,
  conventionsAngle(userRules),
]

const PHASE_GATHER = `## Phase 0 — Gather the diff
Get the unified diff under review:
- Default (no target): \`git diff @{upstream}...HEAD\`, plus \`git diff HEAD\` for uncommitted changes. If there is no upstream, use \`git diff main...HEAD\` or \`git diff HEAD~1\`. Include working-tree changes, since the review often runs before the commit.
- PR (number, \`#number\`, or URL): \`gh pr view <target>\` for context and \`gh pr diff <target>\` for the diff.
- Branch name: \`git diff <base>...<branch>\`.
- File path: restrict the diff to that path.
If the diff is empty, say there is nothing to review and stop.`

const TIER_TEXT: Record<ReviewEffort, string> = {
  low: 'low effort → 1 diff pass → no verify',
  medium: 'medium effort → 3+5 angles × 6 candidates → 1-vote verify',
  high: 'high effort → 3+5 angles × 6 candidates → 1-vote verify (recall-biased)',
  xhigh: 'xhigh effort → 5+5 angles × 8 candidates → 1-vote verify → sweep',
  max: 'max effort → 5+5 angles × 8 candidates → 1-vote verify → sweep',
}

const TIER_LEAD_IN: Partial<Record<ReviewEffort, string>> = {
  medium: `You are reviewing for **precision** at medium effort: every finding you surface should be one a maintainer would act on.`,
  high: `You are reviewing for **recall** at high effort: catch every real bug a careful reviewer would catch in one sitting. Catching real bugs matters more than avoiding false positives. Err on the side of surfacing.`,
  xhigh: `You are reviewing for **recall** at xhigh effort: catch every real bug a careful reviewer would catch, and do not let the first pass be the last one. Err on the side of surfacing.`,
  max: `You are reviewing exhaustively at max effort: a missed bug is worse than a false positive that a verifier later drops. Err on the side of surfacing.`,
}

function outputCap(max: number | 'all'): string {
  return max === 'all'
    ? 'every finding that survives, no maximum'
    : `at most ${max} findings`
}

function lowEffortPrompt(cap: string): string {
  return `## Review at low effort: one diff pass, no verification, no subagents
Read the diff in one tool call. Skip test and fixture hunks (\`test/\`, \`spec/\`, \`__tests__/\`, \`*_test.*\`, \`*.test.*\`, \`fixtures/\`, \`testdata/\`); test-file changes are not reviewed at this level. Do not read whole files.
Flag runtime-correctness bugs visible from the hunk alone: inverted or wrong conditions, off-by-one, null/undefined dereference where the adjacent lines show the value can be absent, removed guards, falsy-zero checks, missing \`await\`, wrong-variable copy-paste, errors swallowed in a catch that should propagate. Also flag new code that duplicates a helper visible in the diff context, and dead code the diff leaves behind.
Do not flag style, naming, performance, missing tests, or anything outside the changed lines.
Output ${cap}, most severe first, one line each: \`path/to/file.ext:123 — what's wrong and the concrete failure\`. If nothing qualifies, output exactly \`(none)\`.`
}

function finderSection(hasAgent: boolean, angleCount: number, perAngle: number): string {
  const head = `## Phase 1 — Find candidates (${angleCount} angles)`
  if (!hasAgent) {
    return `${head}
The ${AGENT_TOOL_NAME} tool is not available here, so the fan-out cannot run. Work through every angle yourself, in sequence, in this same context. Do not skip angles for lack of fan-out. Each angle surfaces up to ${perAngle} candidates with \`file\`, \`line\`, a one-line \`summary\`, and a concrete \`failure_scenario\`. Pass every candidate with a nameable failure scenario through.`
  }
  return `${head}
Run each angle as its own subagent via the ${AGENT_TOOL_NAME} tool, all in one message so they run in parallel. Give each subagent the full diff and the instructions for its angle. Each surfaces up to ${perAngle} candidates with \`file\`, \`line\`, a one-line \`summary\`, and a concrete \`failure_scenario\`. Pass every candidate with a nameable failure scenario through: finders that silently drop half-believed candidates bypass verification and are the main cause of misses.`
}

function verifySection(hasAgent: boolean, recallBiased: boolean): string {
  const dedup = `Dedup candidates that point at the same line or mechanism, keeping the one with the most concrete failure scenario.`
  const verdicts = `Return exactly one verdict:
- **CONFIRMED** — you can name the inputs or state that trigger it and the wrong output or crash. Quote the line.
- **PLAUSIBLE** — the mechanism is real but the trigger is uncertain (timing, environment, config). State what would confirm it.
- **REFUTED** — factually wrong (the code does not say that) or guarded elsewhere. Quote the line that proves it.

PLAUSIBLE is the default. Do not refute a candidate for being speculative when the state is realistic: concurrency races, nil on a rare but reachable path (error handler, cold cache, missing optional field), falsy-zero treated as missing, off-by-one on a boundary the code does not exclude, retry storms and partial failures, a regex or allowlist that lost an anchor. REFUTED only when it is constructible from the code: factually wrong, provably impossible, already handled in this diff (cite the guard), or pure style with no observable effect.`
  const bias = recallBiased ? ' Recall matters more than precision here.' : ''
  const target = hasAgent
    ? `For each remaining candidate, run one verifier via the ${AGENT_TOOL_NAME} tool and give it the diff, the relevant files, and the candidate.`
    : `The ${AGENT_TOOL_NAME} tool is not available, so verify each candidate yourself against the diff and the relevant files. Drop anything you cannot back with a concrete failure scenario.`
  return `## Phase 2 — Verify (1 vote, 3 states)
${dedup} ${target}${bias}

${verdicts}

Keep CONFIRMED and PLAUSIBLE. Drop REFUTED.`
}

const SWEEP_FOCUS = `moved or extracted code that dropped a guard or anchor; second-tier footguns (dataclass default evaluated once, \`hash()\` non-determinism, lock-scope shrink, predicate methods with side effects); setup and teardown asymmetry in tests; config defaults that were flipped.`

function sweepSection(hasAgent: boolean): string {
  const runner = hasAgent
    ? `Run one more finder as a fresh reviewer who has the verified list (via the ${AGENT_TOOL_NAME} tool, or yourself if it is unavailable).`
    : `Take one more pass yourself as a fresh reviewer who has the verified list.`
  return `## Phase 3 — Sweep for gaps
${runner} Re-read the diff and the enclosing functions looking ONLY for defects not already listed. Focus on what the first pass tends to miss: ${SWEEP_FOCUS}
Surface up to 8 additional candidates, each naming a defect not already on the list. Verify each one the same way as the candidates above before it goes into the output. If nothing new, return nothing — do not pad.`
}

function outputSection(cap: string, hasAgent: boolean): string {
  const disclosure = hasAgent
    ? ''
    : `State clearly, before the JSON, that this was a single-pass review done without the ${AGENT_TOOL_NAME} tool, not the full multi-agent fan-out.\n`
  return `## Output
${disclosure}Return ${cap} as a JSON array in a \`\`\`json block, ranked most severe first. Each entry has:
- \`file\`: repo-relative path
- \`line\`: line number
- \`summary\`: one-sentence statement of the defect
- \`short_summary\`: the claim in at most 60 characters, with no rationale
- \`failure_scenario\`: concrete inputs or state → wrong output or crash
- \`category\`: a kebab-case slug such as \`correctness\`, \`simplification\`, \`efficiency\`, \`reuse\`, \`altitude\`, \`conventions\`, or \`test-coverage\`
- \`verdict\`: CONFIRMED or PLAUSIBLE

If nothing survives verification, return \`[]\`. Correctness findings outrank cleanup, altitude, and conventions findings when the cap forces a cut.`
}

function fullPrompt(effort: ReviewEffort, cap: string, hasAgent: boolean, userRules: string): string {
  const angles =
    effort === 'xhigh' || effort === 'max'
      ? [...CORRECTNESS_ANGLES, ...cleanupAngles(userRules)]
      : [ANGLE_LINE_SCAN, ANGLE_REMOVED_BEHAVIOR, ANGLE_CROSS_FILE, ...cleanupAngles(userRules).slice(0, 3), ANGLE_ALTITUDE, conventionsAngle(userRules)]
  const sweep = effort === 'xhigh' || effort === 'max'
  return [
    TIER_LEAD_IN[effort],
    PHASE_GATHER,
    finderSection(hasAgent, angles.length, effort === 'xhigh' || effort === 'max' ? 8 : 6),
    angles.join('\n\n'),
    verifySection(hasAgent, effort === 'high' || effort === 'xhigh' || effort === 'max'),
    sweep ? sweepSection(hasAgent) : undefined,
    outputSection(cap, hasAgent),
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Accepts `123`, `#123`, or a GitHub pull request URL.
function parsePrNumber(target: string): string | undefined {
  const match = target.match(/^#?(\d+)$/) ?? target.match(/\/pull\/(\d+)(?:[/?#]|$)/)
  return match?.[1]
}

function actionSections(args: ParsedArgs, hasPr: boolean, effort: ReviewEffort): string {
  const sections: string[] = []
  if (args.fix) {
    // --fix edits the working tree, so it only runs on the local changes that are checked out.
    sections.push(
      args.target !== ''
        ? `## After the review: --fix
--fix only applies to the local changes. Target \`${args.target}\` is not checked out here, so change no files and say so.`
        : `## After the review: --fix
Apply a fix for ${effort === 'low' ? 'each finding (low effort does not verify findings)' : 'each CONFIRMED finding'} in the working tree with the file-edit tools${effort === 'low' ? '' : '; leave PLAUSIBLE findings unfixed and list them'}. Make the smallest change that fixes the stated failure and do not touch unrelated code. Afterwards, report which findings you fixed and which you skipped and why.`,
    )
  }
  if (args.comment) {
    sections.push(
      hasPr
        ? `## After the review: --comment
Post each surviving finding with \`gh api\`: as an inline review comment when its line is part of the PR diff, otherwise as a single PR comment that names the file and line. Post only the findings from this review.`
        : `## After the review: --comment
--comment needs a PR target. Do not post anything; say that comments require a PR number.`,
    )
  }
  return sections.join('\n\n')
}

function buildCodeReviewPrompt(
  args: ParsedArgs,
  context: { effort: ReviewEffort; cap: string; reused: boolean; capSource: CapSource; storedMax?: number | 'all'; hasAgent: boolean; userRules: string },
): string {
  const hasPr = parsePrNumber(args.target) !== undefined
  const notices: string[] = []
  if (args.unrecognizedEffort !== undefined) {
    notices.push(`Ignoring unrecognized effort "${args.unrecognizedEffort}"; valid: ${EFFORT_LEVELS.join(', ')}.`)
  }
  if (args.maxFindingsIgnored) {
    notices.push(`\`--max-findings\` was ignored: type a whole number above zero, \`all\`, or \`default\` after it.${context.capSource === 'stored' ? '' : ' Using the usual limit.'}`)
  }
  if (context.capSource === 'stored' && context.storedMax !== undefined) {
    notices.push(`You set \`--max-findings ${context.storedMax}\` last time. Pass \`--max-findings default\` to go back to the usual limit.`)
  }
  const header = [
    `You are an expert code reviewer. Review ${args.target ? `the target \`${args.target}\`` : 'the local changes'} for correctness bugs and cleanups.`,
    `Effort: ${context.effort}${context.reused ? ' (reused from the level you typed last time; type a level like `/code-review high` to change it)' : ''} — ${TIER_TEXT[context.effort]}.`,
    ...notices,
  ].join('\n')
  const body =
    context.effort === 'low'
      ? [PHASE_GATHER, lowEffortPrompt(context.cap)].join('\n\n')
      : fullPrompt(context.effort, context.cap, context.hasAgent, context.userRules)
  return [header, body, actionSections(args, hasPr, context.effort)].filter(Boolean).join('\n\n')
}

function resolveEffort(args: ParsedArgs): { effort: ReviewEffort; reused: boolean } {
  if (args.explicitEffort) return { effort: args.explicitEffort, reused: false }
  // Config is hand-editable, so a stored value must pass the same check as typed input.
  const last = getGlobalConfig().codeReviewLastEffort
  return last !== undefined && isEffortLevel(last) ? { effort: last, reused: true } : { effort: DEFAULT_EFFORT, reused: false }
}

type CapSource = 'flag' | 'stored' | 'default'

function resolveCap(args: ParsedArgs, effort: ReviewEffort): { cap: string; source: CapSource; storedMax?: number | 'all' } {
  const flag = args.maxFindings
  const stored = getGlobalConfig().codeReviewLastMaxFindings
  const storedMax = stored === 'all' || (typeof stored === 'number' && Number.isSafeInteger(stored) && stored > 0) ? stored : undefined
  if (flag === 'default') return { cap: outputCap(DEFAULT_MAX_FINDINGS[effort]), source: 'default' }
  if (flag !== undefined) return { cap: outputCap(flag), source: 'flag' }
  if (storedMax !== undefined) return { cap: outputCap(storedMax), source: 'stored', storedMax }
  return { cap: outputCap(DEFAULT_MAX_FINDINGS[effort]), source: 'default' }
}

const ULTRA_UNSUPPORTED = `\`/code-review ultra\` runs a cloud multi-agent review, which Noa does not support. Tell the user to run \`/code-review\` or \`/code-review <low|medium|high|xhigh|max>\` instead, and do not review anything.`

function persistArgs(args: ParsedArgs): void {
  if (args.explicitEffort) {
    const effort = args.explicitEffort
    saveGlobalConfig(c => (c.codeReviewLastEffort === effort ? c : { ...c, codeReviewLastEffort: effort }))
  }
  if (args.maxFindings !== undefined) {
    const value = args.maxFindings === 'default' ? undefined : args.maxFindings
    saveGlobalConfig(c => (c.codeReviewLastMaxFindings === value ? c : { ...c, codeReviewLastMaxFindings: value }))
  }
}

export function registerCodeReviewSkill(): void {
  registerBundledSkill({
    name: 'code-review',
    aliases: ['review'],
    description: 'Review the current diff or a PR for bugs and cleanups',
    argumentHint:
      '[low|medium|high|xhigh|max] [--fix] [--comment] [--max-findings <n|all|default>] [pr# | branch | path]',
    context: 'fork',
    // --fix and --comment write to the working tree and GitHub; only the user may start a review.
    disableModelInvocation: true,
    async getPromptForCommand(raw: string, context: ToolUseContext) {
      const args = parseCodeReviewArgs(raw)
      if (args.ultra) return [{ type: 'text', text: ULTRA_UNSUPPORTED }]
      persistArgs(args)
      const { effort, reused } = resolveEffort(args)
      const hasAgent = (context?.options?.tools ?? []).some(
        tool => tool.name === AGENT_TOOL_NAME,
      )
      const cap = resolveCap(args, effort)
      const prompt = buildCodeReviewPrompt(args, {
        effort,
        cap: cap.cap,
        capSource: cap.source,
        storedMax: cap.storedMax,
        reused,
        hasAgent,
        userRules: join(getClaudeConfigHomeDir(), 'CLAUDE.md'),
      })
      return [{ type: 'text', text: prompt }]
    },
  })
}
