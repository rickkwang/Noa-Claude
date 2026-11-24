// @ts-nocheck
import { type ChildProcess, execFile, execFileSync } from 'child_process'
import { stat } from 'fs/promises'
import type { Readable } from 'stream'
import treeKill from 'tree-kill'
import { generateTaskId } from '../Task.js'
import { logForDebugging } from './debug.js'
import { formatDuration, formatFileSize } from './format.js'
import { MAX_TASK_OUTPUT_BYTES } from './task/diskOutput.js'
import { TaskOutput } from './task/TaskOutput.js'

export type ExecResult = {
  stdout: string
  stderr: string
  code: number
  interrupted: boolean
  backgroundTaskId?: string
  backgroundedByUser?: boolean
  /** Moved to the background by send-now so a queued message could reach the model. */
  backgroundedToDeliverMessage?: boolean
  /** Set when assistant-mode auto-backgrounded a long-running blocking command. */
  assistantAutoBackgrounded?: boolean
  /** Set when stdout was too large to fit inline — points to the output file on disk. */
  outputFilePath?: string
  /** Total size of the output file in bytes (set when outputFilePath is set). */
  outputFileSize?: number
  /** The task ID for the output file (set when outputFilePath is set). */
  outputTaskId?: string
  /** Error message when the command failed before spawning (e.g., deleted cwd). */
  preSpawnError?: string
}

export type ShellCommand = {
  background: (backgroundTaskId: string) => boolean
  result: Promise<ExecResult>
  kill: () => Promise<void> | void
  status: 'running' | 'backgrounded' | 'completed' | 'killed'
  /**
   * Cleans up stream resources (event listeners).
   * Should be called after the command completes or is killed to prevent memory leaks.
   */
  cleanup: () => void
  onTimeout?: (
    callback: (backgroundFn: (taskId: string) => boolean) => void,
  ) => void
  /** The TaskOutput instance that owns all stdout/stderr data and progress. */
  taskOutput: TaskOutput
}

const SIGKILL = 137
const SIGTERM = 143

// Commands that leave their shell's process group (setsid, daemons) are only
// findable by ancestry while the shell is alive, so they are sampled during the
// run and matched again at exit by pid plus start time, so a pid reused by an
// unrelated process is never signalled.
const PS_ARGS = ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'lstart=']
// lstart is locale- and zone-dependent; pin both so every sample compares equal
const PS_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: 1000,
  env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
}
const SAMPLE_INTERVAL_MS = 500
const KILL_ESCALATION_MS = 5000
const KILL_BACKSTOP_TIMEOUT_MS = 1500

const liveShellCommands = new Set<ShellCommandImpl>()
const pendingKillBackstops = new Set<Promise<void>>()
const dyingProcesses = new Map<number, ChildProcess>()
const pendingGroupEscalations = new Set<number>()
const pendingDescendantEscalations = new Map<number, string>()
let exitSweepInstalled = false

function killProcessGroupSync(pid: number, onlyGroup = false): void {
  if (process.platform === 'win32' || pid <= 1) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Group already gone or process is not a group leader
  }
  if (!onlyGroup) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process already exited
    }
  }
}

function killChildProcessGroupSync(pid: number, child: ChildProcess): void {
  if (pid <= 1) return
  const reaped = child.exitCode !== null || child.signalCode !== null
  if (process.platform === 'win32') {
    if (!reaped) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Process already exited or cannot be signalled
      }
    }
    return
  }
  if (!reaped) {
    killProcessGroupSync(pid)
    return
  }
  // Child itself was reaped, so its pid may already be reused; only signal
  // the process group if a live member still holds the group id reserved.
  try {
    process.kill(-pid, 0)
    killProcessGroupSync(pid, true)
  } catch {
    // Process group is empty
  }
}

function sweepTrackedDescendantsSync(
  tracked: ReadonlyMap<number, string>,
): void {
  if (process.platform === 'win32' || tracked.size === 0) return
  const alivePids: number[] = []
  for (const pid of tracked.keys()) {
    if (pid <= 1) continue
    try {
      process.kill(pid, 0)
      alivePids.push(pid)
    } catch {
      // Already exited
    }
  }
  if (alivePids.length === 0) return
  let table: ProcessTable
  try {
    const stdout = execFileSync('ps', PS_ARGS, PS_OPTIONS)
    table = parseProcessTable(stdout)
  } catch {
    return
  }
  for (const pid of alivePids) {
    if (table.get(pid)?.start !== tracked.get(pid)) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already exited
    }
  }
}

