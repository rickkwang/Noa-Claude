import type { ServerWebSocket, Subprocess } from "bun"
import { join } from "node:path"
import { SESSION_ID, appendTimelineEvent, appendTurnResult, appendTurnDiff, countUserTurns, findTurnDiff, findTurnUserMessage, historyPage, loadHistory, readTurnDiffs, setTurnDiffReverted, transcriptPath } from "./sessions"
import { projectAdditionalDirectories } from "./projects"
import {
  applyTurnDiff,
  captureTree,
  collectDiff,
  createChangeCollector,
  diffForView,
  diffTrees,
  disposeSnapshot,
  fileSize,
  mergeTurnDiffs,
  trackToolResult,
  type ChangeCollector,
  type TreeSnapshot,
} from "./turnDiff"
import type { AgentMessage, Envelope, Outgoing, QueuedMessage, TurnDiff, TurnDiffActionResult } from "../src/agent/protocol"

// Modes the composer can start a session in; bypassPermissions is excluded because it is only entered from the menu.
export const SPAWN_PERMISSION_MODES = new Set(["default", "acceptEdits", "plan", "auto"])

// Last known mode per runtime, so a CLI that exited and is respawned for the same task resumes in it.
const runModes = new Map<string, string>()

export interface SocketData {
  cwd: string
  resume?: string
  runtimeId: string
  mode?: string
  run?: AgentRun
}
interface AgentRun {
  id: string
  cwd: string
  additionalDirectories: string[]
  mode?: string
  sessionId?: string
  pendingTimeline?: { sessionId: string; turn: number; offset: number; message: AgentMessage }[]
  lastTranscriptUuid?: string
  proc: Subprocess<"pipe", "pipe", "pipe">
  clients: Set<ServerWebSocket<SocketData>>
  journal: Envelope[]
  history?: import("./sessions").HistoryItem[]
  queue: QueuedMessage[]
  busy: boolean
  queuePaused?: boolean
  turnSucceeded?: boolean
  turnCounter: number
  turn?: {
    index: number
    transcriptOffset: number
    startedAt: number
    interrupted?: boolean
    before: TreeSnapshot | null
    // Tool-result fallback for projects outside git.
    changes: ChangeCollector
    liveTimer?: ReturnType<typeof setTimeout>
    liveAt?: number
    finalizing?: Promise<void>
  }
  waiting: Set<string>
  activeTasks: Set<string>
  title?: string
  initialization?: Extract<AgentMessage, { type: "control_response" }>
  initializationRequest?: string
  initializeWaiters: Map<ServerWebSocket<SocketData>, string>
  historyReady: Promise<void>
  exited: boolean
}
const runs = new Map<string, AgentRun>()
const workspaceOperations = new Map<string, Promise<void>>()

function reclaimIfIdle(run: AgentRun): void {
  if (!run.clients.size && !run.busy && !run.queue.length && !run.waiting.size && !run.activeTasks?.size && !run.exited) {
    run.proc.kill()
    runs.delete(run.id)
  }
}

// Serialize snapshots and mutations within one workspace, never across projects.
function afterWorkspaceOperation<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
  const previous = workspaceOperations.get(cwd) ?? Promise.resolve()
  const result = previous.then(operation)
  const settled = result.then(() => undefined, () => undefined)
  workspaceOperations.set(cwd, settled)
  settled.then(() => { if (workspaceOperations.get(cwd) === settled) workspaceOperations.delete(cwd) })
  return result
}

