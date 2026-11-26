import { realpath } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { ToolUseContext } from '../../Tool.js'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { REPORT_FINDINGS_TOOL_NAME } from '../../tools/ReportFindingsTool/ReportFindingsTool.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { getPrintOutputFormat } from '../../bootstrap/state.js'
import { detectCurrentRepositoryWithHost, getCachedRepositoryHost } from '../../utils/detectRepository.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import {
  EFFORT_LEVELS,
  clampEffortToSupportedLevels,
  convertEffortValueToLevel,
  getSupportedEffortLevelsForModel,
  isEffortLevel,
  resolveAppliedEffort,
} from '../../utils/effort.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { gitExe } from '../../utils/git.js'
import { getCanonicalName } from '../../utils/model/model.js'
import { plural } from '../../utils/stringUtils.js'
import { registerBundledSkill } from '../bundledSkills.js'

type ReviewEffort = (typeof EFFORT_LEVELS)[number]

type MaxFindingsFlag = number | 'all' | 'default'
type ParsedArgs = {
  ultra: boolean
  explicitEffort?: ReviewEffort
  maxFindings?: MaxFindingsFlag
  maxFindingsIgnored: boolean
  fix: boolean
  comment: boolean
  post: boolean
  target: string
}

function parseCodeReviewArgs(raw: string): ParsedArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const parsed: ParsedArgs = { ultra: false, maxFindingsIgnored: false, fix: false, comment: false, post: false, target: '' }
  if (tokens[0]?.toLowerCase() === 'ultra') {
    parsed.ultra = true
    tokens.shift()
  }
  const first = tokens[0]
  if (!parsed.ultra && first !== undefined && isEffortLevel(first.toLowerCase())) {
    tokens.shift()
    parsed.explicitEffort = first.toLowerCase() as ReviewEffort
  }
  const rest: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === '--fix') {
      parsed.fix = true
    } else if (token === '--comment') {
      parsed.comment = true
    } else if (token === '--post') {
      parsed.post = true
    } else if (token === '--no-post') {
      // --post and --no-post only steer the cloud review, which is not available here.
    } else if (token === '--max-findings' || token.startsWith('--max-findings=')) {
      const next = tokens[i + 1]
      const value = (token.includes('=')
        ? token.slice(token.indexOf('=') + 1)
        : next !== undefined && !next.startsWith('--') ? tokens[++i] : undefined)?.toLowerCase()
      if (value === 'all' || value === 'default') {
        parsed.maxFindings = value
      } else if (value !== undefined && /^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value))) {
        parsed.maxFindings = Number(value)
      } else {
        parsed.maxFindingsIgnored = true
      }
    } else {
      rest.push(token)
    }
  }
  // A pasted target may carry backticks or a leading `#` (`#123`).
  if (rest[0] !== undefined) rest[0] = rest[0].replaceAll('`', '').replace(/^#/, '')
  parsed.target = rest.filter(Boolean).join(' ')
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
The angles above hunt for bugs; this one and the next two hunt for cleanup in the changed code. Flag new code that re-implements something the codebase already has. Grep shared and utility modules and files adjacent to the change, and name the existing helper to call instead.`

const ANGLE_SIMPLIFICATION = `### Simplification
Flag unnecessary complexity the diff adds: redundant or derivable state, copy-paste with slight variation, deep nesting, dead code left behind. Name the simpler form that does the same job.`

const ANGLE_EFFICIENCY = `### Efficiency
Flag wasted work the diff introduces: redundant computation or repeated I/O, independent operations run sequentially, blocking work added to startup or hot paths. Also flag long-lived objects built from closures or captured environments, which keep the whole enclosing scope alive; prefer a class or struct that copies only the fields it needs. Name the cheaper alternative.`

const ANGLE_ALTITUDE = `### Altitude
Check that each change fixes the root cause at the right depth rather than patching a symptom with a fragile bandaid. Special cases layered on shared infrastructure are a sign the fix is not deep enough: prefer the simpler, more general change to the underlying mechanism, and name it.`

const CONVENTIONS_RULE = `Flag a violation only when you can quote the exact rule and the exact line that breaks it. No style preferences and no "spirit of the doc" inferences. Name the CLAUDE.md path and quote the rule in the finding. If no CLAUDE.md applies, return nothing for this angle.`

const conventionsAngle = (userRules: string) => `### Conventions (CLAUDE.md)
Find the CLAUDE.md files that govern the changed code: the user-level ${userRules}, the repo-root CLAUDE.md, and any CLAUDE.md or CLAUDE.local.md in a directory that is an ancestor of a changed file (it applies only to files at or below it). ${CONVENTIONS_RULE}`

// The bugs-* recipes take the user-level file from context so the reviewer never reads outside the repo.
const contextConventionsAngle = (userRules: string) => `### Conventions (CLAUDE.md)
Find the CLAUDE.md files that govern the changed code: the repo-root CLAUDE.md, and any CLAUDE.md or CLAUDE.local.md in a directory that is an ancestor of a changed file (it applies only to files at or below it). Search for them in a command of its own, not on the \`git diff\` line, with every pattern quoted. Read each one that exists. The user-level ${userRules} governs too, but take it only from your context, where the session puts it if it exists: if it is not shown there, skip it, and never search for it, list it, or read it. Then check the diff for clear violations of the rules these files state.
${CONVENTIONS_RULE}`

const CLEANUP_SHAPE = `Cleanup, altitude, and conventions candidates use the same \`file\`/\`line\`/\`summary\` shape; in \`failure_scenario\`, state the concrete cost (what is duplicated, wasted, harder to maintain, or which CLAUDE.md rule is broken) instead of a crash. Correctness bugs always outrank cleanup, altitude, and conventions findings when the output cap forces a cut.`

const conventionsShape = (whose: string) => `Conventions candidates use ${whose} \`file\`/\`line\`/\`summary\` shape; in \`failure_scenario\`, state which CLAUDE.md rule is broken instead of a crash. Correctness bugs always outrank conventions findings when the output cap forces a cut.`

const PASS_THROUGH = `Pass every candidate with a nameable failure scenario through: finders that silently drop half-believed candidates are the main cause of misses.`

const NO_SUPPRESSION = `Do not let one angle's conclusions suppress another's: if two angles flag the same line for different reasons, record both.`

const DEDUP = `Dedup only candidates describing the same defect, same location, and same cause, keeping the most concrete failure scenario. Keep distinct defects on the same line and separate occurrences of the same mechanism at different locations.`

function gatherSection(bugsOnly: boolean): string {
  const committed = bugsOnly
    ? `Run \`git diff origin/HEAD...HEAD\` by itself, exactly as written: the whole branch against the default branch. Add \`git diff HEAD\` for staged and unstaged changes. Only if that fails, or it and \`git diff HEAD\` both print nothing, run \`git diff main...HEAD\` with the default branch's name in place of \`main\` if it has another (\`git branch -a\` lists the branches), or \`git diff HEAD~1\` if you cannot tell the base.`
    : `Gather \`git diff @{upstream}...HEAD\`, plus \`git diff HEAD\` for staged and unstaged changes. If there is no upstream, diff against the default branch (\`main\` or \`master\`) with \`git diff <default>...HEAD\`, or use \`git diff HEAD~1\`.`
  return `## Phase 0 — Gather the diff
Get the unified diff under review:
- Default (no target): ${committed} Untracked files are not part of the default scope.
- PR (number, \`#number\`, or URL): \`gh pr view <target>\` for context and \`gh pr diff <target>\` for the diff.
- Branch name: \`git diff <base>...<branch>\`, where \`<base>\` is the default branch.
- File path: restrict the diff to that path, and read the non-ignored untracked files under it (\`git ls-files --others --exclude-standard -- <path>\`) as new-file changes.
If there is nothing in scope, say there is nothing to review and stop. If a file cannot be read, disclose the coverage gap rather than declaring there is nothing to review.${bugsOnly ? `
Three forms need permission, so never write them: \`@{upstream}\` or \`@{u}\` next to \`..\` or \`...\`, commands grouped in parentheses, and shell variables such as \`$?\`.` : ''}`
}

const VERDICT_STATES = `- **CONFIRMED** — you can name the inputs or state that trigger it and the wrong output or crash. Quote the line.
- **PLAUSIBLE** — the mechanism is real but the trigger is uncertain (timing, environment, config). State what would confirm it.
- **REFUTED** — factually wrong (the code does not say that) or guarded elsewhere. Quote the line that proves it.`

const PLAUSIBLE_DEFAULT = `PLAUSIBLE is the default. Do not refute a candidate for being speculative when the state is realistic: concurrency races, nil on a rare but reachable path (error handler, cold cache, missing optional field), falsy-zero treated as missing, off-by-one on a boundary the code does not exclude, retry storms and partial failures, a regex or allowlist that lost an anchor. REFUTED only when it is constructible from the code: factually wrong, provably impossible, already handled in this diff (cite the guard), or pure style with no observable effect.`


const SWEEP_FOCUS = `moved or extracted code that dropped a guard or anchor; second-tier footguns (dataclass default evaluated once, \`hash()\` non-determinism, lock-scope shrink, predicate methods with side effects); setup and teardown asymmetry in tests; config defaults that were flipped.`

const LEAD_PRECISION = `You are reviewing for **precision** at medium effort: every finding you surface should be one a maintainer would act on.`
const LEAD_CORRECTNESS = `You are reviewing for **correctness bugs**: surface every plausible bug. At this level, catching real bugs matters more than avoiding false positives; err on the side of surfacing.`
const LEAD_HIGH = `You are reviewing for **recall** at high effort: catch every real bug a careful reviewer would catch in one sitting. Catching real bugs matters more than avoiding false positives. Err on the side of surfacing.`
const leadDeep = (effort: 'xhigh' | 'max') =>
  `You are reviewing for **recall** at ${effort === 'max' ? 'maximum' : 'extra-high'} effort: catch every real bug. Catching real bugs matters more than avoiding false positives; a missed bug ships. Err on the side of surfacing.`

const SEVERITY_SPEC = `Every entry carries every key above. Its \`severity\` is one of:
- \`important\`: a bug that should be fixed before merging because this change adds it or makes it worse. If someone can hit it, a rare trigger does not lower the severity.
- \`nit\`: a minor issue, worth fixing but not blocking: a broken CLAUDE.md rule, or a bug that harms nobody, such as a misleading log line.
- \`pre_existing\`: a bug that exists in the codebase but that this change did not introduce. A bug in unchanged lines is \`pre_existing\` if the change only fails to fix it, and \`important\` if the change re-exposes it.
A severity only labels and orders a finding: never drop one for its severity. When the limit forces a cut, cut the lowest-ranked first. Most severe means \`important\`, then \`pre_existing\`, then \`nit\`.
Write each \`summary\` in two or three short sentences. Start with the problem as a user of the code would see it. Next say where it happens and what sets it off. End with "Fix:" and the change to make, or what to check if you are not sure.
Beyond the dedup above, if the same mistake is repeated in several places, report it once and name the other places in its \`summary\`. Different mistakes stay separate findings, even when one change would fix them all.`

const SEVERITY_WORDS = `\`important\` (a bug that this change adds or makes worse, even if the trigger is rare), \`pre_existing\` (a bug that was there before this change) or \`nit\` (a bug that harms nobody). That is also the order, most severe first. Report a mistake repeated in several places once, and name the other places.`

const SEVERITY_AFTER_SWEEP = 'Then give each finding, the sweep\'s too, its `severity`, as Output defines it.'

function findingCount(cap: number | 'all'): string {
  return cap === 'all' ? 'every finding' : `at most ${cap} ${cap === 1 ? 'finding' : 'findings'}`
}

function capTag(cap: number | 'all' | undefined): string {
  return cap === undefined ? '' : cap === 'all' ? ' → all findings' : ` → ≤${cap} findings`
}

function bugAngles(deep: boolean): string[] {
  return [ANGLE_LINE_SCAN, ANGLE_REMOVED_BEHAVIOR, ANGLE_CROSS_FILE, ...(deep ? [ANGLE_PITFALLS, ANGLE_WRAPPER] : [])]
}

function otherAngles(bugsOnly: boolean, userRules: string): string[] {
  return bugsOnly
    ? [contextConventionsAngle(userRules)]
    : [ANGLE_REUSE, ANGLE_SIMPLIFICATION, ANGLE_EFFICIENCY, ANGLE_ALTITUDE, conventionsAngle(userRules)]
}

function angleSet(deep: boolean, userRules: string, bugsOnly = false): string {
  return [...bugAngles(deep), ...otherAngles(bugsOnly, userRules)].join('\n\n')
}

// `bug+other` when `split`, else the total; counts come from the angle lists so tags and prompts cannot drift.
function angleCount(deep: boolean, bugsOnly: boolean, split = false): string {
  const bugs = bugAngles(deep).length
  const other = otherAngles(bugsOnly, '').length
  return split ? `${bugs}+${other}` : String(bugs + other)
}

function sweepSection(viaAgent: boolean): string {
  const runner = viaAgent
    ? `Run one more finder via the ${AGENT_TOOL_NAME} tool as a fresh reviewer who has the verified list.`
    : `Take one more pass yourself (same context, no subagent) as a fresh reviewer who has the deduplicated list.`
  return `## Phase 3 — Sweep for gaps
${runner} Re-read the diff and the enclosing functions looking ONLY for defects not already listed; do not re-derive or re-confirm anything already there. Focus on what the first pass tends to miss: ${SWEEP_FOCUS}
Surface up to 8 additional candidates, each naming a defect not already on the list. If nothing new, return nothing from this phase; do not pad.`
}

// The forked reviewer's text is its result; a findings tool call there would leave the caller only a count.
const NO_REPORT_TOOL = `Do not call the ${REPORT_FINDINGS_TOOL_NAME} tool even if it is available.`

function outputSection(cap: number | 'all', floor?: number, severity = false): string {
  const target = floor === undefined
    ? ''
    : `Target at least ${floor} ${floor === 1 ? 'finding' : 'findings'}. If fewer genuine findings exist, report what you have; do not invent findings to reach the floor.\n`
  const size = cap === 'all'
    ? 'every finding that survives, with no maximum,'
    : `at most ${cap} findings (if more survive, keep the ${cap} most severe)`
  const fields = severity
    ? `\`summary\` (the problem, where it happens and what sets it off, then "Fix:" and the change to make), \`failure_scenario\` (concrete inputs or state → wrong output or crash), and \`severity\` (one of \`important\`, \`nit\`, \`pre_existing\`)`
    : `\`summary\` (one sentence), and \`failure_scenario\` (concrete inputs or state → wrong output or crash)`
  return `## Output
${target}Return ${size} as a JSON array in a \`\`\`json block, ranked most severe first. Each entry has \`file\` (repo-relative path), \`line\`, ${fields}. If nothing survives, return \`[]\`. ${NO_REPORT_TOOL} This review's output contract is the JSON block above.${severity ? `\n\n${SEVERITY_SPEC}` : ''}`
}

const LOW_READ = `Read the diff. With a path target, also read its untracked files as new-file additions. No subagents, no full-file reads.`
const LOW_SKIP_TESTS = ` Skip test and fixture hunks (\`test/\`, \`spec/\`, \`__tests__/\`, \`*_test.*\`, \`*.test.*\`, \`fixtures/\`, \`testdata/\`); test-file changes are not reviewed at this level.`
const LOW_BUG_FLAGS = `Flag runtime-correctness bugs visible from the hunk alone: inverted or wrong conditions, off-by-one, null/undefined dereference where the adjacent lines show the value can be absent, removed guards, falsy-zero checks, missing \`await\`, wrong-variable copy-paste, errors swallowed in a catch that should propagate.`
const LOW_CLEANUP_FLAGS = ` Also flag, still from the hunk alone, new code that duplicates a helper visible in the diff context, and dead code the diff leaves behind.`
const LOW_SCOPE = `Do not flag style, naming, performance, missing tests, or anything outside the changed lines.`
const LOW_LINE = `one line each: \`path/to/file.ext:123 — what's wrong and the concrete failure\``

function lowPrompt(cell: 'low' | 'low-sonnet5' | 'o48-low-v1' | 'bugs-low-v1', cap: number | 'all' | undefined): string {
  const read = `## Review at low effort: one diff pass, no verification
${LOW_READ}${cell === 'o48-low-v1' ? '' : LOW_SKIP_TESTS}`
  let output: string
  if (cell === 'low-sonnet5') {
    output = `Target min(files_changed, 4) findings, most severe first, ${LOW_LINE}. If you have fewer, do one more pass focused on the largest changed file and on any removed code blocks. Output \`(none)\` only if the diff is trivially correct after that pass.`
  } else if (cell === 'o48-low-v1') {
    const c = cap ?? 8
    const floor = c === 'all' ? 4 : Math.min(4, c)
    output = `Output ${findingCount(c)}, most severe first, ${LOW_LINE}. Target at least min(files_changed, ${floor}) findings; if you see fewer, widen to other hunks in the same diff before stopping. If fewer than ${floor} genuine findings exist, output what you have.`
  } else if (cell === 'bugs-low-v1') {
    output = `Output ${findingCount(cap ?? 4)}, most severe first, one line each: \`path/to/file.ext:123 — important|pre_existing|nit — what's wrong and the concrete failure. Fix: the change to make, or what to check if you are not sure\`. Every line carries one of those three words: ${SEVERITY_WORDS} If nothing qualifies, output exactly \`(none)\`.`
  } else {
    output = `Output ${findingCount(cap ?? 4)}, most severe first, ${LOW_LINE}. If nothing qualifies, output exactly \`(none)\`.`
  }
  const bugsOnly = cell === 'bugs-low-v1'
  const flags = `${LOW_BUG_FLAGS}${bugsOnly ? '' : LOW_CLEANUP_FLAGS}\n${LOW_SCOPE}`
  return [gatherSection(bugsOnly), read, flags, `${output} ${NO_REPORT_TOOL}`].join('\n\n')
}

// Agent-backed recipe: parallel finder subagents, one verifier per candidate, and a sweep at xhigh and max.
// `bugsOnly` keeps only the correctness angles plus conventions and labels each finding with a severity.
function fanOutPrompt(effort: 'medium' | 'high' | 'xhigh' | 'max', cap: number | 'all', userRules: string, bugsOnly = false): string {
  const deep = effort === 'xhigh' || effort === 'max'
  const perAngle = deep ? 8 : 6
  const angles = angleCount(deep, bugsOnly)
  const lead = effort === 'medium' ? LEAD_PRECISION : effort === 'high' ? LEAD_HIGH : leadDeep(effort)
  const verify = effort === 'high'
    ? `## Phase 2 — Verify (1 vote, recall-biased)
${DEDUP} For each remaining candidate, run one verifier via the ${AGENT_TOOL_NAME} tool: give it the diff, the relevant files, and the candidate; it returns exactly one of CONFIRMED, PLAUSIBLE, or REFUTED.

${PLAUSIBLE_DEFAULT}

Keep CONFIRMED and PLAUSIBLE. Drop REFUTED.`
    : `## Phase 2 — Verify (1 vote, 3 states)
${DEDUP} For each remaining candidate, run one verifier via the ${AGENT_TOOL_NAME} tool: give it the diff, the relevant files, and the candidate, and have it return exactly one verdict:
${VERDICT_STATES}

Keep candidates where the vote is CONFIRMED or PLAUSIBLE.${deep ? ' This is recall mode: a single non-REFUTED vote carries the finding. Do not drop on uncertainty.' : ''}`
  const shape = bugsOnly ? conventionsShape("the output's") : CLEANUP_SHAPE
  return [
    lead,
    gatherSection(bugsOnly),
    `## Phase 1 — Find candidates (${angles} angles, up to ${perAngle} each)
Run the ${angles} finder angles via the ${AGENT_TOOL_NAME} tool, all in one message so they run in parallel. Give each the full diff and the instructions for its angle. Each surfaces up to ${perAngle} candidate findings with \`file\`, \`line\`, a one-line \`summary\`, and a concrete \`failure_scenario\`.${deep ? ` ${NO_SUPPRESSION}` : ''}`,
    angleSet(deep, userRules, bugsOnly),
    deep ? shape : `${shape}\n${PASS_THROUGH}`,
    verify,
    deep ? sweepSection(true) : undefined,
    bugsOnly ? SEVERITY_AFTER_SWEEP : undefined,
    outputSection(cap, undefined, bugsOnly),
  ].filter(Boolean).join('\n\n')
}

// The agent-backed recipe when the Agent tool is missing: every angle in one context, self-checked.
function singlePassPrompt(effort: 'medium' | 'high' | 'xhigh' | 'max', cap: number | 'all', userRules: string, bugsOnly = false): string {
  const deep = effort === 'xhigh' || effort === 'max'
  const angles = angleCount(deep, bugsOnly)
  const lead = effort === 'medium' ? LEAD_PRECISION : effort === 'high' ? LEAD_HIGH : leadDeep(effort)
  return [
    lead,
    `The ${AGENT_TOOL_NAME} tool is not available here, so the multi-agent fan-out and subagent verify pass cannot run. Work through every angle yourself, in this same context, in one pass; do not skip angles for lack of fan-out. Re-check each candidate against the diff before keeping it; drop anything you cannot back up with a concrete failure scenario.`,
    gatherSection(bugsOnly),
    `## Phase 1 — Find candidates (${angles} angles, single pass)
Work through the ${angles} angles yourself, in sequence; do not spawn subagents. Each surfaces candidate findings with \`file\`, \`line\`, a ${bugsOnly ? 'short' : 'one-line'} \`summary\`, and a concrete \`failure_scenario\`.`,
    angleSet(deep, userRules, bugsOnly),
    bugsOnly ? conventionsShape('the same') : CLEANUP_SHAPE,
    `## Phase 2 — Dedup and self-check (no subagent verify)
${DEDUP} Re-check each remaining candidate yourself against the diff before keeping it.`,
    deep ? sweepSection(false) : undefined,
    bugsOnly ? SEVERITY_AFTER_SWEEP : undefined,
    `${outputSection(cap, undefined, bugsOnly)}\nState clearly in your report that this was a single-pass review done without the ${AGENT_TOOL_NAME} tool, not the full multi-agent fan-out.`,
  ].filter(Boolean).join('\n\n')
}

type InlineCell = 'o48-med-v1' | 'o48-high-v1' | 'o48-xhigh-v1' | 'bugs-conventions-v1' | 'bugs-conventions-xhigh-v1'

// Inline recipe: every angle in the reviewer's own context, dedup only, with a findings floor.
function inlinePrompt(cell: InlineCell, cap: number | 'all', userRules: string): string {
  const deep = cell === 'o48-xhigh-v1' || cell === 'bugs-conventions-xhigh-v1'
  const bugsOnly = cell.startsWith('bugs-')
  const perAngle = deep ? 8 : 6
  const defaultCap = CELL_DEFAULT_CAP[cell]!
  const floor = Math.max(1, Math.floor((cap === 'all' ? defaultCap : Math.min(cap, defaultCap)) / 2))
  const shape = bugsOnly ? conventionsShape(deep ? "the output's" : 'the same') : CLEANUP_SHAPE
  return [
    cell === 'o48-med-v1' ? LEAD_CORRECTNESS : deep ? leadDeep('xhigh') : LEAD_HIGH,
    gatherSection(bugsOnly),
    `## Phase 1 — Find candidates (${angleCount(deep, bugsOnly)} angles, up to ${perAngle} each)
Work through each angle yourself, in sequence, in this context; do not spawn subagents for them. Each surfaces up to ${perAngle} candidate findings with \`file\`, \`line\`, a ${bugsOnly ? 'short' : 'one-line'} \`summary\`, and a concrete \`failure_scenario\`.${deep ? ` ${NO_SUPPRESSION}` : ''}`,
    angleSet(deep, userRules, bugsOnly),
    deep && !bugsOnly ? shape : `${shape}\n${PASS_THROUGH}`,
    `## Phase 2 — Dedup only (no verify)
Pool all candidates. ${DEDUP} Do not run verifiers and do not re-judge.${bugsOnly && !deep ? ' Give each finding that is left its `severity`, as Output defines it.' : ''} Sort by severity.${deep ? ' Do not drop on uncertainty.' : ''}`,
    deep ? sweepSection(false) : undefined,
    bugsOnly && deep ? SEVERITY_AFTER_SWEEP : undefined,
    outputSection(cap, floor, bugsOnly),
  ].filter(Boolean).join('\n\n')
}

function minimalPrompt(cap: number | 'all'): string {
  return [
    `You are reviewing the change for real bugs.`,
    gatherSection(false),
    `Review the diff as a careful senior engineer would: read every hunk, open the surrounding files for context as needed (Read, Grep, git log/blame/show), and hunt for correctness issues: wrong or inverted conditions, off-by-one, null/undefined dereference, missing \`await\`, dropped error handling, removed guards or validations, broken callers of changed functions, races. Prefer real failure modes over style; every finding needs a concrete scenario in which the code misbehaves. Quality over quantity: include everything you genuinely believe is a real issue, and nothing you don't.`,
    outputSection(cap),
  ].join('\n\n')
}

type Cell =
  | 'low' | 'low-sonnet5' | 'o48-low-v1'
  | 'medium' | 'high' | 'xhigh' | 'max'
  | 'o48-med-v1' | 'o48-high-v1' | 'o48-xhigh-v1'
  | 'o5-bmin'
  | 'bugs-low-v1' | 'bugs-conventions-v1' | 'bugs-conventions-xhigh-v1' | 'bugs-conventions-max-v1'
type Route = { cell: Cell; finderBudgetHint?: boolean; lowEffortModel?: boolean }

// Default finding caps per recipe; `--max-findings` overrides them. low-sonnet5 has no maximum.
const CELL_DEFAULT_CAP: Record<Cell, number | undefined> = {
  low: 4, 'low-sonnet5': undefined, 'o48-low-v1': 8,
  medium: 8, high: 10, xhigh: 15, max: 15,
  'o48-med-v1': 8, 'o48-high-v1': 10, 'o48-xhigh-v1': 15,
  'o5-bmin': 15,
  'bugs-low-v1': 4, 'bugs-conventions-v1': 10, 'bugs-conventions-xhigh-v1': 15, 'bugs-conventions-max-v1': 15,
}
const MINIMAL_MAX_FINDINGS = 32

// Recipe per model family and effort level; unlisted models use `default`.
const ROUTES: Record<string, Record<ReviewEffort, Route>> = {
  default: {
    low: { cell: 'bugs-low-v1' },
    medium: { cell: 'bugs-conventions-v1' },
    high: { cell: 'bugs-conventions-v1' },
    xhigh: { cell: 'bugs-conventions-xhigh-v1' },
    max: { cell: 'bugs-conventions-max-v1' },
  },
  'claude-sonnet-5': {
    // Sonnet 5 runs the low recipe at medium model effort.
    low: { cell: 'low-sonnet5', lowEffortModel: true },
    medium: { cell: 'medium' },
    high: { cell: 'high', finderBudgetHint: true },
    xhigh: { cell: 'xhigh', finderBudgetHint: true },
    max: { cell: 'max', finderBudgetHint: true },
  },
  'claude-opus-4-8': {
    low: { cell: 'o48-low-v1' },
    medium: { cell: 'o48-med-v1' },
    high: { cell: 'o48-high-v1' },
    xhigh: { cell: 'o48-xhigh-v1' },
    max: { cell: 'max' },
  },
  'claude-opus-5': {
    low: { cell: 'low' },
    medium: { cell: 'o5-bmin' },
    high: { cell: 'o5-bmin' },
    xhigh: { cell: 'o48-xhigh-v1' },
    max: { cell: 'max' },
  },
}

function modelFamily(model: string | undefined): string {
  const name = model ? getCanonicalName(model) : undefined
  return name !== undefined && Object.hasOwn(ROUTES, name) ? name : 'default'
}

function tierTag(cell: Cell, hasAgent: boolean): string {
  switch (cell) {
    case 'low':
    case 'o48-low-v1':
      return 'low effort → 1 diff pass → no verify'
    case 'bugs-low-v1':
      return 'low effort → 1 diff pass (bugs) → no verify'
    case 'bugs-conventions-v1':
      return `high effort → ${angleCount(false, true)} inline angles (bugs + conventions) → dedup (no verify)`
    case 'bugs-conventions-xhigh-v1':
      return `xhigh effort → ${angleCount(true, true)} inline angles (bugs + conventions) → dedup (no verify) → sweep`
    case 'bugs-conventions-max-v1':
      return hasAgent
        ? `max effort → ${angleCount(true, true, true)} angles × 8 candidates → 1-vote verify → sweep`
        : `max effort → ${AGENT_TOOL_NAME} tool unavailable → single-pass inline`
    case 'low-sonnet5':
      return 'low effort → 1 diff pass → no verify → ≥min(files,4) findings'
    case 'medium':
    case 'high':
      return hasAgent
        ? `${cell} effort → ${angleCount(false, false, true)} angles × 6 candidates → 1-vote verify${cell === 'high' ? ' (recall-biased)' : ''}`
        : `${cell} effort → ${AGENT_TOOL_NAME} tool unavailable → single-pass inline`
    case 'xhigh':
    case 'max':
      return hasAgent
        ? `${cell} effort → ${angleCount(true, false, true)} angles × 8 candidates → 1-vote verify → sweep`
        : `${cell} effort → ${AGENT_TOOL_NAME} tool unavailable → single-pass inline`
    case 'o48-med-v1':
      return `medium effort → ${angleCount(false, false)} inline angles → dedup (no verify)`
    case 'o48-high-v1':
      return `high effort → ${angleCount(false, false)} inline angles → dedup (no verify)`
    case 'o48-xhigh-v1':
      return `xhigh effort → ${angleCount(true, false)} inline angles → dedup (no verify) → sweep`
    case 'o5-bmin':
      return 'minimal prompt → single careful diff pass'
  }
}

function recipePrompt(cell: Cell, cap: number | 'all' | undefined, hasAgent: boolean, userRules: string): string {
  const c = cap ?? CELL_DEFAULT_CAP[cell] ?? 'all'
  switch (cell) {
    case 'low':
    case 'low-sonnet5':
    case 'o48-low-v1':
    case 'bugs-low-v1':
      return lowPrompt(cell, cap)
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return hasAgent ? fanOutPrompt(cell, c, userRules) : singlePassPrompt(cell, c, userRules)
    case 'bugs-conventions-max-v1':
      return hasAgent ? fanOutPrompt('max', c, userRules, true) : singlePassPrompt('max', c, userRules, true)
    case 'o48-med-v1':
    case 'o48-high-v1':
    case 'o48-xhigh-v1':
    case 'bugs-conventions-v1':
    case 'bugs-conventions-xhigh-v1':
      return inlinePrompt(cell, c, userRules)
    case 'o5-bmin':
      return minimalPrompt(c)
  }
}

// Scales the finder fleet to the committed diff size; uncommitted changes are not counted.
async function finderBudgetHint(target: string): Promise<string> {
  let range: string
  if (!target) range = '@{upstream}...HEAD'
  else if (target.length <= 256 && /^[@\w][@\w./~^-]*\.\.\.?[@\w][@\w./~^-]*$/.test(target)) range = target
  else return ''
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=', 'diff', '--no-ext-diff', '--no-textconv', '--numstat', '--end-of-options', range, '--'],
    { timeout: 5000, preserveOutputOnError: false, useCwd: true },
  )
  if (code !== 0) return ''
  let lines = 0
  for (const row of stdout.split('\n')) {
    const match = row.match(/^(\d+)\t(\d+)\t/)
    if (match) lines += Number(match[1]) + Number(match[2])
  }
  if (lines === 0) return ''
  const budget = Math.max(2, Math.min(8, Math.ceil(lines / 150)))
  return target
    ? `This diff is about ${lines} lines. Spawn about ${budget} finder subagents (min 2, max 8); scale your investigation depth to the diff size rather than using a fixed large fleet.`
    : `The committed diff (@{upstream}...HEAD) is about ${lines} lines. Uncommitted changes aren't counted here, so treat this as a floor: start with about ${budget} finder subagents (min 2, max 8) and scale up if Phase 0 finds additional working-tree scope.`
}

// Accepts `123`, `#123`, or a GitHub pull request URL.
function parsePrNumber(target: string): string | undefined {
  const match = target.match(/^#?(\d+)$/) ?? target.match(/\/pull\/(\d+)(?:[/?#]|$)/)
  return match?.[1]
}

async function isLocalPathTarget(target: string): Promise<boolean> {
  if (!target || parsePrNumber(target) !== undefined) return false
  try {
    const cwd = await realpath(getCwd())
    const path = await realpath(resolve(cwd, target))
    const rel = relative(cwd, path)
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  } catch {
    return false
  }
}

type DiffSource = { name: string; noun: string; command: string; withoutPrDiff?: string; byUrl: boolean }

const URL_HOST = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::\d{1,5})?`
const URL_SEGMENT = '[A-Za-z0-9_.-]+'
const GITHUB_PR_URL = new RegExp(`^https?://(${URL_HOST})/(${URL_SEGMENT})/(${URL_SEGMENT})/pull/(\\d{1,9})(?:[/?#]|$)`)
const GITLAB_MR_URL = new RegExp(`^(https?://${URL_HOST}/(?:${URL_SEGMENT}/)+${URL_SEGMENT})/-/merge_requests/\\d`)

// A GitLab target is an MR URL, `!123`, or a bare number or branch in a gitlab.com checkout.
function isGitLabTarget(target: string, repoHost: string | null): boolean {
  if (/\/-\/merge_requests\/\d/.test(target) || /^!\d+$/.test(target)) return true
  if (/^https?:\/\//i.test(target)) return false
  return repoHost === 'gitlab.com'
}

function mergeRequestId(target: string): string {
  const id = /\/-\/merge_requests\/(\d+)/.exec(target)?.[1] ?? target.replace(/^!(\d+)$/, '$1')
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id) ? id : ''
}

function mergeRequestProject(target: string): string | null {
  return GITLAB_MR_URL.exec(target)?.[1] ?? null
}

function prDiffApi(repo: string, pr: string): string {
  return `gh api repos/${repo}/pulls/${pr} -H 'Accept: application/vnd.github.diff'`
}

// The pull or merge request a target names, with the command that reads its diff.
function diffSource(target: string, gitlab: boolean, repoHost: string | null): DiffSource | undefined {
  if (gitlab) {
    const id = mergeRequestId(target)
    const project = mergeRequestProject(target)
    if (!(project === null ? /^!?\d{1,6}$/.test(target) : /^\d{1,9}$/.test(id))) return undefined
    return {
      name: `GitLab merge request ${id}`,
      noun: 'merge request',
      command: `glab mr diff ${id}${project ? ` -R ${project}` : ''}`,
      byUrl: project !== null,
    }
  }
  if (/^\d{1,6}$/.test(target)) {
    if (repoHost === 'bitbucket.org') return undefined
    return {
      name: `GitHub pull request ${target}`,
      noun: 'pull request',
      command: `gh pr diff ${target}`,
      withoutPrDiff: prDiffApi('{owner}/{repo}', target),
      byUrl: false,
    }
  }
  const [, host, owner, repo, pr] = GITHUB_PR_URL.exec(target) ?? []
  if (host === undefined || owner === undefined || repo === undefined || pr === undefined) return undefined
  const url = `https://${host}/${owner}/${repo}/pull/${pr}`
  const github = host === 'github.com'
  return {
    name: `GitHub pull request ${url}`,
    noun: 'pull request',
    command: github ? `gh pr diff ${pr} -R ${owner}/${repo}` : `gh pr diff ${url}`,
    withoutPrDiff: github ? prDiffApi(`${owner}/${repo}`, pr) : undefined,
    byUrl: true,
  }
}

function diffSourceSection(source: DiffSource, args: ParsedArgs): string {
  const failed = `Could not read ${source.name}: \`${source.command}\` was refused or failed`
  const fallback = args.fix || source.byUrl
    ? `If that leaves you without the diff, because a command was refused or failed, stop: post nothing, change no file, and reply with only this sentence, word for word, and no list of findings, not even an empty one: "${failed}, so nothing was reviewed."`
    : args.comment
      ? `If that leaves you without the diff, because a command was refused or failed, go on as if this section were not here: follow the instructions below, and post the findings as they say. Then open your final reply with this sentence, word for word: "${failed}, so this review and its comments are of the checked-out code."`
      : `If that leaves you without the diff, because a command was refused or failed, run the \`git diff\` commands below as if no target had been passed, and review the checked-out branch instead. Then open your final reply with these two sentences, word for word, above the findings, and keep the json fence where the output below shows one: "${failed}. This review is of the checked-out branch instead, which may not be that ${source.noun}."

Two cases end the review instead: the command answers that there is no such ${source.noun}, or, falling back, you find that the checked-out branch has no diff. Then reply with only one sentence that says which, and no list of findings, not even an empty one.`
  const withoutPrDiff = source.withoutPrDiff
    ? `\nSome sessions have a gh with no \`pr diff\` command. Only if gh itself says so, run this in its place, alone too:\n\n\`\`\`\n${source.withoutPrDiff}\n\`\`\`\n`
    : ''
  return `That target is ${source.name}, and its own diff is this review's scope. Get the diff with this command, run alone, with nothing chained, piped or redirected:

\`\`\`
${source.command}
\`\`\`

It replaces every \`git diff\` command that the instructions below give for gathering the diff. This checkout may be on another branch${source.byUrl ? ', or of another repository' : ''}, and must stay as it is: before you lean on a file here for context, check that it already has the diff's added lines, and where it does not, judge from the diff alone and report nothing from that file. If you start subagents, give each one the diff itself and this warning: they see none of this.
${withoutPrDiff}
${fallback}

Use the quoted words only where you could not read the diff. Where you did read it, leave them out altogether.`
}

const SEVERITY_IN_WORDS = `Open each finding's text with its severity in words, never with an emoji: "Important:", "Pre-existing (not from this change, not blocking):" or "Nit (optional):".`

function postNotice(args: ParsedArgs, gitlab: boolean): string {
  if (!args.post) return ''
  const comment = args.comment
    ? gitlab
      ? 'when the target is a GitLab merge request, your `--comment` is what posts the findings as one general MR note via glab'
      : 'when the target is a GitHub PR, your `--comment` is what posts the findings as inline PR comments'
    : gitlab
      ? 'this local review will not post to GitLab; `--comment` is the flag that posts local findings as a general MR note'
      : 'this local review will not post to GitHub; `--comment` is the flag that posts local findings as inline PR comments'
  return `(The typed \`--post\` applies only to the cloud review, which is not available here, and was ignored: ${comment}. Open your report with one short line telling the user this; that opening line reaches them with the findings.)`
}

function actionSections(args: ParsedArgs, localPathTarget: boolean, gitlab: boolean, bugsOnly: boolean): string {
  const sections: string[] = []
  if (args.comment && gitlab) {
    const id = mergeRequestId(args.target)
    const project = mergeRequestProject(args.target)
    sections.push(`## Posting to GitLab (--comment)
The \`--comment\` flag was passed. After producing the findings list, if the review target is a GitLab merge request, post the findings as one general MR note via \`glab mr note${id ? ` ${id}` : ''}${project ? ` -R ${project}` : ''} -m "<body>"\`${project ? '' : " from inside that project's checkout"} (every finding with its file:line, the issue, and the suggested fix).${bugsOnly ? ` ${SEVERITY_IN_WORDS}` : ''} glab has no single verb for line-anchored comments; those require \`glab api projects/:id/merge_requests/:iid/discussions\`, so post the general note unless the user asks for inline threads. If glab is not available in this session, print the findings instead. If the target is not an MR, print the findings and note that \`--comment\` was ignored.`)
  } else if (args.comment) {
    sections.push(`## Posting to GitHub (--comment)
The \`--comment\` flag was passed. After producing the findings list, if the review target is a GitHub PR, post each finding as an inline PR comment via \`mcp__github_inline_comment__create_inline_comment\` (one call per finding; include a suggestion block only when it fully fixes the issue).${bugsOnly ? ` ${SEVERITY_IN_WORDS}` : ''} If that tool is not available in this session, fall back to \`gh api\` (repos/{owner}/{repo}/pulls/{pr}/comments) or print the findings instead. If the target is not a PR, print the findings and note that \`--comment\` was ignored.`)
  }
  if (args.fix) {
    // --fix edits the working tree, so it only runs on the local changes that are checked out.
    sections.push(
      args.target !== '' && !localPathTarget
        ? `## Applying fixes (--fix)
--fix only applies to the local changes. Target \`${args.target}\` is not a confirmed path in the current working directory, so change no files and say so.`
        : `## Applying fixes (--fix)
The \`--fix\` flag was passed. After producing the findings list, apply the findings to the working tree instead of stopping at the report: fix each one directly, ${bugsOnly ? 'whatever its kind or severity' : 'correctness bugs and cleanups alike'}.${localPathTarget ? ` Restrict edits to the reviewed target \`${args.target}\`.` : ''} Skip any finding whose fix would change intended behavior, require changes well outside the reviewed diff, or that you judge to be a false positive; note the skip rather than arguing with it. Finish with a brief summary of what was fixed and what was skipped.`,
    )
  }
  return sections.join('\n\n')
}

const SEVERITY_ORDER = ['important', 'pre_existing', 'nit'] as const
type Severity = (typeof SEVERITY_ORDER)[number]
const SEVERITY_LABELS: Record<Severity, string> = { important: '🔴 Important', pre_existing: '🟣 Pre-existing', nit: '🟡 Nit' }
type Finding = { file: string; line?: number | string | null; summary: string; failure_scenario?: string | null; severity?: Severity }

function parseFindings(text: string): Finding[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(text.trim())
  } catch {
    return undefined
  }
  if (!Array.isArray(value)) return undefined
  const findings: Finding[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined
    const { file, line, summary, failure_scenario, severity } = item as Record<string, unknown>
    if (typeof file !== 'string' || typeof summary !== 'string') return undefined
    if (line != null && typeof line !== 'number' && typeof line !== 'string') return undefined
    if (failure_scenario != null && typeof failure_scenario !== 'string') return undefined
    const level = typeof severity === 'string' ? severity.trim().toLowerCase().replace(/[-\s]+/g, '_') : undefined
    findings.push({
      file,
      line: line as Finding['line'],
      summary,
      failure_scenario: failure_scenario as Finding['failure_scenario'],
      severity: SEVERITY_ORDER.find(s => s === level),
    })
  }
  return findings
}

function renderFindings(text: string): string | undefined {
  const findings = parseFindings(text)
  if (findings === undefined) return undefined
  if (findings.length === 0) return 'Code review found no issues.'
  const groups = [...SEVERITY_ORDER, undefined].map(severity => findings.filter(f => f.severity === severity))
  const ordered = groups.flat()
  const items = ordered.map((f, i) => {
    const prefix = `${i + 1}. `
    const location = f.line ? `${f.file}:${f.line}` : f.file
    const label = f.severity ? `${SEVERITY_LABELS[f.severity]} ` : ''
    const scenario = f.failure_scenario ? `\n\nFailure scenario: ${f.failure_scenario}` : ''
    return `${prefix}${label}\`${location}\`: ${f.summary}${scenario}`.trim().replace(/\n(?=[^\n])/g, `\n${' '.repeat(prefix.length)}`)
  })
  const counts = groups.flatMap(group => {
    const first = group[0]
    return first ? [`${group.length} ${first.severity ? SEVERITY_LABELS[first.severity] : 'with no severity'}`] : []
  })
  const detail = ordered.length === 1 ? '' : ordered.some(f => f.severity) ? ` (${counts.join(', ')})` : ', most severe first'
  return `${ordered.length} ${plural(ordered.length, 'finding')}${detail}:\n\n${items.join('\n\n')}`
}