function sweepLiveShellCommandsOnExit(): void {
  if (process.platform === 'win32') {
    for (const [, child] of dyingProcesses) {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          // Best-effort cleanup on exit
        }
      }
    }
    for (const cmd of liveShellCommands) {
      const child = cmd.getChildProcess()
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          // Best-effort cleanup on exit
        }
      }
    }
    return
  }
  const activePids = new Set<number>()
  for (const [pid, child] of dyingProcesses) {
    const reaped = child.exitCode !== null || child.signalCode !== null
    if (!reaped) {
      activePids.add(pid)
    } else {
      // Child itself was reaped, but its process group may still hold live members.
      try {
        process.kill(-pid, 0)
        killProcessGroupSync(pid, true)
      } catch {
        // Process group is empty
      }
    }
  }
  for (const pid of pendingGroupEscalations) {
    try {
      process.kill(-pid, 0)
      killProcessGroupSync(pid, true)
    } catch {
      // Process group is empty
    }
  }
  const trackedDescendants = new Map<number, string>(
    pendingDescendantEscalations,
  )
  for (const cmd of liveShellCommands) {
    const pid = cmd.getActivePid()
    if (pid !== undefined && pid > 1) {
      activePids.add(pid)
    }
    for (const [descPid, start] of cmd.getTrackedDescendants()) {
      trackedDescendants.set(descPid, start)
    }
  }
  for (const pid of activePids) {
    killProcessGroupSync(pid)
  }
  sweepTrackedDescendantsSync(trackedDescendants)
}

function ensureExitSweepInstalled(): void {
  if (exitSweepInstalled) return
  exitSweepInstalled = true
  process.prependListener('exit', sweepLiveShellCommandsOnExit)
}

/**
 * Terminate all live shell commands (foreground and background).
 * Used during graceful shutdown so detached shells and monitors do not
 * survive as orphans after the parent process exits.
 */
export function killAllLiveShellCommands(): void {
  for (const cmd of Array.from(liveShellCommands)) {
    if (cmd.status === 'running' || cmd.status === 'backgrounded') {
      void cmd.kill()
    }
  }
}

/**
 * Wait for in-flight shell kill operations to finish (bounded by timeoutMs)
 * before process.exit() terminates the event loop.
 */
export async function waitForPendingShellKills(
  timeoutMs = KILL_BACKSTOP_TIMEOUT_MS,
): Promise<void> {
  if (pendingKillBackstops.size === 0) return
  const pending = Promise.allSettled(Array.from(pendingKillBackstops))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      pending,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, timeoutMs)
        timer.unref()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

type ProcessTable = Map<number, { ppid: number; start: string }>

function parseProcessTable(stdout: string): ProcessTable {
  const table = new Map()
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/)
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), start: m[3] })
  }
  return table
}

/** Process table from ps; null if ps fails or times out. */
function listProcesses(callback: (table: ProcessTable | null) => void): void {
  execFile('ps', PS_ARGS, PS_OPTIONS, (error, stdout) =>
    callback(error ? null : parseProcessTable(stdout)),
  )
}

