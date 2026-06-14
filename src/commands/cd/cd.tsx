// @ts-nocheck
import chalk from 'chalk'
import * as React from 'react'
import { realpath, stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
  setOriginalCwd,
  switchSession,
} from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { logForDebugging } from '../../utils/debug.js'
import { isPathTrusted, saveCurrentProjectConfig } from '../../utils/config.js'
import { clearMemoryFileCaches } from '../../utils/claudemd.js'
import { getCwd } from '../../utils/cwd.js'
import { getErrnoCode } from '../../utils/errors.js'
import { resetGitFileWatcher } from '../../utils/git/gitFilesystem.js'
import { expandPath } from '../../utils/path.js'
import { getPlansDirectory } from '../../utils/plans.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { relocateSessionTranscript } from '../../utils/sessionStorage.js'
import { invalidateSessionEnvCache } from '../../utils/sessionEnvironment.js'
import { setCwd } from '../../utils/Shell.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { CdConfirm } from './CdConfirm.js'

/**
 * Relocate the session to `target`. Mirrors Claude Code's MbO: update the
 * shell cwd (where Bash runs) and originalCwd (the permission workspace +
 * project anchor), physically move the transcript to the new project directory
 * (so `--resume` from there lists the session), then clear cwd-dependent caches
 * so env_info, memory, git branch, and plans recompute. Returns a
 * model-visible message noting the env block is now stale.
 *
 * The transcript move is rolled back transactionally: if it throws (which only
 * happens before the `.jsonl` is renamed), the working-directory state is
 * restored and the error rethrown so the caller reports it and stays put.
 */
async function relocate(target: string): Promise<string> {
  const oldCwd = getCwd()
  const oldOriginalCwd = getOriginalCwd()
  const oldProjectDirPin = getSessionProjectDir()

  // chdir first so a vanished target throws before any session state mutates.
  process.chdir(target)
  setCwd(target) // realpath-resolves, validates, then setCwdState
  setOriginalCwd(getCwd())
  // Un-pin sessionProjectDir (set on resumed/cross-project sessions) so the
  // transcript follows the new originalCwd — relocateSessionTranscript moves
  // the file to getProjectDir(getOriginalCwd()) to match.
  if (oldProjectDirPin !== null) {
    switchSession(getSessionId(), null)
  }

  try {
    await relocateSessionTranscript()
  } catch (e) {
    // The transcript file was not moved (relocate throws only before the
    // rename), so restore the prior working-directory state and rethrow.
    try {
      process.chdir(oldCwd)
      setCwd(oldCwd)
      setOriginalCwd(oldOriginalCwd)
      if (oldProjectDirPin !== null) {
        switchSession(getSessionId(), oldProjectDirPin)
      }
    } catch (rollbackError) {
      logForDebugging(`/cd rollback failed: ${rollbackError}`)
    }
    throw e
  }

  // env_info_simple + memory are cached system-prompt sections; clearing makes
  // the next turn recompute them with the new cwd / new CLAUDE.md (one-time
  // prompt-cache miss). Sandbox + git-branch watcher must re-point at the new
  // location too.
  clearSystemPromptSections()
  clearMemoryFileCaches()
  getPlansDirectory.cache?.clear?.()
  invalidateSessionEnvCache()
  resetGitFileWatcher() // re-point the cached git branch/SHA watcher at the new repo
  SandboxManager.refreshConfig()

  // Model-visible note. Unlike Claude Code (whose env block is fixed at
  // conversation start), noa rebuilds the system prompt each turn, so the
  // environment section already reflects the new directory next turn — this
  // just makes the change explicit immediately.
  const resolved = getCwd()
  return (
    `The session's working directory changed to ${resolved} (via /cd). ` +
    `Use it as the base for tool calls and relative paths.`
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  // No argument → home directory, like shell `cd`. expandPath turns '~' (and
  // '~/...') into the home dir; resolve() strips the trailing slash it can
  // leave on absolute inputs, matching /add-dir's path normalization.
  const input = (args ?? '').trim()
  const target = resolve(expandPath(input || '~'))

  // Validate the target exists and is a directory (single syscall).
  try {
    if (!(await stat(target)).isDirectory()) {
      onDone(
        `${chalk.bold(target)} is not a directory. Did you mean ${chalk.bold(dirname(target))}?`,
      )
      return null
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (
      code === 'ENOENT' ||
      code === 'ENOTDIR' ||
      code === 'EACCES' ||
      code === 'EPERM'
    ) {
      onDone(`Couldn't find a directory at ${chalk.bold(target)}.`)
      return null
    }
    throw e
  }

  // Resolve symlinks so the "already here" check and the move use the same
  // canonical path setCwd will land on. NFC-normalize to match getCwd()
  // (setCwdState normalizes); realpath() can return NFD on macOS APFS, which
  // would otherwise false-negative the "already here" check for Unicode paths.
  let canonical = target
  try {
    canonical = (await realpath(target)).normalize('NFC')
  } catch {
    canonical = target
  }

  if (canonical === getCwd()) {
    onDone(`Already in ${chalk.bold(canonical)}.`)
    return null
  }

  const move = async (): Promise<boolean> => {
    try {
      const metaMessage = await relocate(canonical)
      onDone(`Moved to ${chalk.bold(canonical)}`, {
        display: 'system',
        metaMessages: [metaMessage],
      })
      return true
    } catch (e: unknown) {
      logForDebugging(
        `/cd relocate failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      onDone(
        `Couldn't move to ${chalk.bold(canonical)} — the directory may no longer exist, or the session couldn't be moved. Staying in ${chalk.bold(getCwd())}.`,
      )
      return false
    }
  }

  // Trust gate: if the target (or an ancestor) is already trusted, move
  // immediately. Otherwise confirm, and on accept persist trust for the new
  // directory (mirrors Claude Code's untrusted-directory gate).
  if (isPathTrusted(canonical)) {
    await move()
    return null
  }

  return (
    <CdConfirm
      directory={canonical}
      onConfirm={async () => {
        if (await move()) {
          // After a successful move the new directory is the current project,
          // so this persists trust for it.
          try {
            saveCurrentProjectConfig(c => ({
              ...c,
              hasTrustDialogAccepted: true,
            }))
          } catch {
            // Trust persistence is best-effort; the move already succeeded.
          }
        }
      }}
      onCancel={() => onDone(`Staying in ${chalk.bold(getCwd())}`)}
    />
  )
}
