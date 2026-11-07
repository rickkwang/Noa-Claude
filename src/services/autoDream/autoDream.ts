// @ts-nocheck
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
// Background memory consolidation. Fires the /dream prompt as a forked
// subagent when time-gate passes AND enough sessions have accumulated.
//
// Gate order (cheapest first):
//   1. Time: hours since lastConsolidatedAt >= minHours (one stat)
//   2. Sessions: transcript count with mtime > lastConsolidatedAt >= minSessions
//   3. Lock: no other process mid-consolidation
//
// State is closure-scoped inside initAutoDream() rather than module-level
// (tests call initAutoDream() in beforeEach for a fresh closure).

import { join, resolve, sep } from 'path'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  createUserMessage,
  createMemorySavedMessage,
  createSystemMessage,
} from '../../utils/messages.js'
import {
  checkRuleBasedPermissions,
  getAskRuleForTool,
  getDenyRuleForTool,
} from '../../utils/permissions/permissions.js'
import { matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import type { ToolUseContext } from '../../Tool.js'
import { logEvent } from '../analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { isAutoMemoryEnabled, getAutoMemPath } from '../../memdir/paths.js'
import { isAutoDreamEnabled, getAutoDreamModel } from './config.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import {
  getOriginalCwd,
  getKairosActive,
  getIsRemoteMode,
  getSessionId,
} from '../../bootstrap/state.js'
import { createAutoMemCanUseTool } from '../extractMemories/extractMemories.js'
import { ENTRYPOINT_NAME } from '../../memdir/memdir.js'
import { isTeamMemoryEnabled } from '../../memdir/teamMemPaths.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { buildConsolidationPrompt } from './consolidationPrompt.js'
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
} from './consolidationLock.js'
import {
  registerDreamTask,
  addDreamTurn,
  completeDreamTask,
  failDreamTask,
  isDreamTask,
} from '../../tasks/DreamTask/DreamTask.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// Cap on session ids embedded in the prompt. Header still shows the true
// count; this only bounds the inline bullet list to keep prompt size sane
// under heavy use.
const MAX_SESSION_IDS_IN_PROMPT = 30

// Dream may delete top-level topic files with `rm -f`; everything else in Bash
// stays read-only. Returns the command rewritten to absolute paths, because
// Bash runs in the project cwd and a bare `rm x.md` could hit a project file.
const DREAM_DELETABLE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/