/** Descendants of `root` as pid -> start time. */
function descendantsOf(table: ProcessTable, root: number): Map<number, string> {
  const children = new Map<number, number[]>()
  for (const [pid, { ppid }] of table) {
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  const found = new Map<number, string>()
  const queue = [root]
  while (queue.length > 0) {
    const pid = queue.shift()!
    for (const child of children.get(pid) ?? []) {
      if (child > 1 && !found.has(child)) {
        found.set(child, table.get(child)!.start)
        queue.push(child)
      }
    }
  }
  return found
}

// In file mode, stdout/stderr go straight to a file fd with no JS in the loop,
// so nothing counts bytes and a stuck append loop can fill the disk. Poll file
// size and kill when exceeded. This runs for the whole lifetime of the command,
// foreground included: the foreground window is bounded only by the timeout
// (2 min default), and a runaway writer sustains >1 GB/s, so an unwatched
// foreground command fills the disk long before the timeout fires.
//
// The interval is the dominant overshoot term — nothing is checked before the
// first tick — so keep it short. One stat() per tick per running command.
const SIZE_WATCHDOG_INTERVAL_MS = 2_000

function prependStderr(prefix: string, stderr: string): string {
  return stderr ? `${prefix} ${stderr}` : prefix
}

/**
 * Thin pipe from a child process stream into TaskOutput.
 * Used in pipe mode (hooks) for stdout and stderr.
 * In file mode (bash commands), both fds go to the output file —
 * the child process streams are null and no wrappers are created.
 */
class StreamWrapper {
  #stream: Readable | null
  #isCleanedUp = false
  #taskOutput: TaskOutput | null
  #isStderr: boolean
  #onData = this.#dataHandler.bind(this)

  constructor(stream: Readable, taskOutput: TaskOutput, isStderr: boolean) {
    this.#stream = stream
    this.#taskOutput = taskOutput
    this.#isStderr = isStderr
    // Emit strings instead of Buffers - avoids repeated .toString() calls
    stream.setEncoding('utf-8')
    stream.on('data', this.#onData)
  }

  #dataHandler(data: Buffer | string): void {
    const str = typeof data === 'string' ? data : data.toString()

    if (this.#isStderr) {
      this.#taskOutput!.writeStderr(str)
    } else {
      this.#taskOutput!.writeStdout(str)
    }
  }

  cleanup(): void {
    if (this.#isCleanedUp) {
      return
    }
    this.#isCleanedUp = true
    this.#stream!.removeListener('data', this.#onData)
    // Release references so the stream, its StringDecoder, and
    // the TaskOutput can be GC'd independently of this wrapper.
    this.#stream = null
    this.#taskOutput = null
    this.#onData = () => {}
  }
}

/**
 * Implementation of ShellCommand that wraps a child process.
 *
 * For bash commands: both stdout and stderr go to a file fd via
 * stdio[1] and stdio[2] — no JS involvement. Progress is extracted
 * by polling the file tail.
 * For hooks: pipe mode with StreamWrappers for real-time detection.
 */
class ShellCommandImpl implements ShellCommand {
  #status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'running'
  #killCode: number | undefined
  #backgroundTaskId: string | undefined
  #stdoutWrapper: StreamWrapper | null
  #stderrWrapper: StreamWrapper | null
  #childProcess: ChildProcess
  #timeoutId: NodeJS.Timeout | null = null
  #descendants = new Map<number, string>()
  #sampler: NodeJS.Timeout | null = null
  #sampling = false
  #sizeWatchdog: NodeJS.Timeout | null = null
  #killedForSize = false
  #maxOutputBytes: number
  #abortSignal: AbortSignal
  #onTimeoutCallback:
    | ((backgroundFn: (taskId: string) => boolean) => void)
    | undefined
  #timeout: number
  #shouldAutoBackground: boolean
  #resultResolver: ((result: ExecResult) => void) | null = null
  #exitCodeResolver: ((code: number) => void) | null = null
  #boundAbortHandler: (() => void) | null = null
  readonly taskOutput: TaskOutput

  static #handleTimeout(self: ShellCommandImpl): void {
    if (self.#shouldAutoBackground && self.#onTimeoutCallback) {
      self.#onTimeoutCallback(self.background.bind(self))
    } else {
      self.#doKill(SIGTERM)
    }
  }

  readonly result: Promise<ExecResult>
  readonly onTimeout?: (
    callback: (backgroundFn: (taskId: string) => boolean) => void,
  ) => void

  constructor(
    childProcess: ChildProcess,
    abortSignal: AbortSignal,
    timeout: number,
    taskOutput: TaskOutput,
    shouldAutoBackground = false,
    maxOutputBytes = MAX_TASK_OUTPUT_BYTES,
  ) {
    this.#childProcess = childProcess
    this.#abortSignal = abortSignal
    this.#timeout = timeout
    this.#shouldAutoBackground = shouldAutoBackground
    this.#maxOutputBytes = maxOutputBytes
    this.taskOutput = taskOutput

    // In file mode (bash commands), both stdout and stderr go to the
    // output file fd — childProcess.stdout/.stderr are both null.
    // In pipe mode (hooks), wrap streams to funnel data into TaskOutput.
    this.#stderrWrapper = childProcess.stderr
      ? new StreamWrapper(childProcess.stderr, taskOutput, true)
      : null
    this.#stdoutWrapper = childProcess.stdout
      ? new StreamWrapper(childProcess.stdout, taskOutput, false)
      : null

    // Arm the size watchdog immediately in file mode. background() re-arms it
    // (its #cleanupListeners() clears it first). Pipe mode needs no watchdog —
    // DiskTaskOutput drops chunks past the same cap.
    if (taskOutput.stdoutToFile) {
      this.#startSizeWatchdog()
    }

    if (shouldAutoBackground) {
      this.onTimeout = (callback): void => {
        this.#onTimeoutCallback = callback
      }
    }

    this.result = this.#createResultPromise()
    liveShellCommands.add(this)
    ensureExitSweepInstalled()
  }

  getActivePid(): number | undefined {
    const child = this.#childProcess
    if (!child?.pid) return undefined
    if (child.exitCode !== null || child.signalCode !== null) return undefined
    return child.pid
  }

  getChildProcess(): ChildProcess | null {
    return this.#childProcess
  }

  getTrackedDescendants(): ReadonlyMap<number, string> {
    return this.#descendants
  }

  get status(): 'running' | 'backgrounded' | 'completed' | 'killed' {
    return this.#status
  }

  #abortHandler(): void {
    // On 'interrupt' (user submitted a new message), don't kill — let the
    // caller background the process so the model can see partial output.
    if (this.#abortSignal.reason === 'interrupt') {
      return
    }
    this.kill()
  }

  #exitHandler(code: number | null, signal: NodeJS.Signals | null): void {
    const exitCode =
      code !== null && code !== undefined
        ? code
        : signal === 'SIGTERM'
          ? 144
          : 1
    // Preserve the requested kill/timeout result whichever callback arrives first.
    const resolveExit = () => this.#resolveExitCode(this.#killCode ?? exitCode)
    // Only a foreground bash command: a backgrounded one is owned by its task,
    // and hooks (pipe mode) are not ours to reap. The shell is gone, but anything
    // it left behind (`cmd &`) still sits in its process group, which nothing
    // else tracks once the result is returned. A killed shell was already
    // SIGKILLed by #doKill, but its orphans may not have been.
    if (
      this.taskOutput.stdoutToFile &&
      (this.#status === 'running' || this.#status === 'killed')
    ) {
      this.#clearSampler()
      this.#killProcessGroup()
      // Resolve only after the orphan sweep has sent SIGTERM, so the result
      // never reaches the caller while those processes are still running
      this.#killDescendants(resolveExit)
      return
    }
    this.#clearTrackedDescendantsFromPending()
    resolveExit()
  }

  #sampleDescendants(): void {
    const root = this.#childProcess?.pid
    if (!root || this.#sampling) return
    this.#sampling = true
    listProcesses(table => {
      this.#sampling = false
      if (!table || this.#status !== 'running') return
      for (const [pid, start] of descendantsOf(table, root)) {
        this.#descendants.set(pid, start)
      }
    })
  }

  #clearSampler(): void {
    if (this.#sampler) {
      clearInterval(this.#sampler)
      this.#sampler = null
    }
  }

  #clearTrackedDescendantsFromPending(): void {
    for (const [descPid, start] of this.#descendants) {
      if (pendingDescendantEscalations.get(descPid) === start) {
        pendingDescendantEscalations.delete(descPid)
      }
    }
  }

  #killDescendants(done: () => void): void {
    // Exited processes are the common case; skip the ps snapshot if none remain
    const pids = [...this.#descendants.keys()].filter(pid => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
    if (pids.length === 0) {
      this.#clearTrackedDescendantsFromPending()
      return done()
    }
    // Signal only pids whose start time still matches the sample
    const sameProcess = (table: ProcessTable | null, pid: number) =>
      table?.get(pid)?.start === this.#descendants.get(pid)
    listProcesses(table => {
      if (!table) logForDebugging('ShellCommand: ps failed, orphaned descendants not swept')
      const targets = pids.filter(pid => sameProcess(table, pid))
      this.#clearTrackedDescendantsFromPending()
      for (const pid of targets) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Already exited
        }
      }
      done()
      if (targets.length === 0) return
      for (const pid of targets) {
        const start = this.#descendants.get(pid)
        if (start !== undefined) {
          pendingDescendantEscalations.set(pid, start)
        }
      }
      const escalate = setTimeout(() => {
        listProcesses(later => {
          for (const pid of targets) {
            if (pendingDescendantEscalations.get(pid) === this.#descendants.get(pid)) {
              pendingDescendantEscalations.delete(pid)
            }
            if (!sameProcess(later, pid)) continue
            try {
              process.kill(pid, 'SIGKILL')
            } catch {
              // Already exited
            }
          }
        })
      }, KILL_ESCALATION_MS)
      escalate.unref()
    })
  }

  #killProcessGroup(): void {
    // cleanup() can precede this exit callback. The pending tree-kill callback
    // retains its own pid and still sweeps the group after killing descendants.
    const pid = this.#childProcess?.pid
    if (process.platform === 'win32' || !pid || pid <= 1) return
    // The shell is already reaped, so its pid may be reused once its group is
    // empty. A group that still exists has a live member, which keeps the id
    // reserved, so only signal after confirming the group is there.
    try {
      process.kill(-pid, 0)
      process.kill(-pid, 'SIGTERM')
    } catch {
      // Group already empty
      return
    }
    pendingGroupEscalations.add(pid)
    // Escalate for members that ignore SIGTERM
    const escalate = setTimeout(() => {
      pendingGroupEscalations.delete(pid)
      // Once the group is empty its id can be reused by an unrelated process
      try {
        process.kill(-pid, 0)
      } catch {
        return
      }
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // Group exited
      }
    }, KILL_ESCALATION_MS)
    escalate.unref()
  }

  #errorHandler(): void {
    this.#resolveExitCode(1)
  }

  #resolveExitCode(code: number): void {
    if (this.#exitCodeResolver) {
      this.#exitCodeResolver(code)
      this.#exitCodeResolver = null
    }
  }

  // Note: exit/error listeners are NOT removed here — they're needed for
  // the result promise to resolve. They clean up when the child process exits.
  #cleanupListeners(): void {
    this.#clearSizeWatchdog()
    this.#clearSampler()
    const timeoutId = this.#timeoutId
    if (timeoutId) {
      clearTimeout(timeoutId)
      this.#timeoutId = null
    }
    const boundAbortHandler = this.#boundAbortHandler
    if (boundAbortHandler) {
      this.#abortSignal.removeEventListener('abort', boundAbortHandler)
      this.#boundAbortHandler = null
    }
  }

  #clearSizeWatchdog(): void {
    if (this.#sizeWatchdog) {
      clearInterval(this.#sizeWatchdog)
      this.#sizeWatchdog = null
    }
  }

  #startSizeWatchdog(): void {
    this.#sizeWatchdog = setInterval(() => {
      void stat(this.taskOutput.path).then(
        s => {
          // Bail if the watchdog was cleared while this stat was in flight
          // (process exited on its own) — otherwise we'd mislabel stderr.
          if (
            s.size > this.#maxOutputBytes &&
            (this.#status === 'running' || this.#status === 'backgrounded') &&
            this.#sizeWatchdog !== null
          ) {
            this.#killedForSize = true
            this.#clearSizeWatchdog()
            this.#doKill(SIGKILL)
          }
        },
        () => {
          // ENOENT before first write, or unlinked mid-run — skip this tick
        },
      )
    }, SIZE_WATCHDOG_INTERVAL_MS)
    this.#sizeWatchdog.unref()
  }

  #createResultPromise(): Promise<ExecResult> {
    this.#boundAbortHandler = this.#abortHandler.bind(this)
    this.#abortSignal.addEventListener('abort', this.#boundAbortHandler, {
      once: true,
    })

    // Hook results include pipe output. Their executor bounds the drain after
    // exit; Bash file output can resolve immediately without waiting for pipes.
    this.#childProcess.once(
      this.taskOutput.stdoutToFile ? 'exit' : 'close',
      this.#exitHandler.bind(this),
    )
    // ps is unavailable on Windows; the group kill is skipped there too
    if (process.platform !== 'win32' && this.taskOutput.stdoutToFile) {
      this.#sampler = setInterval(
        () => this.#sampleDescendants(),
        SAMPLE_INTERVAL_MS,
      )
      this.#sampler.unref()
    }
    this.#childProcess.once('error', this.#errorHandler.bind(this))

    this.#timeoutId = setTimeout(
      ShellCommandImpl.#handleTimeout,
      this.#timeout,
      this,
    ) as NodeJS.Timeout

    const exitPromise = new Promise<number>(resolve => {
      this.#exitCodeResolver = resolve
    })

    return new Promise<ExecResult>(resolve => {
      this.#resultResolver = resolve
      void exitPromise.then(this.#handleExit.bind(this))
    })
  }

  async #handleExit(code: number): Promise<void> {
    liveShellCommands.delete(this)
    this.#cleanupListeners()
    if (this.#status === 'running' || this.#status === 'backgrounded') {
      this.#status = 'completed'
    }

    const stdout = await this.taskOutput.getStdout()
    const result: ExecResult = {
      code,
      stdout,
      stderr: this.taskOutput.getStderr(),
      interrupted: code === SIGKILL,
      backgroundTaskId: this.#backgroundTaskId,
    }

    if (this.taskOutput.stdoutToFile && !this.#backgroundTaskId) {
      if (this.taskOutput.outputFileRedundant) {
        // Small file — full content is in result.stdout, delete the file
        void this.taskOutput.deleteOutputFile()
      } else {
        // Large file — tell the caller where the full output lives
        result.outputFilePath = this.taskOutput.path
        result.outputFileSize = this.taskOutput.outputFileSize
        result.outputTaskId = this.taskOutput.taskId
      }
    }

    if (this.#killedForSize) {
      result.stderr = prependStderr(
        `Command killed: output file exceeded ${formatFileSize(this.#maxOutputBytes)}`,
        result.stderr,
      )
    } else if (code === SIGTERM) {
      result.stderr = prependStderr(
        `Command timed out after ${formatDuration(this.#timeout)}`,
        result.stderr,
      )
    }

    const resultResolver = this.#resultResolver
    if (resultResolver) {
      this.#resultResolver = null
      resultResolver(result)
    }
  }

  #doKill(code?: number): Promise<void> {
    if (
      !this.#childProcess ||
      this.#status === 'completed' ||
      this.#status === 'killed'
    ) {
      return Promise.resolve()
    }
    this.#status = 'killed'
    this.#killCode = code ?? SIGKILL
    liveShellCommands.delete(this)
    const pid = this.#childProcess.pid
    // Once the shell has been reaped its pid may already be reused, so signal
    // neither its group nor its tree.
    const reaped =
      this.#childProcess.exitCode !== null ||
      this.#childProcess.signalCode !== null
    if (pid && !reaped) {
      if (this.taskOutput.stdoutToFile) {
        for (const [descPid, start] of this.#descendants) {
          pendingDescendantEscalations.set(descPid, start)
        }
      }
      const child = this.#childProcess
      dyingProcesses.set(pid, child)
      const killPromise = new Promise<void>(resolve => {
        let settled = false
        const finish = (): void => {
          if (settled) return
          settled = true
          clearTimeout(backstopTimer)
          if (dyingProcesses.get(pid) === child) {
            dyingProcesses.delete(pid)
          }
          this.#resolveExitCode(code ?? SIGKILL)
          resolve()
        }
        // Bound treeKill wait so a stalled process-table walk never blocks
        // shutdown or delays signalling the process group.
        const backstopTimer = setTimeout(() => {
          killChildProcessGroupSync(pid, child)
          finish()
        }, KILL_BACKSTOP_TIMEOUT_MS)
        backstopTimer.unref()

        // Enumerate and kill the tree before killing its process group. A shell
        // with job control can put children in other groups; killing the shell
        // first reparents those children before treeKill can discover them.
        treeKill(pid, 'SIGKILL', () => {
          // A detached shell leads its own group. Also stop group members that
          // were already reparented and therefore absent from the tree walk.
          killChildProcessGroupSync(pid, child)
          finish()
        })
      })
      pendingKillBackstops.add(killPromise)
      void killPromise.finally(() => {
        pendingKillBackstops.delete(killPromise)
      })
      return killPromise
    }
    this.#resolveExitCode(code ?? SIGKILL)
    return Promise.resolve()
  }

  kill(): Promise<void> {
    return this.#doKill()
  }

  background(taskId: string): boolean {
    if (this.#status === 'running') {
      this.#backgroundTaskId = taskId
      this.#status = 'backgrounded'
      this.#cleanupListeners()
      if (this.taskOutput.stdoutToFile) {
        // File mode: child writes directly to the fd with no JS involvement.
        // The foreground timeout is gone, so watch file size to prevent
        // a stuck append loop from filling the disk (768GB incident).
        this.#startSizeWatchdog()
      } else {
        // Pipe mode: spill the in-memory buffer so readers can find it on disk.
        this.taskOutput.spillToDisk()
      }
      return true
    }
    return false
  }

  cleanup(): void {
    liveShellCommands.delete(this)
    this.#stdoutWrapper?.cleanup()
    this.#stderrWrapper?.cleanup()
    this.taskOutput.clear()
    // Must run before nulling #abortSignal — #cleanupListeners() calls
    // removeEventListener on it. Without this, a kill()+cleanup() sequence
    // crashes: kill() queues #handleExit as a microtask, cleanup() nulls
    // #abortSignal, then #handleExit runs #cleanupListeners() on the null ref.
    this.#cleanupListeners()
    // Release references to allow GC of ChildProcess internals and AbortController chain
    this.#childProcess = null!
    this.#abortSignal = null!
    this.#onTimeoutCallback = undefined
  }
}