function queueEnvelope(run: AgentRun): Envelope {
  return { kind: "queue", messages: [...run.queue], paused: run.queuePaused }
}
export function emit(run: AgentRun, envelope: Envelope) {
  let finishedTask = false
  if (envelope.kind === "agent" && envelope.message.type === "system") {
    const message = envelope.message
    if ((message.subtype === "init" || message.subtype === "status") && message.permissionMode) { run.mode = message.permissionMode; runModes.set(run.id, message.permissionMode) }
    if (message.subtype === "task_started" || message.subtype === "task_progress") (run.activeTasks ??= new Set()).add(message.task_id)
    else if (message.subtype === "task_notification" && ["completed", "failed", "stopped"].includes(message.status ?? "")) {
      run.activeTasks?.delete(message.task_id)
      finishedTask = true
    }
  }
  if (envelope.kind === "turn-diff" && envelope.updateOnly) {
    for (const item of run.history ?? []) if (item.kind === "turn-diff" && item.diff.turnIndex === envelope.diff.turnIndex) item.diff = envelope.diff
  }
  if (envelope.kind === "agent") {
    const message = envelope.message
    if (message.type === "tool_progress") run.journal = run.journal.filter(entry => !(entry.kind === "agent" && entry.message.type === "tool_progress" && entry.message.tool_use_id === message.tool_use_id))
    if (message.type === "system" && (message.subtype === "hook_progress" || message.subtype === "hook_response")) run.journal = run.journal.filter(entry => !(entry.kind === "agent" && entry.message.type === "system" && entry.message.subtype === "hook_progress" && entry.message.hook_id === message.hook_id))
    if (message.type === "system" && message.subtype === "task_progress") run.journal = run.journal.filter(entry => !(entry.kind === "agent" && entry.message.type === "system" && entry.message.subtype === "task_progress" && entry.message.task_id === message.task_id))
  }
  if (envelope.kind === "log" && run.journal.filter(entry => entry.kind === "log").length >= 50) {
    const oldest = run.journal.findIndex(entry => entry.kind === "log")
    run.journal.splice(oldest, 1)
  }
  if (envelope.kind === "queue") run.journal = run.journal.filter((entry) => entry.kind !== "queue")
  // Keep only the latest live summary so a reconnect cannot replay every
  // intermediate patch, and never replay transient action dialogs.
  if (envelope.kind === "turn-diff-live")
    run.journal = run.journal.filter((entry) => entry.kind !== "turn-diff-live")
  if (envelope.kind === "turn-diff")
    run.journal = run.journal.filter((entry) => entry.kind !== "turn-diff-live")
  if (envelope.kind === "agent" && envelope.message.type === "stream_event" && envelope.message.event.type === "message_stop") {
    const parent = envelope.message.parent_tool_use_id
    let start = run.journal.length - 1
    while (start >= 0) {
      const entry = run.journal[start]!
      if (entry.kind === "agent" && entry.message.type === "stream_event" && entry.message.parent_tool_use_id === parent && entry.message.event.type === "message_start") break
      start--
    }
    if (start >= 0) {
      const message = (run.journal[start] as Extract<Envelope, { kind: "agent" }>).message as Extract<AgentMessage, { type: "stream_event" }>
      const id = message.event.type === "message_start" ? message.event.message.id : undefined
      const tail = run.journal.slice(start)
      const starts = tail.filter(entry => entry.kind === "agent" && entry.message.type === "stream_event" && entry.message.parent_tool_use_id === parent && entry.message.event.type === "content_block_start").length
      const confirmed = tail.flatMap(entry => entry.kind === "agent" && entry.message.type === "assistant" && entry.message.parent_tool_use_id === parent && entry.message.message.id === id ? entry.message.message.content : []).length
      // Only discard deltas after this model message is complete and canonical blocks exist.
      if (starts > 0 && confirmed >= starts) run.journal = run.journal.filter((entry, index) => index < start || !(entry.kind === "agent" && entry.message.type === "stream_event" && entry.message.parent_tool_use_id === parent))
    }
  }
  if (envelope.kind !== "turn-diff-action") run.journal.push(envelope)
  for (const client of run.clients) client.send(JSON.stringify(envelope))
  if (finishedTask) reclaimIfIdle(run)
}
function write(run: AgentRun, message: unknown) {
  run.proc.stdin.write(`${JSON.stringify(message)}\n`)
  run.proc.stdin.flush()
}
async function lines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let at: number
    while ((at = buffer.indexOf("\n")) !== -1) {
      onLine(buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
    }
  }
  if (buffer) onLine(buffer)
}
function flushTimeline(run: AgentRun) {
  run.pendingTimeline = (run.pendingTimeline ?? []).filter(record => {
    try {
      const afterUuid = findTurnUserMessage(run.cwd, record.sessionId, record.offset, true)
      if (!afterUuid) return true
      appendTimelineEvent(run.cwd, record.sessionId, { turn: record.turn, afterUuid, message: record.message })
    }
    catch (error) { emit(run, { kind: "log", text: `Could not save activity: ${String(error)}` }) }
    return false
  })
}

