// @ts-nocheck
import chalk from 'chalk'
import * as React from 'react'
import { realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
  setOriginalCwd,
  setSessionTrustedDirectory,
  switchSession,
} from '../../bootstrap/state.js'
import { clearCommandsCache, type LocalJSXCommandContext } from '../../commands.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { MCPServerApprovalDialog } from '../../components/MCPServerApprovalDialog.js'
import { MCPServerMultiselectDialog } from '../../components/MCPServerMultiselectDialog.js'
import { getMcpConfigsByScope } from '../../services/mcp/config.js'
import { getProjectMcpServerStatus } from '../../services/mcp/utils.js'
import { clearSkillCaches } from '../../skills/loadSkillsDir.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  isPathTrusted,
  resetTrustDialogAcceptedCache,
  saveCurrentProjectConfig,
} from '../../utils/config.js'
import { clearMemoryFileCaches, getClaudeMds, getMemoryFiles } from '../../utils/claudemd.js'
import { getCwd } from '../../utils/cwd.js'
import { getErrnoCode } from '../../utils/errors.js'
import { findGitRoot } from '../../utils/git.js'
import { resetGitFileWatcher } from '../../utils/git/gitFilesystem.js'
import { wrapInSystemReminder } from '../../utils/messages.js'
import { expandPath } from '../../utils/path.js'
import { getPlansDirectory } from '../../utils/plans.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import {
  describeProjectDisclosures,
  hasGatedProjectGrants,
  isProjectGrantSourceGated,
} from '../../utils/permissions/projectGrants.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { invalidateSessionEnvCache } from '../../utils/sessionEnvironment.js'
import { relocateSessionTranscript } from '../../utils/sessionStorage.js'
import { parseSettingsFile } from '../../utils/settings/settings.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { setCwd } from '../../utils/Shell.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { UNSAFE_DISPLAY } from '../../utils/permissions/projectGrants.js'
import { syncProjectGrants } from '../../utils/permissions/projectGrantSync.js'
import { checkCdPermission, describeCdPermissionDenial } from './cdPermission.js'
import { CdTrustPrompt } from './CdTrustPrompt.js'

const bold = chalk.bold

// Control and bidi characters would let a path render as something else in
// the trust prompt, so such paths are not echoed.

const MISSING_DIRECTORY_ERRNOS = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']

const GRANTS_APPLIED_NOTE =
  'The user trusted this directory explicitly: its project permission rules and additional directories are now applied.'

type Target =
  | { result: 'not_found'; path: string }
  | { result: 'not_a_directory'; path: string; parent: string }
  | { result: 'same'; directory: string }
  | { result: 'blocked'; message: string }
  | { result: 'ok'; directory: string }

type MoveOutcome = {
  modelMessage: string
  /** The wrapped note about gated grants, matched verbatim when they are applied. */
  gatedNotice: string
  projectGrantsGated: boolean
  pendingServers: string[]
}

async function canonicalize(path: string): Promise<string> {
  try {
    return (await realpath(path)).normalize('NFC')
  } catch {
    return path
  }
}