// Shows the reviewer's JSON findings as a numbered list; text and json print output stay machine-readable.
function formatReviewResult(result: string): string {
  const format = getPrintOutputFormat()
  if (format === 'text' || format === 'json') return result
  const whole = result.trimStart().startsWith('[') ? renderFindings(result) : undefined
  return whole ?? result.replace(/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim, (block, body: string) => renderFindings(body) ?? block)
}

function lastUsedEffort(): ReviewEffort | undefined {
  // Config is hand-editable, so a stored value must pass the same check as typed input.
  const last = getGlobalConfig().codeReviewLastEffort
  return last !== undefined && isEffortLevel(last) ? last : undefined
}

// The level the user asked for: `ultra` falls back to max, otherwise typed, then last typed.
function requestedEffort(args: ParsedArgs): ReviewEffort | undefined {
  return args.ultra ? 'max' : args.explicitEffort ?? lastUsedEffort()
}

// A requested level is capped only to what the model supports; the session effort (including its
// env override) applies only when no level was requested.
function resolveLevel(args: ParsedArgs, context: ToolUseContext): ReviewEffort {
  const requested = requestedEffort(args)
  const model = context.options?.mainLoopModel
  if (requested !== undefined) {
    const supported = model ? getSupportedEffortLevelsForModel(model) : []
    return supported.length > 0 ? clampEffortToSupportedLevels(requested, supported) ?? requested : requested
  }
  const applied = model ? resolveAppliedEffort(model, context.getAppState?.().effortValue) : undefined
  return applied === undefined ? 'medium' : convertEffortValueToLevel(applied)
}