/**
 * Wraps a child process to enable flexible handling of shell command execution.
 */
export function wrapSpawn(
  childProcess: ChildProcess,
  abortSignal: AbortSignal,
  timeout: number,
  taskOutput: TaskOutput,
  shouldAutoBackground = false,
  maxOutputBytes = MAX_TASK_OUTPUT_BYTES,
): ShellCommand {
  return new ShellCommandImpl(
    childProcess,
    abortSignal,
    timeout,
    taskOutput,
    shouldAutoBackground,
    maxOutputBytes,
  )
}

/**
 * Static ShellCommand implementation for commands that were aborted before execution.
 */
class AbortedShellCommand implements ShellCommand {
  readonly status = 'killed' as const
  readonly result: Promise<ExecResult>
  readonly taskOutput: TaskOutput

  constructor(opts?: {
    backgroundTaskId?: string
    stderr?: string
    code?: number
  }) {
    this.taskOutput = new TaskOutput(generateTaskId('local_bash'), null)
    this.result = Promise.resolve({
      code: opts?.code ?? 145,
      stdout: '',
      stderr: opts?.stderr ?? 'Command aborted before execution',
      interrupted: true,
      backgroundTaskId: opts?.backgroundTaskId,
    })
  }

  background(): boolean {
    return false
  }

  kill(): void {}

  cleanup(): void {}
}

export function createAbortedCommand(
  backgroundTaskId?: string,
  opts?: { stderr?: string; code?: number },
): ShellCommand {
  return new AbortedShellCommand({
    backgroundTaskId,
    ...opts,
  })
}

export function createFailedCommand(preSpawnError: string): ShellCommand {
  const taskOutput = new TaskOutput(generateTaskId('local_bash'), null)
  return {
    status: 'completed' as const,
    result: Promise.resolve({
      code: 1,
      stdout: '',
      stderr: preSpawnError,
      interrupted: false,
      preSpawnError,
    }),
    taskOutput,
    background(): boolean {
      return false
    },
    kill(): void {},
    cleanup(): void {},
  }
}