export function rewriteDreamDeleteCommand(
  command: unknown,
  memoryRoot: string,
): string | null {
  if (typeof command !== 'string') return null
  const [cmd, ...args] = command.trim().split(/\s+/)
  if (cmd !== 'rm') return null
  const names = args[0] === '-f' ? args.slice(1) : args
  if (names.length === 0) return null
  for (const name of names) {
    if (!DREAM_DELETABLE_FILE.test(name) || name === ENTRYPOINT_NAME) {
      return null
    }
  }
  const quoted = names.map(
    name => `'${join(memoryRoot, name).replace(/'/g, `'\\''`)}'`,
  )
  return `rm -f -- ${quoted.join(' ')}`
}

// Same entrypoints upstream never runs dream in: SDK and headless `-p` hosts.
const DREAM_BLOCKED_ENTRYPOINTS = new Set(['sdk-ts', 'sdk-py', 'sdk-cli'])

export function dreamEntrypointBlocked(
  entrypoint: string | undefined,
): boolean {
  return entrypoint !== undefined && DREAM_BLOCKED_ENTRYPOINTS.has(entrypoint)
}

// A deny/ask rule on Edit/Write (whole tool, or the memory directory by path)
// would make the dream stall or fail headless, so the run is skipped instead.
export function findDreamWriteBlockRule(
  permissionContext,
  memoryRoot: string,
) {
  const tools = [{ name: FILE_EDIT_TOOL_NAME }, { name: FILE_WRITE_TOOL_NAME }]
  for (const tool of tools) {
    const rule =
      getDenyRuleForTool(permissionContext, tool) ??
      getAskRuleForTool(permissionContext, tool)
    if (rule) return rule
  }
  const probe = join(memoryRoot, ENTRYPOINT_NAME)
  return (
    matchingRuleForInput(probe, permissionContext, 'edit', 'deny') ??
    matchingRuleForInput(probe, permissionContext, 'edit', 'ask')
  )
}

// Reads outside the working directory are blocked when the user set
// permissions.blockReadsOutsideWorkingDirectories. The dream still needs its
// memory directory and the project's transcripts, which live outside cwd.
const READ_PATH_KEY: Record<string, string> = {
  [FILE_READ_TOOL_NAME]: 'file_path',
  [GREP_TOOL_NAME]: 'path',
  [GLOB_TOOL_NAME]: 'path',
}

function isOutsideAllowedReadRoots(
  tool,
  input,
  memoryRoot: string,
  transcriptDir: string,
): boolean {
  const key = READ_PATH_KEY[tool.name]
  const target = key ? input[key] : undefined
  if (typeof target !== 'string') return false
  const abs = resolve(getOriginalCwd(), target)
  return ![getOriginalCwd(), memoryRoot, transcriptDir].some(
    root => abs === resolve(root) || abs.startsWith(resolve(root) + sep),
  )
}

export function createDreamCanUseTool(memoryRoot: string, toolUseContext) {
  const baseCanUseTool = createAutoMemCanUseTool(memoryRoot)
  return async (tool, input, ...rest) => {
    // /pause-memory (or a settings change) mid-run: stop writing. Checked per
    // call, not only at gate time, so an in-flight dream stops too.
    if (!isAutoMemoryEnabled()) {
      return {
        behavior: 'deny' as const,
        message: 'auto-memory was paused during this dream; the call is denied',
        decisionReason: { type: 'other' as const, reason: 'memory_paused' },
      }
    }
    // A PreToolUse hook asked for confirmation. Headless there is no one to
    // answer, and the memory allow-list must not override the hook.
    const forceDecision = rest[3]
    if (forceDecision !== undefined) {
      return {
        behavior: 'deny' as const,
        message:
          'a PreToolUse hook requires confirmation for this call, and the memory agent runs headless with no user to answer — the call is denied',
        decisionReason: { type: 'other' as const, reason: 'hook_ask' },
      }
    }
    // Rewrite before the rule check, so deny/ask rules see the command that
    // will actually run.
    const rewrittenCommand =
      tool.name === BASH_TOOL_NAME
        ? rewriteDreamDeleteCommand(input.command, memoryRoot)
        : null
    const effectiveInput =
      rewrittenCommand !== null
        ? { ...input, command: rewrittenCommand }
        : input
    // User deny/ask rules apply to every call; headless, an ask can only be denied.
    let ruleDecision
    try {
      ruleDecision = await checkRuleBasedPermissions(
        tool,
        effectiveInput,
        toolUseContext,
      )
    } catch (e: unknown) {
      logForDebugging(`[autoDream] rule check failed: ${(e as Error).message}`)
      return {
        behavior: 'deny' as const,
        message: 'could not evaluate permission rules; failing closed',
        decisionReason: { type: 'other' as const, reason: 'rule_check_failed' },
      }
    }
    if (ruleDecision) {
      return {
        behavior: 'deny' as const,
        message: ruleDecision.message,
        decisionReason: ruleDecision.decisionReason,
      }
    }
    const blocksOutsideReads =
      toolUseContext.getAppState().toolPermissionContext
        .blockReadsOutsideWorkingDirectories === true
    if (
      blocksOutsideReads &&
      isOutsideAllowedReadRoots(
        tool,
        input,
        memoryRoot,
        getProjectDir(getOriginalCwd()),
      )
    ) {
      return {
        behavior: 'deny' as const,
        message:
          'reads outside the working directory are blocked (permissions.blockReadsOutsideWorkingDirectories)',
        decisionReason: { type: 'other' as const, reason: 'read_block' },
      }
    }
    if (rewrittenCommand !== null) {
      return { behavior: 'allow' as const, updatedInput: effectiveInput }
    }
    return baseCanUseTool(tool, input, ...rest)
  }
}

type AutoDreamConfig = {
  minHours: number
  minSessions: number
  // Scan throttle: when time-gate passes but session-gate doesn't, the lock
  // mtime doesn't advance, so the time-gate keeps passing every turn.
  scanIntervalMs: number
}

const DEFAULTS: AutoDreamConfig = {
  minHours: 24,
  minSessions: 5,
  scanIntervalMs: 10 * 60 * 1000,
}

/**
 * Thresholds from tengu_onyx_plover. The enabled gate lives in config.ts
 * (isAutoDreamEnabled); this returns only the scheduling knobs. Defensive
 * per-field validation since GB cache can return stale wrong-type values.
 */
function getConfig(): AutoDreamConfig {
  const raw =
    getFeatureValue_CACHED_MAY_BE_STALE<Partial<AutoDreamConfig> | null>(
      'tengu_onyx_plover',
      null,
    )
  return {
    minHours:
      typeof raw?.minHours === 'number' &&
      Number.isFinite(raw.minHours) &&
      raw.minHours > 0
        ? raw.minHours
        : DEFAULTS.minHours,
    minSessions:
      typeof raw?.minSessions === 'number' &&
      Number.isFinite(raw.minSessions) &&
      raw.minSessions > 0
        ? raw.minSessions
        : DEFAULTS.minSessions,
    scanIntervalMs:
      typeof raw?.scanIntervalMs === 'number' &&
      Number.isFinite(raw.scanIntervalMs) &&
      raw.scanIntervalMs > 0
        ? raw.scanIntervalMs
        : DEFAULTS.scanIntervalMs,
  }
}

function isGateOpen(): boolean {
  if (getKairosActive()) return false // KAIROS mode uses disk-skill dream
  if (getIsRemoteMode()) return false
  if (dreamEntrypointBlocked(process.env.CLAUDE_CODE_ENTRYPOINT)) return false
  if (!isAutoMemoryEnabled()) return false
  return isAutoDreamEnabled()
}

// Dev override gated on NOA_AUTODREAM_FORCE. Bypasses enabled/time/session
// gates but NOT the lock (so repeated turns don't pile up dreams) or the
// memory-dir precondition. Still scans sessions so the prompt's
// session-hint is populated.
function isForced(): boolean {
  return isEnvTruthy(process.env.NOA_AUTODREAM_FORCE)
}

type AppendSystemMessageFn = NonNullable<ToolUseContext['appendSystemMessage']>

let runner:
  | ((
      context: REPLHookContext,
      appendSystemMessage?: AppendSystemMessageFn,
    ) => Promise<void>)
  | null = null

// Flags stale runner instances so they exit early. When initAutoDream()
// is called again (e.g., test setup), the old runner's async operations will
// see this flag and bail out before calling setAppState on a stale closure.
let isRunnerStaleRef = { current: false }

/**
 * Call once at startup (from backgroundHousekeeping alongside
 * initExtractMemories), or per-test in beforeEach for a fresh closure.
 */
export function initAutoDream(): void {
  // Mark any existing runner as stale so its async operations exit early
  // instead of calling setAppState on a now-orphaned closure.
  isRunnerStaleRef.current = true

  let lastSessionScanAt = 0
  let permissionNoticeShown = false

  runner = async function runAutoDream(context, appendSystemMessage) {
    // If this runner was superseded by a newer initAutoDream call, bail out.
    // The newer runner holds the fresh closure for setAppState.
    if (isRunnerStaleRef.current) {
      isRunnerStaleRef.current = false
      return
    }
    const cfg = getConfig()
    const force = isForced()
    if (!force && !isGateOpen()) return

    // --- Time gate ---
    let lastAt: number
    try {
      lastAt = await readLastConsolidatedAt()
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] readLastConsolidatedAt failed: ${(e as Error).message}`,
      )
      return
    }
    const hoursSince = (Date.now() - lastAt) / 3_600_000
    if (!force && hoursSince < cfg.minHours) return

    // --- Scan throttle ---
    const sinceScanMs = Date.now() - lastSessionScanAt
    if (!force && sinceScanMs < cfg.scanIntervalMs) {
      logForDebugging(
        `[autoDream] scan throttle — time-gate passed but last scan was ${Math.round(sinceScanMs / 1000)}s ago`,
      )
      return
    }
    lastSessionScanAt = Date.now()

    // --- Session gate ---
    let sessionIds: string[]
    try {
      sessionIds = await listSessionsTouchedSince(lastAt)
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] listSessionsTouchedSince failed: ${(e as Error).message}`,
      )
      return
    }
    // Exclude the current session (its mtime is always recent).
    const currentSession = getSessionId()
    sessionIds = sessionIds.filter(id => id !== currentSession)
    if (!force && sessionIds.length < cfg.minSessions) {
      logForDebugging(
        `[autoDream] skip — ${sessionIds.length} sessions since last consolidation, need ${cfg.minSessions}`,
      )
      return
    }

    // --- Permission gate ---
    // Checked before the lock so a skipped run never stamps lastConsolidatedAt.
    const blockRule = findDreamWriteBlockRule(
      context.toolUseContext.getAppState().toolPermissionContext,
      getAutoMemPath(),
    )
    if (blockRule) {
      logForDebugging(
        '[autoDream] skip — a permission rule blocks memory writes',
      )
      logEvent('tengu_auto_dream_skipped', { reason: 'permission_rule' })
      if (appendSystemMessage && !permissionNoticeShown) {
        permissionNoticeShown = true
        appendSystemMessage(
          createSystemMessage(
            'Auto-dream skipped: a permission rule blocks writes to the memory directory.',
            'warning',
          ),
        )
      }
      return
    }

    // --- Lock ---
    // Under force, skip acquire entirely — use the existing mtime so
    // kill's rollback is a no-op (rewinds to where it already is).
    // The lock file stays untouched; next non-force turn sees it as-is.
    let priorMtime: number | null
    if (force) {
      priorMtime = lastAt
    } else {
      try {
        priorMtime = await tryAcquireConsolidationLock()
      } catch (e: unknown) {
        logForDebugging(
          `[autoDream] lock acquire failed: ${(e as Error).message}`,
        )
        return
      }
      if (priorMtime === null) return
    }

    logForDebugging(
      `[autoDream] firing — ${hoursSince.toFixed(1)}h since last, ${sessionIds.length} sessions to review`,
    )
    logEvent('tengu_auto_dream_fired', {
      hours_since: Math.round(hoursSince),
      sessions_since: sessionIds.length,
    })

    const setAppState =
      context.toolUseContext.setAppStateForTasks ??
      context.toolUseContext.setAppState
    const abortController = new AbortController()
    const taskId = registerDreamTask(setAppState, {
      sessionsReviewing: sessionIds.length,
      priorMtime,
      abortController,
    })

    try {
      const memoryRoot = getAutoMemPath()
      const transcriptDir = getProjectDir(getOriginalCwd())
      // Tool constraints note goes in `extra`, not the shared prompt body —
      // manual /dream runs in the main loop with normal permissions and this
      // would be misleading there.
      // sessionIds is already sorted mtime-desc by listSessionsTouchedSince,
      // so slicing the head keeps the most-recently-touched sessions.
      const shown = sessionIds.slice(0, MAX_SESSION_IDS_IN_PROMPT)
      const overflow = sessionIds.length - shown.length
      const extra = `