function resolveCap(args: ParsedArgs, cell: Cell): { asked?: number | 'all'; stated?: number | 'all'; reused: boolean } {
  const stored = getGlobalConfig().codeReviewLastMaxFindings
  const reused = args.maxFindings === undefined && cell !== 'low-sonnet5'
    && (stored === 'all' || (typeof stored === 'number' && Number.isSafeInteger(stored) && stored > 0))
  const asked = reused ? stored as number | 'all' : args.maxFindings === 'default' ? undefined : args.maxFindings
  const stated = cell === 'low-sonnet5'
    ? undefined
    : cell === 'o5-bmin' && (asked === 'all' || (asked !== undefined && asked > MINIMAL_MAX_FINDINGS)) ? MINIMAL_MAX_FINDINGS : asked
  return { asked, stated, reused }
}

function capNotice(cap: ReturnType<typeof resolveCap>, ignored: boolean): string {
  const notes: string[] = []
  if (ignored) notes.push(`\`--max-findings\` was ignored: type a whole number above zero, \`all\`, or \`default\` after it.${cap.reused ? '' : ' Using the usual limit.'}`)
  const limitNote = `This review reports at most ${MINIMAL_MAX_FINDINGS} findings, so the limit is ${MINIMAL_MAX_FINDINGS} here.`
  if (cap.asked !== undefined && cap.stated === undefined) {
    notes.push('`--max-findings` does not change this review: low effort here has no maximum.')
  } else if (cap.stated !== cap.asked) {
    notes.push(cap.reused ? `The user set \`--max-findings ${cap.asked}\` last time. ${limitNote}` : limitNote)
  } else if (cap.reused && cap.asked !== undefined) {
    notes.push(cap.asked === 'all'
      ? 'Reporting every finding, as the user chose last time with `--max-findings all`.'
      : `Reporting up to ${cap.asked} ${cap.asked === 1 ? 'finding' : 'findings'}, the limit the user set last time with \`--max-findings\`.`)
  }
  if (notes.length === 0) return ''
  const reset = cap.reused ? ', and that passing `--max-findings default` goes back to the usual limit' : ''
  return `(${notes.join(' ')} Open your report with one short line telling the user this${reset}; that opening line reaches them with the findings.)`
}

