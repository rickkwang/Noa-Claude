import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computeLiveDiff, detachAgent, emit, finalizeTurnDiff } from "../server/agents"
import { createChangeCollector } from "../server/turnDiff"

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
