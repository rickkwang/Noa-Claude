// @ts-nocheck
import { sep } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import type { LogOption } from '../types/logs.js'
import { quote } from './bash/shellQuote.js'
import { getPreferredCliCommandName } from './commandName.js'
import { getSessionIdFromLog } from './sessionStorage.js'
import { normalizeDriveLetter } from './pathCase.js'

export type CrossProjectResumeResult =
  | {
      isCrossProject: false
    }
  | {
      isCrossProject: true
      isSameRepoWorktree: true
      projectPath: string
    }
  | {
      isCrossProject: true
      isSameRepoWorktree: false
      command: string
      projectPath: string
    }

/**
 * Check if a log is from a different project directory and determine
 * whether it's a related worktree or a completely different project.
 *
 * For same-repo worktrees, we can resume directly without requiring cd.
 * For different projects, we generate the cd command.
 */
export function checkCrossProjectResume(
  log: LogOption,
  showAllProjects: boolean,
  worktreePaths: string[],
): CrossProjectResumeResult {
  const currentCwd = normalizeDriveLetter(getOriginalCwd())

  if (!showAllProjects || !log.projectPath) {
    return { isCrossProject: false }
  }

  const normalizedProjectPath = normalizeDriveLetter(log.projectPath)
  if (normalizedProjectPath === currentCwd) {
    return { isCrossProject: false }
  }

  // Check if log.projectPath is under a worktree of the same repo.
  // worktreePaths are already drive-letter-normalized by getWorktreePaths.
  const isSameRepo = worktreePaths.some(
    wt =>
      normalizedProjectPath === wt ||
      normalizedProjectPath.startsWith(wt + sep),
  )

  if (isSameRepo) {
    return {
      isCrossProject: true,
      isSameRepoWorktree: true,
      projectPath: log.projectPath,
    }
  }

  // Different repo - generate cd command
  const sessionId = getSessionIdFromLog(log)
  const command = `cd ${quote([log.projectPath])} && ${getPreferredCliCommandName()} --resume ${sessionId}`
  return {
    isCrossProject: true,
    isSameRepoWorktree: false,
    command,
    projectPath: log.projectPath,
  }
}