function effortNotice(args: ParsedArgs, level: ReviewEffort): string {
  if (args.ultra) {
    return args.fix
      ? `(Running a local ${level}-effort review and applying its findings.)`
      : `(ultra (cloud review) isn't available in this environment. Falling back to a local ${level}-effort review.)`
  }
  if (args.explicitEffort !== undefined) {
    return args.explicitEffort === level
      ? ''
      : `(${args.explicitEffort} effort is not available for this model; running at ${level} here. Open your report with one short line telling the user this; that opening line reaches them with the findings.)`
  }
  const last = lastUsedEffort()
  if (last === undefined) return ''
  return `(No effort level given — reusing ${last}, the level the user typed last time${level !== last ? `; running at ${level} here` : ''}. Open your report with one short line telling the user this, and that typing a level (for example \`/code-review high\`) changes it; that opening line reaches them with the findings.)`
}

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
    description: 'Review the current diff or a PR for bugs',
    argumentHint:
      '[low|medium|high|xhigh|max] [--fix] [--comment] [--max-findings <n|all|default>] [pr# | branch | path]',
    context: 'fork',
    formatForegroundForkResult: formatReviewResult,
    // An over-budget skill listing falls back to 250 characters per entry, so the argument format stays terse.
    whenToUse:
      'args: optional level first (low|medium|high|xhigh|max), then --fix, --comment, --max-findings <n|all>, and a PR number, branch or path; no prose. Use max only when explicitly asked.',
    // Only levels and limits the user typed interactively are remembered; model-started and --print reviews leave them alone.
    onUserTypedArgs: (raw: string) => persistArgs(parseCodeReviewArgs(raw)),
    // The forked reviewer runs at the level the user typed (or typed last time), mapped per model.
    getEffort(raw: string, context: ToolUseContext) {
      const args = parseCodeReviewArgs(raw)
      if (args.ultra) return undefined
      const requested = args.explicitEffort ?? lastUsedEffort()
      if (requested === undefined) return undefined
      return ROUTES[modelFamily(context.options?.mainLoopModel)]![requested].lowEffortModel ? 'medium' : requested
    },
    async getPromptForCommand(raw: string, context: ToolUseContext) {
      const args = parseCodeReviewArgs(raw)
      const level = resolveLevel(args, context)
      const notice = effortNotice(args, level)
      const route = ROUTES[modelFamily(context.options?.mainLoopModel)]![level]
      const hasAgent = (context?.options?.tools ?? []).some(tool => tool.name === AGENT_TOOL_NAME)
      const cap = resolveCap(args, route.cell)
      const localPathTarget = args.fix && await isLocalPathTarget(args.target)
      const budgetHint = route.finderBudgetHint && hasAgent ? await finderBudgetHint(args.target) : ''
      // The remote host decides whether a bare number is a GitHub PR or a GitLab MR, and where --comment posts.
      const needsHost = (args.comment || args.post || /^\d{1,6}$/.test(args.target)) && !/^(https?:\/\/|!\d+$)/i.test(args.target)
      const repoHost = needsHost ? (await detectCurrentRepositoryWithHost())?.host ?? null : getCachedRepositoryHost()
      const gitlab = isGitLabTarget(args.target, repoHost)
      const source = args.target ? diffSource(args.target, gitlab, repoHost) : undefined
      const prompt = [
        notice,
        postNotice(args, gitlab),
        capNotice(cap, args.maxFindingsIgnored),
        args.target ? `Review target: \`${args.target}\`` : '',
        source ? diffSourceSection(source, args) : '',
        budgetHint,
        `\`${tierTag(route.cell, hasAgent)}${capTag(cap.stated ?? CELL_DEFAULT_CAP[route.cell])}\``,
        recipePrompt(route.cell, cap.stated, hasAgent, join(getClaudeConfigHomeDir(), 'CLAUDE.md')),
        actionSections(args, localPathTarget, gitlab, route.cell.startsWith('bugs-')),
      ].filter(Boolean).join('\n\n')
      return [{ type: 'text', text: prompt }]
    },
  })
}
