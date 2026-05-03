import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { dirname } from 'path'
import {
  getMainLoopModelOverride,
  getSessionId,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  setOriginalCwd,
  switchSession,
} from '../bootstrap/state.js'
import { clearSystemPromptSections } from '../constants/systemPromptSections.js'
import { COMMAND_ARGS_TAG, COMMAND_NAME_TAG } from '../constants/xml.js'
import { restoreCostStateForSession } from '../cost-tracker.js'
import type { AppState } from '../state/AppState.js'
import type { AgentColorName } from '../tools/AgentTool/agentColorManager.js'
import {
  type AgentDefinition,
  type AgentDefinitionsResult,
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '../tools/AgentTool/loadAgentsDir.js'
import { TODO_WRITE_TOOL_NAME } from '../tools/TodoWriteTool/constants.js'
import { asSessionId } from '../types/ids.js'
import type { ThreadGoal } from '../types/goal.js'
import type {
  AttributionSnapshotMessage,
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
  PersistedWorktreeSession,
} from '../types/logs.js'
import type { Message } from '../types/message.js'
import { renameRecordingForSession } from './asciicast.js'
import { clearMemoryFileCaches } from './claudemd.js'
import {
  type AttributionState,
  attributionRestoreStateFromLog,
  restoreAttributionStateFromSnapshots,
} from './commitAttribution.js'
import { updateSessionName } from './concurrentSessions.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import type { FileHistorySnapshot } from './fileHistory.js'
import { fileHistoryRestoreStateFromLog } from './fileHistory.js'
import { createSystemMessage, extractTag, getContentText } from './messages.js'
import { parseUserSpecifiedModel } from './model/model.js'
import { getPlansDirectory } from './plans.js'
import { setCwd } from './Shell.js'
import {
  adoptResumedSessionFile,
  recordContentReplacement,
  resetSessionFilePointer,
  restoreSessionMetadata,
  saveMode,
  saveWorktreeState,
} from './sessionStorage.js'
import { isTodoV2Enabled } from './tasks.js'
import type { TodoList } from './todo/types.js'
import { TodoListSchema } from './todo/types.js'
import type { ContentReplacementRecord } from './toolResultStorage.js'
import {
  getCurrentWorktreeSession,
  restoreWorktreeSession,
} from './worktree.js'

type ResumeResult = {
  messages?: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
}

type ToolUseBlock = {
  type: 'tool_use'
  name: string
  input: unknown
}

type GoalToolResult = {
  goal?: {
    objective?: unknown
    status?: unknown
    token_budget?: unknown
    tokens_used?: unknown
    time_used_seconds?: unknown
  } | null
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_use' &&
    'name' in block &&
    typeof block.name === 'string' &&
    'input' in block
  )
}

type ContextCollapsePersistModule = {
  restoreFromEntries: (
    commits: ContextCollapseCommitEntry[],
    snapshot?: ContextCollapseSnapshotEntry,
  ) => void
}

function loadContextCollapsePersist(): ContextCollapsePersistModule {
  return require('../services/contextCollapse/index.js') as ContextCollapsePersistModule
}

/**
 * Scan the transcript for the last TodoWrite tool_use block and return its todos.
 * Used to hydrate AppState.todos on SDK --resume so the model's todo list
 * survives session restarts without file persistence.
 */
function extractTodosFromTranscript(messages: Message[]): TodoList {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (
      msg?.type !== 'assistant' ||
      !msg.message ||
      typeof msg.message !== 'object' ||
      !('content' in msg.message) ||
      !Array.isArray(msg.message.content)
    ) {
      continue
    }
    const toolUse = msg.message.content.find(
      (block): block is ToolUseBlock =>
        isToolUseBlock(block) && block.name === TODO_WRITE_TOOL_NAME,
    )
    if (!toolUse) continue
    const input = toolUse.input
    if (input === null || typeof input !== 'object') return []
    const parsed = TodoListSchema().safeParse(
      (input as Record<string, unknown>).todos,
    )
    return parsed.success ? parsed.data : []
  }
  return []
}