**Tool constraints for this run:** Bash is restricted to read-only commands (\`ls\`, \`find\`, \`grep\`, \`cat\`, \`stat\`, \`wc\`, \`head\`, \`tail\`, and similar), plus \`rm -f\` of top-level \`.md\` files in the memory directory (not \`${ENTRYPOINT_NAME}\` — overwrite that instead). Anything else that writes, redirects to a file, or modifies state will be denied. Plan your exploration with this in mind — no need to probe.

Sessions since last consolidation (${sessionIds.length}):
${shown.map(id => `- ${id}`).join('\n')}${overflow > 0 ? `\n- ...and ${overflow} more` : ''}`
      const prompt = buildConsolidationPrompt(
        memoryRoot,
        transcriptDir,
        extra,
        isTeamMemoryEnabled(),
      )

      const result = await runForkedAgent({
        promptMessages: [createUserMessage({ content: prompt })],
        cacheSafeParams: createCacheSafeParams(context),
        canUseTool: createDreamCanUseTool(
          memoryRoot,
          context.toolUseContext,
        ),
        querySource: 'auto_dream',
        forkLabel: 'auto_dream',
        skipTranscript: true,
        // Fire-and-forget: dream's prompt prefix is one-shot, no future
        // request reads from it. Also sidesteps the cache-miss penalty
        // when modelOverride differs from the parent's mainLoopModel
        // (model is part of the cache key, so a different model invalidates
        // the parent's lineage anyway).
        skipCacheWrite: true,
        // Opt-in model downshift. undefined → inherit parent's mainLoopModel
        // (the historical behavior). Users set settings.autoDreamModel to e.g.
        // 'haiku' on Anthropic-direct, or a provider-specific small-model id
        // on non-Anthropic backends.
        modelOverride: getAutoDreamModel(),
        overrides: { abortController },
        onMessage: makeDreamProgressWatcher(taskId, setAppState),
      })

      completeDreamTask(taskId, setAppState)
      // Inline completion summary in the main transcript (same surface as
      // extractMemories's "Saved N memories" message).
      const dreamState = context.toolUseContext.getAppState().tasks?.[taskId]
      if (
        appendSystemMessage &&
        isDreamTask(dreamState) &&
        dreamState.filesTouched.length > 0
      ) {
        appendSystemMessage({
          ...createMemorySavedMessage(dreamState.filesTouched),
          verb: 'Improved',
        })
      }
      logForDebugging(
        `[autoDream] completed — cache: read=${result.totalUsage.cache_read_input_tokens} created=${result.totalUsage.cache_creation_input_tokens}`,
      )
      logEvent('tengu_auto_dream_completed', {
        cache_read: result.totalUsage.cache_read_input_tokens,
        cache_created: result.totalUsage.cache_creation_input_tokens,
        output: result.totalUsage.output_tokens,
        sessions_reviewed: sessionIds.length,
      })
    } catch (e: unknown) {
      // If the user killed from the bg-tasks dialog, DreamTask.kill already
      // aborted, rolled back the lock, and set status=killed. Don't overwrite
      // or double-rollback.
      if (abortController.signal.aborted) {
        logForDebugging('[autoDream] aborted by user')
        return
      }
      logForDebugging(`[autoDream] fork failed: ${(e as Error).message}`)
      logEvent('tengu_auto_dream_failed', {})
      failDreamTask(taskId, setAppState)
      // Rewind mtime so time-gate passes again. Scan throttle is the backoff.
      await rollbackConsolidationLock(priorMtime)
    }
  }
}