async function startNext(run: AgentRun) {
  await afterWorkspaceOperation(run.cwd, () => startNextSerialized(run))
}

async function startNextSerialized(run: AgentRun) {
  if (run.busy || run.waiting.size || run.exited || !run.queue.length) return
  const next = run.queue[0]!
  run.busy = true
  run.turnSucceeded = undefined
  const index = ++run.turnCounter
  // Snapshot before the user message is written, so the turn's diff starts here.
  const transcriptOffset = run.sessionId ? await fileSize(transcriptPath(run.cwd, run.sessionId)) : 0
  const before = await captureTree(run.cwd).catch(() => null)
  if (run.exited) {
    await disposeSnapshot(before)
    run.busy = false
    emit(run, queueEnvelope(run))
    return
  }
  run.queue.shift()
  flushTimeline(run)
  run.pendingTimeline = []
  run.lastTranscriptUuid = undefined
  run.turn = { index, transcriptOffset, startedAt: Date.now(), before, changes: createChangeCollector() }
  emit(run, queueEnvelope(run))
  emit(run, { kind: "user", id: next.id, content: next.content })
  write(run, { type: "user", message: { role: "user", content: next.content }, parent_tool_use_id: null, uuid: next.id })
}

function trackTurnResult(run: AgentRun, message: AgentMessage) {
  const turn = run.turn
  if (!turn || message.type !== "user") return
  const hasToolResult = Array.isArray(message.message.content)
    && message.message.content.some((block) => block.type === "tool_result")
  if (!hasToolResult) return
  let fileChanged = false
  const track = (result: unknown) => {
    if (trackToolResult(turn.changes, result)) fileChanged = true
  }
  if (message.tool_use_result) track(message.tool_use_result)
  if (Array.isArray(message.message.content))
    for (const block of message.message.content)
      if (block.type === "tool_result" && block.tool_use_result) track(block.tool_use_result)
  // The live diff comes from patch batches, not from a git snapshot.
  if (fileChanged) scheduleLiveDiff(run)
}

function scheduleLiveDiff(run: AgentRun) {
  const turn = run.turn
  if (!turn || turn.finalizing || turn.liveTimer) return
  // The first file change appears immediately, then at most twice a second.
  const wait = turn.liveAt ? Math.max(0, 500 - (Date.now() - turn.liveAt)) : 0
  turn.liveTimer = setTimeout(() => {
    turn.liveTimer = undefined
    void computeLiveDiff(run)
  }, wait)
}

export async function computeLiveDiff(run: AgentRun) {
  const turn = run.turn
  if (!turn || turn.finalizing) return
  turn.liveAt = Date.now()
  // Tool-result patches are the live source; the completed card
  // still uses the full tree, which also catches shell-made edits.
  const diff = await collectDiff(run.cwd, turn.changes).catch(() => undefined)
  if (diff !== undefined && run.turn === turn && !turn.finalizing)
    emit(run, { kind: "turn-diff-live", diff: { ...(diff ?? { files: [], additions: 0, deletions: 0 }), turnIndex: turn.index } })
}