function timestampMs(message: Message): number {
  const parsed = message.timestamp ? Date.parse(message.timestamp) : NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function parseGoalBudget(args: string): {
  objective: string
  tokenBudget: number | null
} | null {
  const budgetMatch = args.match(/--budget\s+(\d+)/)
  let tokenBudget: number | null = null
  let objective = args.trim()
  if (budgetMatch) {
    const parsed = parseInt(budgetMatch[1]!, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    tokenBudget = parsed
    objective = args.replace(/--budget\s+\d+/, '').trim()
  }
  if (!objective) return null
  return { objective, tokenBudget }
}

function applyGoalCommand(
  goal: ThreadGoal | undefined,
  args: string,
  now: number,
): ThreadGoal | undefined {
  const trimmed = args.trim()
  if (!trimmed) return goal
  const [sub] = trimmed.split(/\s+/)
  if (sub === 'pause') {
    return goal ? { ...goal, status: 'paused', updatedAt: now } : goal
  }
  if (sub === 'resume') {
    return goal ? { ...goal, status: 'active', updatedAt: now } : goal
  }
  if (sub === 'clear') return undefined

  const parsed = parseGoalBudget(trimmed)
  if (!parsed) return goal
  const { objective, tokenBudget } = parsed
  if (goal && goal.objective === objective && goal.status !== 'complete') {
    return {
      ...goal,
      status: 'active',
      tokenBudget: tokenBudget ?? goal.tokenBudget,
      updatedAt: now,
    }
  }
  return {
    objective,
    status: 'active',
    tokenBudget,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function applyGoalToolUse(
  goal: ThreadGoal | undefined,
  input: unknown,
  now: number,
): ThreadGoal | undefined {
  if (input === null || typeof input !== 'object') return goal
  const record = input as Record<string, unknown>
  if (record.operation === 'create_goal') {
    const objective =
      typeof record.objective === 'string' ? record.objective.trim() : ''
    if (!objective) return goal
    if (goal && goal.status !== 'complete') return goal
    const tokenBudget =
      typeof record.token_budget === 'number' &&
      Number.isInteger(record.token_budget) &&
      record.token_budget > 0
        ? record.token_budget
        : null
    return {
      objective,
      status: 'active',
      tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: now,
      updatedAt: now,
    }
  }
  if (record.operation === 'update_goal' && record.status === 'complete') {
    return goal ? { ...goal, status: 'complete', updatedAt: now } : goal
  }
  return goal
}

function applyGoalToolResult(
  goal: ThreadGoal | undefined,
  output: unknown,
  now: number,
): ThreadGoal | undefined {
  if (output === null || typeof output !== 'object') return goal
  const outputGoal = (output as GoalToolResult).goal
  if (!outputGoal) return goal
  if (
    typeof outputGoal.objective !== 'string' ||
    typeof outputGoal.status !== 'string'
  ) {
    return goal
  }
  return {
    objective: outputGoal.objective,
    status:
      outputGoal.status === 'active' ||
      outputGoal.status === 'paused' ||
      outputGoal.status === 'budget_limited' ||
      outputGoal.status === 'complete'
        ? outputGoal.status
        : (goal?.status ?? 'active'),
    tokenBudget:
      typeof outputGoal.token_budget === 'number'
        ? outputGoal.token_budget
        : null,
    tokensUsed:
      typeof outputGoal.tokens_used === 'number' ? outputGoal.tokens_used : 0,
    timeUsedSeconds:
      typeof outputGoal.time_used_seconds === 'number'
        ? outputGoal.time_used_seconds
        : 0,
    createdAt: goal?.createdAt ?? now,
    updatedAt: now,
  }
}

function extractGoalFromTranscript(messages: Message[]): ThreadGoal | undefined {
  let goal: ThreadGoal | undefined
  for (const message of messages) {
    const now = timestampMs(message)
    if (message.type === 'system' && message.subtype === 'local_command') {
      const content = typeof message.content === 'string' ? message.content : ''
      const commandName = extractTag(content, COMMAND_NAME_TAG)
      if (commandName === '/goal') {
        goal = applyGoalCommand(
          goal,
          extractTag(content, COMMAND_ARGS_TAG) ?? '',
          now,
        )
      }
      continue
    }

    if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (isToolUseBlock(block) && block.name === 'goal') {
          goal = applyGoalToolUse(goal, block.input, now)
        }
      }
      continue
    }

    if (message.type === 'user') {
      goal = applyGoalToolResult(goal, message.toolUseResult, now)
      if (!Array.isArray(message.message?.content)) continue
      const text = getContentText(message.message.content)
      if (!text) continue
      try {
        goal = applyGoalToolResult(goal, JSON.parse(text), now)
      } catch {
        // Older goal tool results were plain text; the tool_use replay above
        // still restores the objective/status for those sessions.
      }
    }
  }
  return goal
}

/**
 * Restore session state (file history, attribution, todos) from log on resume.
 * Used by both SDK (print.ts) and interactive (REPL.tsx, main.tsx) resume paths.
 */
export function restoreSessionStateFromLog(
  result: ResumeResult,
  setAppState: (f: (prev: AppState) => AppState) => void,
): void {
  // Restore file history state
  if (result.fileHistorySnapshots && result.fileHistorySnapshots.length > 0) {
    try {
      fileHistoryRestoreStateFromLog(result.fileHistorySnapshots, newState => {
        setAppState(prev => ({ ...prev, fileHistory: newState }))
      })
    } catch (error) {
      logForDebugging(
        `Skipping file history restore due to malformed snapshot data: ${String(error)}`,
      )
    }
  }

  // Restore attribution state (ant-only feature)
  if (
    feature('COMMIT_ATTRIBUTION') &&
    result.attributionSnapshots &&
    result.attributionSnapshots.length > 0
  ) {
    try {
      attributionRestoreStateFromLog(result.attributionSnapshots, newState => {
        setAppState(prev => ({ ...prev, attribution: newState }))
      })
    } catch (error) {
      logForDebugging(
        `Skipping attribution restore due to malformed snapshot data: ${String(error)}`,
      )
    }
  }

  // Restore context-collapse commit log + staged snapshot. Must run before
  // the first query() so projectView() can rebuild the collapsed view from
  // the resumed Message[]. Called unconditionally (even with
  // undefined/empty entries) because restoreFromEntries resets the store
  // first — without that, an in-session /resume into a session with no
  // commits would leave the prior session's stale commit log intact.
  if (feature('CONTEXT_COLLAPSE')) {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      loadContextCollapsePersist().restoreFromEntries(
        result.contextCollapseCommits ?? [],
        result.contextCollapseSnapshot,
      )
      /* eslint-enable @typescript-eslint/no-require-imports */
    } catch (error) {
      logForDebugging(
        `Skipping context-collapse restore due to malformed session data: ${String(error)}`,
      )
    }
  }

  // Restore TodoWrite state from transcript (SDK/non-interactive only).
  // Interactive mode uses file-backed v2 tasks, so AppState.todos is unused there.
  if (!isTodoV2Enabled() && result.messages && result.messages.length > 0) {
    const todos = extractTodosFromTranscript(result.messages)
    if (todos.length > 0) {
      const agentId = getSessionId()
      setAppState(prev => ({
        ...prev,
        todos: { ...prev.todos, [agentId]: todos },
      }))
    }
  }

  if (result.messages && result.messages.length > 0) {
    const goal = extractGoalFromTranscript(result.messages)
    setAppState(prev => ({ ...prev, goal }))
  }
}

/**
 * Compute restored attribution state from log snapshots.
 * Used for computing initial state before render (e.g., main.tsx --continue).
 * Returns undefined if attribution feature is disabled or no snapshots exist.
 */
export function computeRestoredAttributionState(
  result: ResumeResult,
): AttributionState | undefined {
  if (
    feature('COMMIT_ATTRIBUTION') &&
    result.attributionSnapshots &&
    result.attributionSnapshots.length > 0
  ) {
    return restoreAttributionStateFromSnapshots(result.attributionSnapshots)
  }
  return undefined
}

/**
 * Compute standalone agent context (name/color) for session resume.
 * Used for computing initial state before render (per CLAUDE.md guidelines).
 * Returns undefined if no name/color is set on the session.
 */
export function computeStandaloneAgentContext(
  agentName: string | undefined,
  agentColor: string | undefined,
): AppState['standaloneAgentContext'] | undefined {
  if (!agentName && !agentColor) {
    return undefined
  }
  return {
    name: agentName ?? '',
    color: (agentColor === 'default' ? undefined : agentColor) as
      | AgentColorName
      | undefined,
  }
}

/**
 * Restore agent setting from a resumed session.
 *
 * When resuming a conversation that used a custom agent, this re-applies the
 * agent type and model override (unless the user specified --agent on the CLI).
 * Mutates bootstrap state via setMainThreadAgentType / setMainLoopModelOverride.
 *
 * Returns the restored agent definition and its agentType string, or undefined
 * if no agent was restored.
 */
export function restoreAgentFromSession(
  agentSetting: string | undefined,
  currentAgentDefinition: AgentDefinition | undefined,
  agentDefinitions: AgentDefinitionsResult,
): {
  agentDefinition: AgentDefinition | undefined
  agentType: string | undefined
} {
  // If user already specified --agent on CLI, keep that definition
  if (currentAgentDefinition) {
    return { agentDefinition: currentAgentDefinition, agentType: undefined }
  }

  // If session had no agent, clear any stale bootstrap state
  if (!agentSetting) {
    setMainThreadAgentType(undefined)
    return { agentDefinition: undefined, agentType: undefined }
  }

  const resumedAgent = agentDefinitions.activeAgents.find(
    agent => agent.agentType === agentSetting,
  )
  if (!resumedAgent) {
    logForDebugging(
      `Resumed session had agent "${agentSetting}" but it is no longer available. Using default behavior.`,
    )
    setMainThreadAgentType(undefined)
    return { agentDefinition: undefined, agentType: undefined }
  }

  setMainThreadAgentType(resumedAgent.agentType)

  // Apply agent's model if user didn't specify one
  if (
    !getMainLoopModelOverride() &&
    resumedAgent.model &&
    resumedAgent.model !== 'inherit'
  ) {
    setMainLoopModelOverride(parseUserSpecifiedModel(resumedAgent.model))
  }

  return { agentDefinition: resumedAgent, agentType: resumedAgent.agentType }
}

/**
 * Refresh agent definitions after a coordinator/normal mode switch.
 *
 * When resuming a session that was in a different mode (coordinator vs normal),
 * the built-in agents need to be re-derived to match the new mode. CLI-provided
 * agents (from --agents flag) are merged back in.
 */
export async function refreshAgentDefinitionsForModeSwitch(
  modeWasSwitched: boolean,
  currentCwd: string,
  cliAgents: AgentDefinition[],
  currentAgentDefinitions: AgentDefinitionsResult,
): Promise<AgentDefinitionsResult> {
  if (!feature('COORDINATOR_MODE') || !modeWasSwitched) {
    return currentAgentDefinitions
  }

  // Re-derive agent definitions after mode switch so built-in agents
  // reflect the new coordinator/normal mode
  getAgentDefinitionsWithOverrides.cache.clear?.()
  const freshAgentDefs = await getAgentDefinitionsWithOverrides(currentCwd)
  const freshAllAgents = [...freshAgentDefs.allAgents, ...cliAgents]
  return {
    ...freshAgentDefs,
    allAgents: freshAllAgents,
    activeAgents: getActiveAgentsFromList(freshAllAgents),
  }
}

/**
 * Result of processing a resumed/continued conversation for rendering.
 */
export type ProcessedResume = {
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  contentReplacements?: ContentReplacementRecord[]
  agentName: string | undefined
  agentColor: AgentColorName | undefined
  restoredAgentDef: AgentDefinition | undefined
  initialState: AppState
}

/**
 * Subset of the coordinator mode module API needed for session resume.
 */
type CoordinatorModeApi = {
  matchSessionMode(mode?: string): string | undefined
  isCoordinatorMode(): boolean
}

/**
 * The loaded conversation data (return type of loadConversationForResume).
 */
type ResumeLoadResult = {
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
  sessionId: UUID | undefined
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  tag?: string
  mode?: 'coordinator' | 'normal'
  worktreeSession?: PersistedWorktreeSession | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
}

/**
 * Restore the worktree working directory on resume. The transcript records
 * the last worktree enter/exit; if the session crashed while inside a
 * worktree (last entry = session object, not null), cd back into it.
 *
 * process.chdir is the TOCTOU-safe existence check — it throws ENOENT if
 * the /exit dialog removed the directory, or if the user deleted it
 * manually between sessions.
 *
 * When --worktree already created a fresh worktree, that takes precedence
 * over the resumed session's state. restoreSessionMetadata just overwrote
 * project.currentSessionWorktree with the stale transcript value, so
 * re-assert the fresh worktree here before adoptResumedSessionFile writes
 * it back to disk.
 */
export function restoreWorktreeForResume(
  worktreeSession: PersistedWorktreeSession | null | undefined,
): void {
  const fresh = getCurrentWorktreeSession()
  if (fresh) {
    saveWorktreeState(fresh)
    return
  }
  if (!worktreeSession) return

  try {
    process.chdir(worktreeSession.worktreePath)
  } catch {
    // Directory is gone. Override the stale cache so the next
    // reAppendSessionMetadata records "exited" instead of re-persisting
    // a path that no longer exists.
    saveWorktreeState(null)
    return
  }

  setCwd(worktreeSession.worktreePath)
  setOriginalCwd(getCwd())
  // projectRoot is intentionally NOT set here. The transcript doesn't record
  // whether the worktree was entered via --worktree (which sets projectRoot)
  // or EnterWorktreeTool (which doesn't). Leaving projectRoot stable matches
  // EnterWorktreeTool's behavior — skills/history stay anchored to the
  // original project.
  restoreWorktreeSession(worktreeSession)
  // The /resume slash command calls this mid-session after caches have been
  // populated against the old cwd. Cheap no-ops for the CLI-flag path
  // (caches aren't populated yet there).
  clearMemoryFileCaches()
  clearSystemPromptSections()
  getPlansDirectory.cache.clear?.()
}

/**
 * Undo restoreWorktreeForResume before a mid-session /resume switches to
 * another session. Without this, /resume from a worktree session to a
 * non-worktree session leaves the user in the old worktree directory with
 * currentWorktreeSession still pointing at the prior session. /resume to a
 * *different* worktree fails entirely — the getCurrentWorktreeSession()
 * guard above blocks the switch.
 *
 * Not needed by CLI --resume/--continue: those run once at startup where
 * getCurrentWorktreeSession() is only truthy if --worktree was used (fresh
 * worktree that should take precedence, handled by the re-assert above).
 */
export function exitRestoredWorktree(): void {
  const current = getCurrentWorktreeSession()
  if (!current) return

  restoreWorktreeSession(null)
  // Worktree state changed, so cached prompt sections that reference it are
  // stale whether or not chdir succeeds below.
  clearMemoryFileCaches()
  clearSystemPromptSections()
  getPlansDirectory.cache.clear?.()

  try {
    process.chdir(current.originalCwd)
  } catch {
    // Original dir is gone (rare). Stay put — restoreWorktreeForResume
    // will cd into the target worktree next if there is one.
    return
  }
  setCwd(current.originalCwd)
  setOriginalCwd(getCwd())
}

/**
 * Process a loaded conversation for resume/continue.
 *
 * Handles coordinator mode matching, session ID setup, agent restoration,
 * mode persistence, and initial state computation. Called by both --continue
 * and --resume paths in main.tsx.
 */
export async function processResumedConversation(
  result: ResumeLoadResult,
  opts: {
    forkSession: boolean
    sessionIdOverride?: string
    transcriptPath?: string
    includeAttribution?: boolean
  },
  context: {
    modeApi: CoordinatorModeApi | null
    mainThreadAgentDefinition: AgentDefinition | undefined
    agentDefinitions: AgentDefinitionsResult
    currentCwd: string
    cliAgents: AgentDefinition[]
    initialState: AppState
  },
): Promise<ProcessedResume> {
  // Match coordinator/normal mode to the resumed session
  let modeWarning: string | undefined
  if (feature('COORDINATOR_MODE')) {
    modeWarning = context.modeApi?.matchSessionMode(result.mode)
    if (modeWarning) {
      result.messages.push(createSystemMessage(modeWarning, 'warning'))
    }
  }

  // Reuse the resumed session's ID unless --fork-session is specified
  if (!opts.forkSession) {
    const sid = opts.sessionIdOverride ?? result.sessionId
    if (sid) {
      // When resuming from a different project directory (git worktrees,
      // cross-project), transcriptPath points to the actual file; its dirname
      // is the project dir. Otherwise the session lives in the current project.
      switchSession(
        asSessionId(sid),
        opts.transcriptPath ? dirname(opts.transcriptPath) : null,
      )
      // Rename asciicast recording to match the resumed session ID so
      // getSessionRecordingPaths() can discover it during /share
      await renameRecordingForSession()
      await resetSessionFilePointer()
      restoreCostStateForSession(sid)
    }
  } else if (result.contentReplacements?.length) {
    // --fork-session keeps the fresh startup session ID. useLogMessages will
    // copy source messages into the new JSONL via recordTranscript, but
    // content-replacement entries are a separate entry type only written by
    // recordContentReplacement (which query.ts calls for newlyReplaced, never
    // the pre-loaded records). Without this seed, `claude-agent --resume {newSessionId}`
    // finds source tool_use_ids in messages but no matching replacement records
    // → they're classified as FROZEN → full content sent (cache miss, permanent
    // overage). insertContentReplacement stamps sessionId = getSessionId() =
    // the fresh ID, so loadTranscriptFile's keyed lookup will match.
    await recordContentReplacement(result.contentReplacements)
  }

  // Restore session metadata so /status shows the saved name and metadata
  // is re-appended on session exit. Fork doesn't take ownership of the
  // original session's worktree — a "Remove" on the fork's exit dialog
  // would delete a worktree the original session still references — so
  // strip worktreeSession from the fork path so the cache stays unset.
  restoreSessionMetadata(
    opts.forkSession ? { ...result, worktreeSession: undefined } : result,
  )

  if (!opts.forkSession) {
    // Cd back into the worktree the session was in when it last exited.
    // Done after restoreSessionMetadata (which caches the worktree state
    // from the transcript) so if the directory is gone we can override
    // the cache before adoptResumedSessionFile writes it.
    restoreWorktreeForResume(result.worktreeSession)

    // Point sessionFile at the resumed transcript and re-append metadata
    // now. resetSessionFilePointer above nulled it (so the old fresh-session
    // path doesn't leak), but that blocks reAppendSessionMetadata — which
    // bails on null — from running in the exit cleanup handler. For fork,
    // useLogMessages populates a *new* file via recordTranscript on REPL
    // mount; the normal lazy-materialize path is correct there.
    adoptResumedSessionFile()
  }

  // Restore context-collapse commit log + staged snapshot. The interactive
  // /resume path goes through restoreSessionStateFromLog (REPL.tsx); CLI
  // --continue/--resume goes through here instead. Called unconditionally
  // — see the restoreSessionStateFromLog callsite above for why.
  if (feature('CONTEXT_COLLAPSE')) {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      loadContextCollapsePersist().restoreFromEntries(
        result.contextCollapseCommits ?? [],
        result.contextCollapseSnapshot,
      )
      /* eslint-enable @typescript-eslint/no-require-imports */
    } catch (error) {
      logForDebugging(
        `Skipping context-collapse restore during processResumedConversation: ${String(error)}`,
      )
    }
  }

  // Restore agent setting from resumed session
  const { agentDefinition: restoredAgent, agentType: resumedAgentType } =
    restoreAgentFromSession(
      result.agentSetting,
      context.mainThreadAgentDefinition,
      context.agentDefinitions,
    )

  // Persist the current mode so future resumes know what mode this session was in
  if (feature('COORDINATOR_MODE')) {
    saveMode(context.modeApi?.isCoordinatorMode() ? 'coordinator' : 'normal')
  }

  // Compute initial state before render (per CLAUDE.md guidelines)
  const restoredAttribution = opts.includeAttribution
    ? computeRestoredAttributionState(result)
    : undefined
  const standaloneAgentContext = computeStandaloneAgentContext(
    result.agentName,
    result.agentColor,
  )
  void updateSessionName(result.agentName)
  const refreshedAgentDefs = await refreshAgentDefinitionsForModeSwitch(
    !!modeWarning,
    context.currentCwd,
    context.cliAgents,
    context.agentDefinitions,
  )

  return {
    messages: result.messages,
    fileHistorySnapshots: result.fileHistorySnapshots,
    contentReplacements: result.contentReplacements,
    agentName: result.agentName,
    agentColor: (result.agentColor === 'default'
      ? undefined
      : result.agentColor) as AgentColorName | undefined,
    restoredAgentDef: restoredAgent,
    initialState: {
      ...context.initialState,
      ...(resumedAgentType && { agent: resumedAgentType }),
      ...(restoredAttribution && { attribution: restoredAttribution }),
      ...(standaloneAgentContext && { standaloneAgentContext }),
      agentDefinitions: refreshedAgentDefs,
    },
  }
}