/**
 * Watch the forked agent's messages. For each assistant turn, extracts any
 * text blocks (the agent's reasoning/summary — what the user wants to see)
 * and collapses tool_use blocks to a count. Edit/Write file_paths are
 * collected for phase-flip + the inline completion message.
 */
function makeDreamProgressWatcher(
  taskId: string,
  setAppState: import('../../Task.js').SetAppState,
): (msg: Message) => void {
  return msg => {
    if (msg.type !== 'assistant') return
    let text = ''
    let toolUseCount = 0
    const touchedPaths: string[] = []
    for (const block of msg.message.content) {
      if (block.type === 'text') {
        text += block.text
      } else if (block.type === 'tool_use') {
        toolUseCount++
        if (
          block.name === FILE_EDIT_TOOL_NAME ||
          block.name === FILE_WRITE_TOOL_NAME
        ) {
          const input = block.input as { file_path?: unknown }
          if (typeof input.file_path === 'string') {
            touchedPaths.push(input.file_path)
          }
        }
      }
    }
    addDreamTurn(
      taskId,
      { text: text.trim(), toolUseCount },
      touchedPaths,
      setAppState,
    )
  }
}

/**
 * Entry point from stopHooks. No-op until initAutoDream() has been called.
 * Per-turn cost when enabled: one GB cache read + one stat.
 */
export async function executeAutoDream(
  context: REPLHookContext,
  appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {
  await runner?.(context, appendSystemMessage)
}
