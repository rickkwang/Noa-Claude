import { closeSync, fstatSync, openSync, readSync, statSync } from 'fs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  EVENT_TAG,
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js'
import type { AppState } from '../../state/AppState.js'
import type { TaskStateBase } from '../../Task.js'
import {
  markTaskNotified,
  spawnShellTask,
} from '../../tasks/LocalShellTask/LocalShellTask.js'
import { killTask } from '../../tasks/LocalShellTask/killShellTasks.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { exec } from '../../utils/Shell.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import { escapeXml } from '../../utils/xml.js'
import { BashTool } from '../BashTool/BashTool.js'
import { shouldUseSandbox } from '../BashTool/shouldUseSandbox.js'
import {
  DEFAULT_MONITOR_TIMEOUT_MS,
  DESCRIPTION,
  MAX_MONITOR_TIMEOUT_MS,
  MONITOR_TOOL_NAME,
} from './prompt.js'

// Output lines are batched like upstream: a batch goes out 200ms after its
// first line, or earlier when it reaches MAX_CHARS_PER_EVENT. Lines longer than
// MAX_CHARS_PER_LINE are cut and marked. Nothing is dropped: a batch is split
// before it would overflow.
const POLL_INTERVAL_MS = 100
const FLUSH_INTERVAL_MS = 200
const MAX_CHARS_PER_EVENT = 3_000
const MAX_CHARS_PER_LINE = 500
const TRUNCATED_MARK = '...(truncated)'
// Bounds on reading the output file: a fast producer can write far more than
// the model should see, so reads are capped per poll tick and a finished
// command is drained only up to MAX_DRAIN_BYTES.
const READ_CHUNK_BYTES = 64 * 1024
const MAX_READS_PER_TICK = 16
const MAX_DRAIN_BYTES = 16 * 1024 * 1024
// Shell-level timeout is disabled (the shell would otherwise default to 30
// minutes); the monitor's own timeout_ms or persistent setting decides when it stops.
const NO_SHELL_TIMEOUT_MS = 2_147_483_647

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('Shell command whose output lines are reported as events'),
    description: z
      .string()
      .describe('Short description of what is being watched, shown with each event'),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(MAX_MONITOR_TIMEOUT_MS)
      .optional()
      .describe(
        `Stop the monitor after this many milliseconds (default ${DEFAULT_MONITOR_TIMEOUT_MS}, max ${MAX_MONITOR_TIMEOUT_MS}). Ignored when persistent is true.`,
      ),
    persistent: z
      .boolean()
      .optional()
      .describe('Run until TaskStop or the session ends instead of stopping at a timeout'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task_id: z.string(),
    timeout_ms: z.number().nullable(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

/**
 * Reads new bytes of a task's output file and reports complete lines in
 * batches. The shell command keeps writing; `finish` drains what is left once
 * it exits or is stopped. Memory stays bounded: a read is capped, and a line
 * is held only up to MAX_CHARS_PER_LINE + 1 characters. Safe to call twice.
 */
function watchTaskOutput(
  taskId: string,
  description: string,
  toolUseId: string | undefined,
  agentId: Parameters<typeof spawnShellTask>[0]['agentId'],
): { finish(): void; stop(): void } {
  const outputPath = getTaskOutputPath(taskId)
  let stopped = false
  let offset = 0
  // Current line, cut once it passes MAX_CHARS_PER_LINE + 1 characters.
  let partial = ''
  let pending: string[] = []
  let pendingChars = 0
  let firstPendingAt = 0

  // Reads at most READ_CHUNK_BYTES past `offset`. Returns '' when nothing new.
  const readNew = (): string => {
    let fd: number | undefined
    try {
      fd = openSync(outputPath, 'r')
      const size = fstatSync(fd).size
      if (size <= offset) return ''
      const len = Math.min(size - offset, READ_CHUNK_BYTES)
      const buf = Buffer.alloc(len)
      const n = readSync(fd, buf, 0, len, offset)
      offset += n
      return buf.subarray(0, n).toString('utf8')
    } catch {
      // The file may not exist yet, or was removed after the task ended.
      return ''
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  const hasUnread = (): boolean => {
    try {
      return statSync(outputPath).size > offset
    } catch {
      return false
    }
  }

  const flush = (): void => {
    if (pending.length === 0) return
    const body = pending.join('\n')
    pending = []
    pendingChars = 0
    const toolUseIdLine = toolUseId
      ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
      : ''
    enqueuePendingNotification({
      mode: 'task-notification',
      priority: 'next',
      agentId,
      value: `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${SUMMARY_TAG}>${escapeXml(`Monitor event: "${description}"`)}</${SUMMARY_TAG}>
<${EVENT_TAG}>${escapeXml(body)}</${EVENT_TAG}>
</${TASK_NOTIFICATION_TAG}>`,
    })
  }

  const addLine = (line: string): void => {
    const text =
      line.length > MAX_CHARS_PER_LINE
        ? `${line.slice(0, MAX_CHARS_PER_LINE)}${TRUNCATED_MARK}`
        : line
    if (pendingChars + text.length + 1 > MAX_CHARS_PER_EVENT) flush()
    if (pending.length === 0) firstPendingAt = Date.now()
    pending.push(text)
    pendingChars += text.length + 1
  }

  const takeChunk = (chunk: string): void => {
    let start = 0
    for (;;) {
      const nl = chunk.indexOf('\n', start)
      const end = nl === -1 ? chunk.length : nl
      // Keep one character past the limit so addLine can tell the line was cut.
      const room = MAX_CHARS_PER_LINE + 1 - partial.length
      if (room > 0 && end > start) {
        partial += chunk.slice(start, Math.min(end, start + room))
      }
      if (nl === -1) return
      if (partial.length > 0) addLine(partial)
      partial = ''
      start = nl + 1
    }
  }

  // Reads up to maxReads chunks. Returns false when the cap stopped it early.
  const collect = (maxReads: number): boolean => {
    for (let i = 0; i < maxReads; i++) {
      const chunk = readNew()
      if (!chunk) return true
      takeChunk(chunk)
    }
    return !hasUnread()
  }

  const timer = setInterval(() => {
    collect(MAX_READS_PER_TICK)
    if (pending.length > 0 && Date.now() - firstPendingAt >= FLUSH_INTERVAL_MS) {
      flush()
    }
  }, POLL_INTERVAL_MS)
  timer.unref()

  const finishReading = (maxBytes: number): void => {
    clearInterval(timer)
    const drained = collect(Math.ceil(maxBytes / READ_CHUNK_BYTES))
    if (!drained) {
      addLine(`[remaining output not shown; full output: ${outputPath}]`)
    }
    if (partial.length > 0) {
      addLine(partial)
      partial = ''
    }
    flush()
  }

  return {
    finish() {
      if (stopped) return
      finishReading(MAX_DRAIN_BYTES)
    },
    // Flushes what was read so far, then ignores lines the process writes while
    // it is being killed, so nothing follows the timeout notice.
    stop() {
      if (stopped) return
      finishReading(READ_CHUNK_BYTES * MAX_READS_PER_TICK)
      stopped = true
    },
  }
}

/**
 * Stops a monitor whose timeout elapsed. The timeout notice goes out before
 * the kill, and the task is marked notified first so the shell's own
 * "killed" notification is suppressed. Does nothing if the task already ended.
 */
function stopTimedOutMonitor(
  taskId: string,
  description: string,
  toolUseId: string | undefined,
  agentId: Parameters<typeof spawnShellTask>[0]['agentId'],
  getAppState: () => AppState,
  setAppState: Parameters<typeof spawnShellTask>[1]['setAppState'],
): void {
  const task = getAppState().tasks?.[taskId] as TaskStateBase | undefined
  if (!task || task.status !== 'running' || task.notified) return
  markTaskNotified(taskId, setAppState)
  const toolUseIdLine = toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  enqueuePendingNotification({
    mode: 'task-notification',
    priority: 'next',
    agentId,
    value: `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${getTaskOutputPath(taskId)}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>killed</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(`Monitor "${description}" stopped`)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
[Monitor timed out — re-arm if needed.]`,
  })
  killTask(taskId, setAppState)
}

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint:
    'watch, monitor, or keep an eye on a process or log, streaming output lines as events',
  maxResultSizeChars: 10_000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.command
  },
  getActivityDescription(input) {
    return input?.description ? `Monitoring: ${input.description}` : 'Monitoring'
  },
  async validateInput(input, context) {
    return BashTool.validateInput(input as never, context)
  },
  async checkPermissions(input, context) {
    // Same rules as Bash: a monitor runs an arbitrary shell command. Pass the
    // whole input back: Bash returns it as updatedInput, which replaces what
    // call() receives, so a trimmed object would drop description.
    return BashTool.checkPermissions(input as never, context)
  },
  async preparePermissionMatcher(input) {
    return BashTool.preparePermissionMatcher({ command: input.command })
  },
  async description() {
    return 'Run a shell command in the background and report its output lines as events'
  },
  async prompt() {
    return DESCRIPTION
  },
  renderToolUseMessage(input) {
    return input.description
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lifetime =
      output.timeout_ms === null
        ? 'persistent — runs until TaskStop or session end'
        : `timeout ${output.timeout_ms}ms`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Monitor started (task ${output.task_id}, ${lifetime}). Each event arrives as a notification on its own schedule; an event is not the user's reply, even if it lands while you wait for them. Keep working — do not poll or sleep.`,
    }
  },
  async call(input, toolUseContext) {
    const { abortController, getAppState, setAppState, toolUseId, agentId } =
      toolUseContext
    const timeoutMs = input.persistent
      ? null
      : (input.timeout_ms ?? DEFAULT_MONITOR_TIMEOUT_MS)
    // Events carry stdout only, as upstream does. stderr is discarded here:
    // in file mode it would share the output file and show up as events.
    const shellCommand = await exec(`exec 2>/dev/null\n${input.command}`, abortController.signal, 'bash', {
      timeout: NO_SHELL_TIMEOUT_MS,
      preventCwdChanges: true,
      shouldUseSandbox: shouldUseSandbox({ command: input.command }),
      shouldAutoBackground: false,
    })
    const handle = await spawnShellTask(
      {
        command: input.command,
        description: input.description,
        shellCommand,
        toolUseId,
        agentId,
        kind: 'monitor',
      },
      { abortController, getAppState, setAppState },
    )
    const taskId = handle.taskId
    const watcher = watchTaskOutput(taskId, input.description, toolUseId, agentId)
    const timer =
      timeoutMs === null
        ? undefined
        : setTimeout(() => {
            watcher.stop()
            stopTimedOutMonitor(
              taskId,
              input.description,
              toolUseId,
              agentId,
              getAppState,
              setAppState,
            )
          }, timeoutMs)
    timer?.unref()
    // Registered after spawnShellTask's own completion handler, so the last
    // lines are queued just before the task's completion notification.
    void shellCommand.result.then(() => {
      clearTimeout(timer)
      watcher.finish()
    })
    return { data: { task_id: taskId, timeout_ms: timeoutMs } }
  },
} satisfies ToolDef<InputSchema, Output>)