async function turnDiffAction(run: AgentRun, turnIndex: number, action: "undo" | "reapply") {
  const fail = (result: TurnDiffActionResult) =>
    emit(run, { kind: "turn-diff-action", turnIndex, action, result })
  await afterWorkspaceOperation(run.cwd, async () => {
    if ([...runs.values()].some((active) => active.cwd === run.cwd && !active.exited && (active.busy || active.waiting.size || active.activeTasks.size)))
      return fail({ ok: false, errorCode: "apply-failed", error: "Wait for running tasks in this workspace to finish before changing a workspace snapshot.", appliedPaths: [], skippedPaths: [], conflictedPaths: [] })
    if (!run.sessionId)
      return fail({ ok: false, errorCode: "no-patch", appliedPaths: [], skippedPaths: [], conflictedPaths: [] })
    const record = findTurnDiff(run.cwd, run.sessionId, turnIndex)
    if (!record)
      return fail({ ok: false, errorCode: "no-patch", appliedPaths: [], skippedPaths: [], conflictedPaths: [] })
    if (record.diff.undoable === false)
      return fail({ ok: false, errorCode: "apply-failed", error: "Undo is unavailable when a turn changes multiple source folders.", appliedPaths: [], skippedPaths: [], conflictedPaths: [] })
    const result = await applyTurnDiff(
      run.cwd,
      record.patch ?? record.diff.patch,
      action === "undo",
      record.diff.files.map((file) => file.path),
    )
    if (result.ok) {
      const updated = setTurnDiffReverted(run.cwd, run.sessionId, turnIndex, action === "undo")
      if (updated) emit(run, { kind: "turn-diff", diff: updated.diff, updateOnly: true })
    }
    emit(run, { kind: "turn-diff-action", turnIndex, action, result })
  })
}