async function resolveTarget(
  input: string,
  context: LocalJSXCommandContext,
): Promise<Target> {
  const path = resolve(expandPath(input))
  try {
    if (!(await stat(path)).isDirectory()) {
      return { result: 'not_a_directory', path, parent: dirname(path) }
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (!MISSING_DIRECTORY_ERRNOS.includes(code)) {
      logForDebugging(`/cd: unexpected stat errno ${code}`, { level: 'error' })
    }
    return { result: 'not_found', path }
  }

  const directory = await canonicalize(path)
  if (directory === getCwd() && directory === getOriginalCwd()) {
    return { result: 'same', directory }
  }
  const verdict = checkCdPermission(
    { requestedPath: path, canonicalPath: directory },
    context.getAppState().toolPermissionContext,
  )
  if (verdict.result !== 'allowed') {
    return {
      result: 'blocked',
      message: describeCdPermissionDenial(verdict, directory),
    }
  }
  return { result: 'ok', directory }
}

function trustRootFor(directory: string): string | undefined {
  const root = findGitRoot(directory)
  if (!root || root === directory || UNSAFE_DISPLAY.test(root)) return undefined
  return root
}

async function trustDirectory(directory: string): Promise<void> {
  try {
    // Home trust lasts for this session only; it is not persisted.
    if ((await canonicalize(homedir())) === (await canonicalize(directory))) {
      setSessionTrustedDirectory(directory)
      return
    }
    saveCurrentProjectConfig(
      currentConfig => ({ ...currentConfig, hasTrustDialogAccepted: true }),
      directory,
    )
  } catch (e) {
    logForDebugging(`/cd: persisting trust failed: ${e}`, { level: 'error' })
  }
}

/** Re-derives the project grants for `directory` once the user trusts it explicitly. */
function applyProjectGrants(directory: string, context: LocalJSXCommandContext): void {
  resetSettingsCache()
  context.setAppState(prev => ({
    ...prev,
    toolPermissionContext: syncProjectGrants(prev.toolPermissionContext, directory),
  }))
  settingsChangeDetector.notifyChange('projectSettings')
}

/**
 * Relocate the session to `target`: update the shell cwd (where Bash runs) and
 * originalCwd (the permission workspace + project anchor), physically move the
 * transcript to the new project directory, then clear cwd-dependent caches and
 * re-resolve project settings.
 *
 * The transcript move is rolled back transactionally: if it throws (which only
 * happens before the `.jsonl` is renamed), the working-directory state is
 * restored and the error rethrown so the caller reports it and stays put.
 */
async function relocate(target: string, context: LocalJSXCommandContext): Promise<MoveOutcome> {
  const oldCwd = getCwd()
  const oldOriginalCwd = getOriginalCwd()
  const oldProjectDirPin = getSessionProjectDir()
  const isFreshSession = context.messages.length === 0

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

  // Each cache below is keyed to the old project; clearing them makes the next
  // turn recompute with the new cwd, CLAUDE.md, settings, skills and commands.
  clearSystemPromptSections()
  clearMemoryFileCaches()
  getPlansDirectory.cache?.clear?.()
  invalidateSessionEnvCache()
  resetGitFileWatcher() // re-point the cached git branch/SHA watcher at the new repo
  SandboxManager.refreshConfig()
  resetSettingsCache()
  clearSkillCaches()
  clearCommandsCache()
  resetTrustDialogAcceptedCache()
  context.setAppState(prev => ({
    ...prev,
    toolPermissionContext: syncProjectGrants(prev.toolPermissionContext, oldOriginalCwd),
  }))
  settingsChangeDetector.notifyChange('projectSettings')

  if (isFreshSession) {
    return { modelMessage: '', gatedNotice: '', projectGrantsGated: false, pendingServers: [] }
  }
  // Noa rebuilds the system prompt every turn, so the environment block already
  // names the new directory; no "previous directory" sentence is needed.
  const notice = wrapInSystemReminder(
    `The session's working directory has changed to ${target} (via /cd). ` +
      `All tool calls and relative paths now resolve from ${target}. ` +
      `Project settings (permission rules, hooks), project MCP servers, and project skills now come from ${target}; its CLAUDE.md, if any, follows below. ` +
      `Environment variables set by the previous directory's settings stay in effect for this process — they cannot be unset — and the new directory's settings env is applied on top of them.`,
  )
  const projectGrantsGated = hasGatedProjectGrants()
  const gatedNotice = projectGrantsGated
    ? wrapInSystemReminder(
        `Note: ${target} declares project permission rules and/or additional directories in its settings, but they are NOT applied — the workspace is trusted only through a parent directory's grant, and project-scoped grants require trusting this directory explicitly. Tool calls those rules would have pre-approved will ask for permission.`,
      )
    : ''
  const memory = getClaudeMds(await getMemoryFiles())
  return {
    modelMessage: [notice, gatedNotice, memory].filter(Boolean).join('\n\n'),
    gatedNotice,
    projectGrantsGated,
    pendingServers: [],
  }
}

function collectPendingProjectMcpServers(): string[] {
  try {
    const { servers } = getMcpConfigsByScope('project')
    return Object.keys(servers).filter(
      name => getProjectMcpServerStatus(name) === 'pending',
    )
  } catch (e) {
    logForDebugging(`/cd: collecting the new directory's project MCP servers failed (continuing without approvals): ${e}`, { level: 'error' })
    return []
  }
}

async function moveTo(
  directory: string,
  context: LocalJSXCommandContext,
  onDone: LocalJSXCommandOnDone,
): Promise<MoveOutcome | null> {
  let outcome
  try {
    outcome = await relocate(directory, context)
  } catch (e) {
    logForDebugging(`/cd relocate failed: ${e}`, { level: 'error' })
    onDone(
      `Couldn't move to ${bold(directory)} — the directory may no longer exist, or the session couldn't be moved. Staying in ${bold(getCwd())}.`,
    )
    return null
  }
  return { ...outcome, pendingServers: collectPendingProjectMcpServers() }
}

async function finishMove(
  directory: string,
  modelMessage: string,
  context: LocalJSXCommandContext,
  onDone: LocalJSXCommandOnDone,
): Promise<void> {
  try {
    await refreshActivePlugins(context.setAppState)
  } catch (e) {
    logForDebugging(`/cd: refreshing plugins/MCP for the new directory failed (continuing): ${e}`, { level: 'error' })
  }
  onDone(`Moved to ${bold(directory)}`, {
    display: 'system',
    metaMessages: modelMessage ? [modelMessage] : [],
  })
}

/** The gated note is replaced once the user trusts the directory explicitly. */
function withGrantsApplied(outcome: MoveOutcome): string {
  if (outcome.gatedNotice === '') return outcome.modelMessage
  return outcome.modelMessage.replace(
    outcome.gatedNotice,
    wrapInSystemReminder(GRANTS_APPLIED_NOTE),
  )
}

function CdPendingMcpApprovals({ serverNames, onDone }) {
  if (serverNames.length === 1) {
    return <MCPServerApprovalDialog serverName={serverNames[0]} onDone={onDone} />
  }
  return <MCPServerMultiselectDialog serverNames={serverNames} onDone={onDone} />
}

/**
 * Runs the /cd prompts in order: the untrusted-directory prompt, then the
 * gated-grants prompt, then pending project MCP approvals, then the result.
 */
function CdFlow({ directory, initial, context, onDone }) {
  const [step, setStep] = React.useState(initial)
  const busy = React.useRef(false)
  const finished = React.useRef(false)

  React.useEffect(() => {
    if (step.kind !== 'settled') return
    const { outcome } = step
    if (outcome.projectGrantsGated || outcome.pendingServers.length > 0) return
    if (finished.current) return
    finished.current = true
    void finishMove(directory, outcome.modelMessage, context, onDone)
  }, [step])

  const finishWith = outcome => {
    if (outcome.pendingServers.length === 0) return
    if (finished.current) return
    finished.current = true
    void finishMove(directory, outcome.modelMessage, context, onDone)
  }

  if (step.kind === 'trust') {
    const confirmTrust = async () => {
      if (busy.current) return
      busy.current = true
      await trustDirectory(directory)
      const outcome = await moveTo(directory, context, onDone)
      if (outcome) setStep({ kind: 'settled', outcome })
    }
    return (
      <CdTrustPrompt
        directory={directory}
        trustRoot={trustRootFor(directory)}
        disclosures={describeProjectDisclosures(directory, false)}
        backstop={false}
        onConfirm={confirmTrust}
        onCancel={() => onDone(`Staying in ${bold(getCwd())}`)}
      />
    )
  }

  const { outcome } = step
  if (outcome.projectGrantsGated) {
    const decideGrants = async (apply: boolean) => {
      if (busy.current) return
      busy.current = true
      if (apply) {
        await trustDirectory(directory)
        applyProjectGrants(directory, context)
      }
      setStep({
        kind: 'settled',
        outcome: {
          ...outcome,
          modelMessage: apply ? withGrantsApplied(outcome) : outcome.modelMessage,
          projectGrantsGated: false,
        },
      })
    }
    return (
      <CdTrustPrompt
        directory={directory}
        trustRoot={trustRootFor(directory)}
        disclosures={describeProjectDisclosures(directory, true)}
        backstop
        onConfirm={() => decideGrants(true)}
        onCancel={() => decideGrants(false)}
      />
    )
  }
  if (outcome.pendingServers.length > 0) {
    return (
      <CdPendingMcpApprovals
        serverNames={outcome.pendingServers}
        onDone={() => finishWith(outcome)}
      />
    )
  }
  return null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const input = (args ?? '').trim()
  if (!input) {
    onDone('Usage: /cd <path>')
    return null
  }

  const target = await resolveTarget(input, context)
  switch (target.result) {
    case 'not_found':
      onDone(`Couldn't find a directory at ${bold(target.path)}.`)
      return null
    case 'not_a_directory':
      onDone(`${bold(target.path)} is not a directory. Did you mean ${bold(target.parent)}?`)
      return null
    case 'same':
      onDone(`Already in ${bold(target.directory)}.`)
      return null
    case 'blocked':
      onDone(target.message)
      return null
  }

  const { directory } = target
  if (!isPathTrusted(directory)) {
    return (
      <CdFlow directory={directory} initial={{ kind: 'trust' }} context={context} onDone={onDone} />
    )
  }
  const outcome = await moveTo(directory, context, onDone)
  if (!outcome) return null
  if (!outcome.projectGrantsGated && outcome.pendingServers.length === 0) {
    await finishMove(directory, outcome.modelMessage, context, onDone)
    return null
  }
  return (
    <CdFlow
      directory={directory}
      initial={{ kind: 'settled', outcome }}
      context={context}
      onDone={onDone}
    />
  )
}
