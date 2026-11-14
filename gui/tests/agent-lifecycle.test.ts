import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agentMessage, computeLiveDiff, detachAgent, emit, finalizeTurnDiff } from "../server/agents"
import { captureTree, createChangeCollector } from "../server/turnDiff"

test("queue moves use visible indexes while a message is starting", async () => {
  const run: any = { queue: ["a", "b", "c"].map(id => ({ id, content: id })), startingMessageId: "a", historyReady: Promise.resolve(), clients: new Set(), journal: [] }
  const socket: any = { data: { run } }
  await agentMessage(socket, JSON.stringify({ type: "queue_move", id: "b", toIndex: 1 }))
  expect(run.queue.map((message: any) => message.id)).toEqual(["a", "c", "b"])
  await agentMessage(socket, JSON.stringify({ type: "queue_move", id: "b", toIndex: 0 }))
  expect(run.queue.map((message: any) => message.id)).toEqual(["a", "b", "c"])
})

test("a detached background task keeps its agent alive until its terminal event", () => {
  let killed = 0
  const socket: any = { data: {}, send: () => {} }
  const run: any = { id: "fixture", clients: new Set([socket]), journal: [], queue: [], waiting: new Set(), initializeWaiters: new Map(), busy: false, exited: false, proc: { kill: () => { killed++ } } }
  socket.data.run = run
  emit(run, { kind: "agent", message: { type: "system", subtype: "task_started", task_id: "background" } })
  detachAgent(socket)
  expect(killed).toBe(0)
  emit(run, { kind: "agent", message: { type: "system", subtype: "task_notification", task_id: "background", status: "completed" } })
  expect(killed).toBe(1)
})

test("live changes clear when a file returns to its original contents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "noa-live-empty-"))
  try {
    const path = join(cwd, "file.txt"), changes = createChangeCollector()
    changes.files.set(path, "original\n")
    const run: any = { cwd, clients: new Set(), journal: [], turn: { index: 1, changes } }
    await writeFile(path, "changed\n")
    await computeLiveDiff(run)
    expect(run.journal.at(-1).diff.files).toHaveLength(1)
    await writeFile(path, "original\n")
    await computeLiveDiff(run)
    expect(run.journal).toHaveLength(1)
    expect(run.journal[0].diff.files).toEqual([])
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("non-git turn clears its live diff when a shell restores the file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "noa-live-nongit-"))
  try {
    const path = join(cwd, "file.txt"), changes = createChangeCollector()
    changes.files.set(path, "original\n")
    const run: any = { cwd, additionalDirectories: [], clients: new Set(), journal: [], turn: { index: 1, changes, before: null } }
    await writeFile(path, "changed\n")
    await computeLiveDiff(run)
    expect(run.journal[0].diff.files).toHaveLength(1)
    await writeFile(path, "original\n")
    await finalizeTurnDiff(run)
    expect(run.journal.at(-1).diff.files).toEqual([])
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("a git turn's diff leaves out files another session changed meanwhile", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "noa-turn-scope-"))
  try {
    Bun.spawnSync(["git", "init", "-q", cwd])
    const ours = join(cwd, "ours.txt"), theirs = join(cwd, "theirs.txt"), changes = createChangeCollector()
    await writeFile(ours, "original\n")
    await writeFile(theirs, "original\n")
    const run: any = { cwd, additionalDirectories: [], clients: new Set(), journal: [], turn: { index: 1, changes, before: await captureTree(cwd) } }
    changes.files.set(ours, "original\n")
    await writeFile(ours, "changed\n")
    await writeFile(theirs, "changed elsewhere\n")
    await finalizeTurnDiff(run)
    const diff = run.journal.at(-1).diff
    expect(diff.files.map((file: any) => file.path)).toEqual(["ours.txt"])
    expect(diff.patch).not.toContain("theirs.txt")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("a git turn that also edits a file outside the repository keeps an undoable git patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "noa-turn-outside-"))
  try {
    const cwd = join(root, "repo", "pkg"), outside = join(root, "notes.md"), ours = join(cwd, "ours.txt"), changes = createChangeCollector()
    await mkdir(cwd, { recursive: true })
    Bun.spawnSync(["git", "init", "-q", join(root, "repo")])
    await writeFile(ours, "original\n")
    await writeFile(outside, "original\n")
    const run: any = { cwd, additionalDirectories: [], clients: new Set(), journal: [], turn: { index: 1, changes, before: await captureTree(cwd) } }
    for (const path of [ours, outside]) { changes.files.set(path, "original\n"); await writeFile(path, "changed\n") }
    await finalizeTurnDiff(run)
    const diff = run.journal.at(-1).diff
    expect(diff.files.map((file: any) => file.path)).toEqual(["ours.txt"])
    expect(diff.patch).toStartWith("diff --git")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("a failed session action write releases its workspace and replies with an error", async () => {
  const responses: any[] = []
  const socket: any = { data: {}, send: (raw: string) => responses.push(JSON.parse(raw)) }
  const run: any = {
    id: "failed-write", cwd: "/fixture/failed-write", clients: new Set([socket]), journal: [],
    historyReady: Promise.resolve(), busy: false, exited: false, queue: [], waiting: new Map(), activeTasks: new Set(),
    proc: { stdin: { write: () => { throw new Error("pipe closed") } } },
  }
  socket.data.run = run
  for (const requestId of ["first", "retry"]) {
    await agentMessage(socket, JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "session_action", action: "fork" } }))
    expect(run.sessionAction).toBeUndefined()
    expect(responses.some(event => event.kind === "agent" && event.message.type === "control_response" && event.message.response.request_id === requestId && event.message.response.subtype === "error")).toBe(true)
  }
})
