import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { findGitRoot, gitExe } from '../git.js'
import { getCwd } from '../cwd.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'

/**
 * `{"meta":{"gitStatus":…}}` ground-truth lines for the auto-mode classifier,
 * which auto_mode_system_prompt.txt ("## Input") already tells the model how to
 * read. Ports upstream 2.1.270's ZLn/GFe, minus the `gitStatusUploads` half
 * (counts only, never the file listing), plus `--no-optional-locks` so a read-only
 * probe doesn't refresh the index under a concurrent user.
 *
 * Safe to default on: every failure returns null, and the prompt's contract for
 * a missing line is "proceed on the existing rules as usual".
 */

/** Upstream 2.1.270 `pft.gitStatusType`. */
const GIT_STATUS_SITE_DEFAULT = true

const MAX_COMMAND_SCAN_CHARS = 10_000

const GIT_STATUS_TIMEOUT_MS = 5_000

/**
 * Upstream resolves its destructive canonical ids through a shared command
 * canonicalizer this fork lacks, so they're matched directly. Tuned to
 * over-match: a spurious hit costs one `git status`, a miss loses the truth.
 */
const DESTRUCTIVE_BASH_PATTERNS: readonly RegExp[] = [
  // git reset --hard
  /\bgit\b[^\n;|&]*\breset\b[^\n;|&]*(?:--hard|--mixed\s+--hard)/i,
  // git checkout . / git checkout -- .
  /\bgit\b[^\n;|&]*\bcheckout\b[^\n;|&]*?(?:^|\s)(?:--\s+)?\.(?:\s|$)/i,
  // git restore . / git restore -- .
  /\bgit\b[^\n;|&]*\brestore\b[^\n;|&]*?(?:^|\s)(?:--\s+)?\.(?:\s|$)/i,
  // git clean -f, including bundled forms like -fdx
  /\bgit\b[^\n;|&]*\bclean\b[^\n;|&]*(?:--force|\s-[a-eg-z]*f)/i,
  // rm -r / -f, bundled or separate
  /\brm\b[^\n;|&]*\s-[a-zA-Z]*[rRf]/,
  /\brm\b[^\n;|&]*\s--(?:recursive|force)\b/,
]

const DESTRUCTIVE_POWERSHELL_PATTERNS: readonly RegExp[] = [
  /\bRemove-Item\b[^\n;|&]*-(?:Recurse|Force)\b/i,
  /\b(?:ri|rd|rmdir|del|erase)\b[^\n;|&]*-(?:Recurse|Force)\b/i,
  /\bClear-Content\b[^\n;|&]*[*?]/i,
]

export type AutoModeGitStatus =
  | { clean: true }
  | { staged: number; modified: number; untracked: number }

/** Env escape hatch first, so a suspected regression bisects without a rebuild. */
export function isGitStatusMetaEnabled(): boolean {
  const env =
    process.env.NOA_CLAUDE_AUTO_MODE_GIT_STATUS ??
    process.env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS
  if (isEnvTruthy(env)) return true
  if (isEnvDefinedFalsy(env)) return false

  const config = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_auto_mode_config',
    {} as { gitStatusType?: boolean },
  )
  if (typeof config?.gitStatusType === 'boolean') return config.gitStatusType
  return GIT_STATUS_SITE_DEFAULT
}

export function isUncommittedWorkDestructive(
  toolName: string,
  command: string,
): boolean {
  const scanned =
    command.length > MAX_COMMAND_SCAN_CHARS
      ? command.slice(0, MAX_COMMAND_SCAN_CHARS)
      : command
  const patterns =
    toolName === POWERSHELL_TOOL_NAME
      ? DESTRUCTIVE_POWERSHELL_PATTERNS
      : DESTRUCTIVE_BASH_PATTERNS
  return patterns.some(re => re.test(scanned))
}

/**
 * Port of upstream GFe. Column 1 is the index state and column 2 the worktree
 * state, except `??`, which is one untracked entry rather than one of each.
 */
export function countPorcelain(stdout: string): {
  staged: number
  modified: number
  untracked: number
} {
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of stdout.split('\n')) {
    if (line.length < 2) continue
    const index = line[0]
    const worktree = line[1]
    if (index === '?' && worktree === '?') {
      untracked++
      continue
    }
    if (index !== ' ' && index !== '?') staged++
    if (worktree !== ' ') modified++
  }
  return { staged, modified, untracked }
}

/** Null whenever no line should be emitted; the prompt treats every such case alike. */
export async function computeGitStatusMeta(
  toolName: string,
  input: unknown,
  abortSignal?: AbortSignal,
): Promise<AutoModeGitStatus | null> {
  try {
    if (!isGitStatusMetaEnabled()) return null
    if (toolName !== BASH_TOOL_NAME && toolName !== POWERSHELL_TOOL_NAME) {
      return null
    }
    if (
      input === null ||
      typeof input !== 'object' ||
      !('command' in input) ||
      typeof (input as { command?: unknown }).command !== 'string'
    ) {
      return null
    }
    const command = (input as { command: string }).command
    if (!isUncommittedWorkDestructive(toolName, command)) return null

    const cwd = getCwd()
    if (findGitRoot(cwd) === null) return null

    const result = await execFileNoThrowWithCwd(
      gitExe(),
      [
        '--no-optional-locks',
        'status',
        '--porcelain',
        '--untracked-files=normal',
      ],
      {
        cwd,
        abortSignal,
        timeout: GIT_STATUS_TIMEOUT_MS,
        preserveOutputOnError: false,
      },
    )
    if (result.code !== 0) return null

    const { staged, modified, untracked } = countPorcelain(result.stdout)
    if (staged === 0 && modified === 0 && untracked === 0) return { clean: true }
    return { staged, modified, untracked }
  } catch {
    return null
  }
}