export function finalizeTurnDiff(run: AgentRun): Promise<void> {
  const turn = run.turn
  if (!turn) return Promise.resolve()
  if (turn.finalizing) return turn.finalizing
  if (turn.liveTimer) clearTimeout(turn.liveTimer)
  turn.finalizing = afterWorkspaceOperation(run.cwd, async () => {
    try {
      const after = await captureTree(run.cwd).catch(() => null)
      try {
        // Keep the full patch for Undo; only the client view is capped.
        let diff = turn.before && after
          ? await diffTrees(run.cwd, turn.before, after, Number.POSITIVE_INFINITY).catch(() => null)
          : null
        const fallback = run.additionalDirectories.length
          ? await collectDiff(run.cwd, turn.changes).catch(() => null)
          : null
        if (fallback) diff = mergeTurnDiffs(diff, fallback)
        // Outside git, rebuild the turn from the tool results the CLI returned.
        let collected = false
        if (!diff) {
          const result = await collectDiff(run.cwd, turn.changes).catch(() => undefined)
          if (result !== undefined) { diff = result; collected = true }
        }
        if (!diff || diff.files.length === 0) {
          if ((turn.before && after && turn.before.tree === after.tree && !fallback) || (!turn.before && collected))
            emit(run, { kind: "turn-diff-live", diff: { files: [], additions: 0, deletions: 0, turnIndex: turn.index } })
          return
        }
        const view = diffForView(diff)
        const shown = { ...view.diff, turnIndex: turn.index }
        const userMessageId = run.sessionId
          ? findTurnUserMessage(run.cwd, run.sessionId, turn.transcriptOffset)
          : undefined
        if (run.sessionId) {
          try {
            appendTurnDiff(run.cwd, run.sessionId, {
              index: turn.index,
              userMessageId,
              diff: shown,
              patch: view.fullPatch,
            })
          } catch {
            // A read-only config dir should not take down the turn.
          }
        }
        emit(run, { kind: "turn-diff", diff: shown })
      } finally {
        await disposeSnapshot(turn.before)
        await disposeSnapshot(after)
      }
    } finally {
      run.turn = undefined
    }
  })
  return turn.finalizing
}
export function attachAgent(ws: ServerWebSocket<SocketData>, root: string) {
  let run = runs.get(ws.data.runtimeId)
  if (!run && ws.data.resume)
    run = [...runs.values()].find(
      (r) =>
        r.cwd === ws.data.cwd &&
        r.sessionId === ws.data.resume &&
        !r.exited &&
        // A replacement can start while the previous CLI finalizes; the
        // workspace operation queue orders its snapshot after the old one.
        (r.clients.size > 0 || (r.busy && !r.turn?.finalizing) || r.queue.length > 0 || r.waiting.size > 0),
    )
  if (run && run.cwd !== ws.data.cwd) {
    ws.close(1008, "Workspace mismatch")
    return
  }
  if (!run || run.exited) {
    const args = [
      process.execPath,
      join(root, "run-noa.js"),
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
    ]
    const additionalDirectories = projectAdditionalDirectories(root, ws.data.cwd)
    if (additionalDirectories.length) args.push("--add-dir", ...additionalDirectories)
    if (ws.data.resume) args.push("--resume", ws.data.resume)
    // A respawn keeps the mode the session was in; only start-safe modes are restored, never bypass.
    const lastMode = run?.mode ?? runModes.get(ws.data.runtimeId)
    const startMode = lastMode && SPAWN_PERMISSION_MODES.has(lastMode) ? lastMode : ws.data.mode
    if (startMode) args.push("--permission-mode", startMode)
    const retainedQueue = run?.queue ?? []
    // A resumed session continues from its transcript turn count, not from the
    // last stored diff, so skipped-diff turns do not shift later indexes.
    const priorTurn = ws.data.resume
      ? Math.max(
          readTurnDiffs(ws.data.cwd, ws.data.resume).reduce((max, record) => Math.max(max, record.index), 0),
          countUserTurns(ws.data.cwd, ws.data.resume),
        )
      : 0
    const proc = Bun.spawn(args, {
      cwd: ws.data.cwd,
      env: {
        ...process.env,
        CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
        CLAUDE_CODE_EAGER_FLUSH: "1",
        // Per-turn file-history checkpoints back the non-git diff fallback.
        CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    run = {
      id: ws.data.runtimeId,
      cwd: ws.data.cwd,
      additionalDirectories,
      mode: startMode,
      sessionId: ws.data.resume,
      proc,
      clients: new Set(),
      journal: retainedQueue.length ? [{ kind: "queue", messages: retainedQueue, paused: false }] : [],
      queue: retainedQueue,
      busy: false,
      turnCounter: priorTurn,
      waiting: new Set(),
      activeTasks: new Set(),
      initializeWaiters: new Map(),
      historyReady: Promise.resolve(),
      exited: false,
    }
    if (ws.data.resume) {
      const current = run
      current.historyReady = loadHistory(run.cwd, ws.data.resume)
        .then((items) => {
          if (!items) throw new Error("Task history not found")
          current.history = items
          current.journal.unshift({ kind: "history", ...historyPage(items) })
        })
        .catch((error) => {
          emit(current, { kind: "log", text: `Cannot restore task: ${String(error)}` })
          current.proc.kill()
        })
    }
    runs.set(run.id, run)
    const current = run
    lines(proc.stdout, (line) => {
      if (!line.trim()) return
      let message: AgentMessage
      try {
        message = JSON.parse(line)
      } catch {
        emit(current, { kind: "log", text: line })
        return
      }
      if (message.type === "control_response") {
        const refreshedCommands = (message.response.response as { commands?: unknown } | undefined)?.commands
        if (message.response.subtype === "success" && Array.isArray(refreshedCommands) && current.initialization) {
          const original = current.initialization.response.response as Record<string, unknown>
          current.initialization = { ...current.initialization, response: { ...current.initialization.response, response: { ...original, commands: refreshedCommands } } }
        }
        if (message.response.request_id === current.initializationRequest) {
          if (message.response.subtype === "success") current.initialization = message
          for (const [client, requestId] of current.initializeWaiters)
            client.send(
              JSON.stringify({
                kind: "agent",
                message: { ...message, response: { ...message.response, request_id: requestId } },
              }),
            )
          current.initializeWaiters.clear()
          current.initializationRequest = undefined
        } else for (const client of current.clients) client.send(JSON.stringify({ kind: "agent", message }))
        return
      }
      if ((message.type === "assistant" || message.type === "user" || message.type === "result") && !message.parent_tool_use_id) flushTimeline(current)
      if ((message.type === "assistant" || message.type === "user") && !message.parent_tool_use_id) current.lastTranscriptUuid = (message as { uuid?: string }).uuid ?? current.lastTranscriptUuid
      if (message.type === "system" && ["hook_started", "hook_response", "task_started", "task_notification"].includes(message.subtype)) {
        const sessionId = current.sessionId ?? (message as { session_id?: string }).session_id
        if (sessionId && SESSION_ID.test(sessionId)) {
          try {
            const turn = current.turn?.index ?? current.turnCounter
            const offset = current.turn?.transcriptOffset ?? 0
            const afterUuid = current.lastTranscriptUuid ?? (current.turn ? findTurnUserMessage(current.cwd, sessionId, offset, true) : undefined)
            if (!afterUuid && turn > 0) (current.pendingTimeline ??= []).push({ sessionId, turn, offset, message })
            else appendTimelineEvent(current.cwd, sessionId, { turn, afterUuid, message })
          }
          catch (error) { emit(current, { kind: "log", text: `Could not save activity: ${String(error)}` }) }
        }
      }
      if (message.type === "system" && message.subtype === "init") current.sessionId = message.session_id
      if (message.type === "control_request") current.waiting.add(message.request_id)
      if (message.type === "control_cancel_request") current.waiting.delete(message.request_id)
      trackTurnResult(current, message)
      emit(current, { kind: "agent", message })
      if (message.type === "result" && !message.parent_tool_use_id) {
        if (message.is_error && current.sessionId && current.turn && !current.turn.interrupted) {
          try {
            appendTurnResult(current.cwd, current.sessionId, { index: current.turn.index, userMessageId: findTurnUserMessage(current.cwd, current.sessionId, current.turn.transcriptOffset), durationMs: message.duration_ms, error: message.errors?.join("\n") || `Agent failed (${message.subtype})` })
          } catch (error) { emit(current, { kind: "log", text: `Could not save turn result: ${String(error)}` }) }
        }
        current.turnSucceeded = !message.is_error
        void finalizeTurnDiff(current)
      }
      if (message.type === "system" && message.subtype === "session_state_changed" && message.state === "idle") {
        // Hold the next queued turn until the finished turn's diff is written, so
        // its after-tree and the next turn's before-tree cannot race.
        void (async () => {
          await finalizeTurnDiff(current)
          current.busy = false
          if (current.turnSucceeded && !current.queuePaused) void startNext(current)
          reclaimIfIdle(current)
        })()
      }
    }).catch((error) => emit(current, { kind: "log", text: String(error) }))
    lines(proc.stderr, (text) => emit(current, { kind: "log", text })).catch(() => {})
    proc.exited.then((code) => {
      try { flushTimeline(current) } catch (error) { emit(current, { kind: "log", text: `Could not save activity: ${String(error)}` }) }
      if (current.turn && current.sessionId && current.turnSucceeded === undefined && !current.turn.interrupted) {
        try {
          appendTurnResult(current.cwd, current.sessionId, {
            index: current.turn.index,
            userMessageId: findTurnUserMessage(current.cwd, current.sessionId, current.turn.transcriptOffset),
            durationMs: Date.now() - current.turn.startedAt,
            error: `Agent exited before completing this turn (code ${code}).`,
          })
        } catch (error) { emit(current, { kind: "log", text: `Could not save turn result: ${String(error)}` }) }
      }
      current.exited = true
      current.busy = false
      void finalizeTurnDiff(current)
      if (!current.queue.length && runs.get(current.id) === current) runs.delete(current.id)
      emit(current, { kind: "exit", code })
    })
  }
  ws.data.run = run
  const current = run
  current.historyReady.then(() => {
    if (ws.readyState !== 1) return
    current.clients.add(ws)
    ws.send(JSON.stringify({ kind: "attached", runtimeId: current.id, mode: current.mode }))
    for (const envelope of current.journal) ws.send(JSON.stringify(envelope))
  })
}
export async function agentMessage(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
  const run = ws.data.run
  if (!run || run.exited || typeof raw !== "string") return
  await run.historyReady
  if (run.exited) return
  let message: Outgoing
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }
  if (message.type === "history_before") {
    if (Number.isInteger(message.before) && message.before > 0 && run.history && message.before <= run.history.length)
      ws.send(JSON.stringify({ kind: "history", prepend: true, ...historyPage(run.history, message.before) }))
    return
  }
  if (message.type === "turn_diff_action") {
    void turnDiffAction(run, message.turnIndex, message.action)
    return
  }
  if (message.type === "user") {
    const content = message.message.content
    if (!run.title)
      run.title =
        (typeof content === "string"
          ? content
          : content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join(" ")
        ).slice(0, 80) || "Image task"
    if (!run.busy) run.queuePaused = false
    run.queue.push({ id: crypto.randomUUID(), content })
    emit(run, queueEnvelope(run))
    void startNext(run)
  } else if (message.type === "queue_remove") {
    run.queue = run.queue.filter((m) => m.id !== message.id)
    emit(run, queueEnvelope(run))
  } else if (message.type === "queue_move") {
    const from = run.queue.findIndex((item) => item.id === message.id)
    if (from !== -1) {
      const [item] = run.queue.splice(from, 1)
      if (item) run.queue.splice(Math.max(0, Math.min(message.toIndex, run.queue.length)), 0, item)
      emit(run, queueEnvelope(run))
    }
  } else if (message.type === "queue_update") {
    const item = run.queue.find((candidate) => candidate.id === message.id)
    if (item) {
      item.content = message.content
      emit(run, queueEnvelope(run))
    }
  } else if (message.type === "queue_steer") {
    const index = run.queue.findIndex((item) => item.id === message.id)
    const item = index === -1 ? undefined : run.queue[index]
    if (item && run.busy) {
      run.queue.splice(index, 1)
      emit(run, queueEnvelope(run))
      emit(run, { kind: "user", id: item.id, content: item.content })
      write(run, { type: "user", message: { role: "user", content: item.content }, parent_tool_use_id: null, uuid: item.id })
    }
  } else if (message.type === "queue_pause") {
    run.queuePaused = message.paused
    emit(run, queueEnvelope(run))
  } else if (message.type === "queue_run") {
    run.queuePaused = false
    void startNext(run)
  } else if (message.type === "control_request" && message.request.subtype === "initialize") {
    if (run.initialization)
      ws.send(
        JSON.stringify({
          kind: "agent",
          message: {
            ...run.initialization,
            response: { ...run.initialization.response, request_id: message.request_id },
          },
        }),
      )
    else {
      run.initializeWaiters.set(ws, message.request_id)
      if (!run.initializationRequest) {
        run.initializationRequest = message.request_id
        write(run, message)
      }
    }
  } else {
    if (message.type === "control_request" && message.request.subtype === "interrupt") {
      run.queuePaused = true
      if (run.turn) run.turn.interrupted = true
      emit(run, { kind: "interrupt" })
    }
    if (message.type === "control_response") {
      run.waiting.delete(message.response.request_id)
      emit(run, { kind: "agent", message: { type: "control_cancel_request", request_id: message.response.request_id } })
    }
    write(run, message)
  }
}
export function detachAgent(ws: ServerWebSocket<SocketData>) {
  const run = ws.data.run
  if (!run) return
  run.clients.delete(ws)
  run.initializeWaiters.delete(ws)
  const idle = () => !run.clients.size && !run.busy && !run.queue.length && !run.waiting.size && !run.exited
  if (idle()) {
    reclaimIfIdle(run)
    return
  }
  // The turn's diff is computed after the result while busy stays true; reap the
  // CLI once finalization has settled rather than leaving an orphaned run.
  if (!run.clients.size && run.turn?.finalizing) {
    void run.turn?.finalizing?.then(() => setTimeout(() => {
      reclaimIfIdle(run)
    }, 0))
  }
}
export function listAgentRuns() {
  return [...runs.values()]
    .filter((r) => r.busy || r.queue.length || r.waiting.size || (r.sessionId && !r.exited))
    .map((r) => ({
      runtimeId: r.id,
      cwd: r.cwd,
      sessionId: r.sessionId,
      title: r.title,
      busy: r.busy,
      waiting: r.waiting.size > 0,
      queued: r.queue.length,
    }))
}
function shutdown() {
  for (const run of runs.values()) if (!run.exited) run.proc.kill()
}
process.on("SIGTERM", () => {
  shutdown()
  process.exit(0)
})
process.on("SIGINT", () => {
  shutdown()
  process.exit(0)
})
