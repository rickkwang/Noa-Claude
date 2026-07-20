import type { ToolProgress, ToolProgressData } from '../../Tool.js'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { logError } from '../../utils/log.js'

/**
 * Interval between tool heartbeat ticks, in ms.
 *
 * Mirrors upstream Claude Code (30s). Long enough that a heartbeat is only
 * ever seen for genuinely slow tool calls, short enough that a headless/remote
 * consumer never sees more than ~30s of silence before a "still running"
 * signal.
 */
export const TOOL_HEARTBEAT_INTERVAL_MS = 30_000

const NOOP = (): void => {}

/**
 * Emit a periodic `tool_heartbeat` progress event while a long-running tool
 * call is in flight, so SDK/headless/remote consumers get a "still running"
 * signal instead of silence. Returns a cleanup function that stops the timer;
 * callers MUST invoke it the instant the tool settles (success or error) so a
 * heartbeat is never attributed to post-tool work (PostToolUse hooks, etc.).
 *
 * No-op for the Agent tool — subagents surface their own `agent_progress`, and
 * a heartbeat would be redundant noise. Subagent-context tool calls are
 * excluded by the caller (they gate on `agentId`), matching upstream. (The
 * Agent tool's canonical name is the only one checked here, mirroring upstream;
 * the legacy `Task` alias never appears as a live tool's `.name`.)
 *
 * The emitted progress reuses the same callback the tool itself writes to, so
 * the heartbeat message carries `parentToolUseID = <the real tool use id>` and
 * a distinct `toolUseID` of `<id>-heartbeat-<n>`. It never reaches the
 * interactive message list (the REPL drops it) or a tool's rendered progress
 * trail, and progress messages are never persisted to the transcript — the
 * frame exists only for the headless/SDK output stream.
 *
 * Mirrors upstream Claude Code (added 2.1.213).
 */
export function startToolHeartbeat({
  toolName,
  toolUseID,
  abortSignal,
  onProgress,
  intervalMs = TOOL_HEARTBEAT_INTERVAL_MS,
}: {
  toolName: string
  toolUseID: string
  abortSignal: AbortSignal
  onProgress: (progress: ToolProgress<ToolProgressData>) => void
  /** Override the tick interval. Production omits this; tests use it. */
  intervalMs?: number
}): () => void {
  if (toolName === AGENT_TOOL_NAME) {
    return NOOP
  }

  const startTime = Date.now()
  let stopped = false
  let seq = 0

  const stop = (): void => {
    if (stopped) {
      return
    }
    stopped = true
    clearInterval(timer)
  }

  const timer = setInterval(() => {
    if (stopped) {
      return
    }
    if (abortSignal.aborted) {
      stop()
      return
    }
    try {
      onProgress({
        toolUseID: `${toolUseID}-heartbeat-${seq++}`,
        data: {
          type: 'tool_heartbeat',
          toolName,
          elapsedTimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        },
      })
    } catch (err) {
      // A throwing consumer must never leave the interval running. Log and
      // stop, mirroring upstream.
      logError(err)
      stop()
    }
  }, intervalMs)

  // Don't keep the event loop alive just to emit heartbeats.
  timer.unref()

  return stop
}
