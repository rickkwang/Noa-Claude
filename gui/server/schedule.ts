// Scheduled tasks: a prompt that starts a new task in a project on a frequency. They live in the GUI's own
// store, not in a project's .noa/scheduled_tasks.json, because that file is fired by any CLI session open in
// the project and a task in both places would run twice. The bridge fires them while it runs.
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { computeNextCronRun, cronToHuman, parseCronExpression } from "../../src/utils/cron"
import { configHome, renameSession } from "./sessions"
import { SPAWN_PERMISSION_MODES, sendToSession } from "./agents"

export type Frequency =
  | { kind: "manual" }
  | { kind: "hourly" }
  | { kind: "daily" | "weekdays"; time: string }
  | { kind: "weekly"; time: string; weekday: number }
  | { kind: "cron"; cron: string }

interface ScheduleTask {
  id: string
  name: string
  prompt: string
  cwd: string
  frequency: Frequency
  mode: string
  enabled: boolean
  createdAt: number
  // When the task last ran, for display; and when the schedule last fired it, which is what the clock counts
  // from (a manual run does not move it).
  lastRunAt?: number
  lastFiredAt?: number
  lastSessionId?: string
  lastError?: string
}

export interface ScheduleView extends ScheduleTask {
  cron: string
  // Human reading of the frequency, and when the task fires next (epoch ms; unset for manual or off).
  summary: string
  nextRunAt?: number
}

const TICK_MS = 30_000
const storePath = () => join(configHome(), "gui-schedules.json")
function readStore(): ScheduleTask[] {
  try { return JSON.parse(readFileSync(storePath(), "utf8")).tasks ?? [] } catch { return [] }
}
function writeStore(tasks: ScheduleTask[]) {
  writeFileSync(storePath(), JSON.stringify({ tasks }, null, 2))
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

function cronOf(frequency: Frequency): string {
  switch (frequency.kind) {
    case "manual": return ""
    case "hourly": return "0 * * * *"
    case "cron": return frequency.cron.trim().split(/\s+/).join(" ")
    default: {
      const [hour, minute] = frequency.time.split(":").map(Number)
      const days = "weekday" in frequency ? String(frequency.weekday) : frequency.kind === "daily" ? "*" : "1-5"
      return `${minute} ${hour} * * ${days}`
    }
  }
}

function frequencyError(frequency: Frequency | undefined): string | undefined {
  if (!frequency) return "Choose a frequency"
  if (frequency.kind === "cron") return typeof frequency.cron === "string" && parseCronExpression(cronOf(frequency)) ? undefined : "Enter a valid 5-field cron expression."
  if (frequency.kind === "daily" || frequency.kind === "weekdays" || frequency.kind === "weekly") {
    if (!TIME.test(frequency.time)) return "Enter a valid time"
    if ("weekday" in frequency && !(Number.isInteger(frequency.weekday) && frequency.weekday >= 0 && frequency.weekday <= 6)) return "Choose a weekday"
  }
  return ["manual", "hourly", "daily", "weekdays", "weekly", "cron"].includes(frequency.kind) ? undefined : "Choose a frequency"
}

function nextRun(cron: string, from: number): number | undefined {
  const fields = cron ? parseCronExpression(cron) : null
  return fields ? computeNextCronRun(fields, new Date(from))?.getTime() : undefined
}

function view(task: ScheduleTask): ScheduleView {
  const cron = cronOf(task.frequency)
  const summary = task.frequency.kind === "manual" ? "Manual only" : cron === "* * * * *" ? "Every minute" : cronToHuman(cron)
  return { ...task, cron, summary, nextRunAt: task.enabled && cron ? Math.max(Date.now(), nextRun(cron, task.lastFiredAt ?? task.createdAt) ?? 0) || undefined : undefined }
}

export function listSchedules(): ScheduleView[] {
  return readStore().map(view).sort((a, b) => a.name.localeCompare(b.name))
}

let cliRoot = ""
let allowedFolder: (cwd: string) => boolean = () => false

async function fire(id: string, manual: boolean): Promise<{ sessionId: string; cwd: string }> {
  const task = readStore().find((t) => t.id === id)
  if (!task) throw new Error("This scheduled task couldn’t be found.")
  if (!allowedFolder(task.cwd)) throw new Error("This task’s project is no longer in your list.")
  const sessionId = crypto.randomUUID()
  const save = (patch: Partial<ScheduleTask>) => writeStore(readStore().map((t) => (t.id === id ? { ...t, ...patch } : t)))
  // Recorded before the run starts so a slow start is not fired a second time by the next tick.
  save({ lastRunAt: Date.now(), ...(manual ? {} : { lastFiredAt: Date.now() }), lastSessionId: sessionId, lastError: undefined })
  try {
    await sendToSession({ cwd: task.cwd, sessionId, isNew: true, mode: task.mode }, task.prompt, cliRoot)
    try { renameSession(task.cwd, sessionId, task.name) } catch {}
  } catch (error) {
    save({ lastError: (error as Error).message })
    throw error
  }
  return { sessionId, cwd: task.cwd }
}

// `allowed` says whether a folder is a listed project that still exists.
export function initSchedule(root: string, allowed: (cwd: string) => boolean) {
  cliRoot = root
  allowedFolder = allowed
  const tick = () => {
    const now = Date.now()
    for (const task of readStore()) {
      const cron = cronOf(task.frequency)
      if (!task.enabled || !cron) continue
      const next = nextRun(cron, task.lastFiredAt ?? task.createdAt)
      if (next !== undefined && next <= now) void fire(task.id, false).catch(() => {})
    }
  }
  tick()
  setInterval(tick, TICK_MS).unref?.()
}

type Body = { action?: unknown; id?: unknown; name?: unknown; prompt?: unknown; cwd?: unknown; frequency?: Frequency; mode?: unknown; enabled?: unknown }

export async function scheduleAction(raw: unknown): Promise<{ status: number; body: unknown }> {
  const body = (raw ?? {}) as Body
  const fail = (error: string, status = 400) => ({ status, body: { error } })
  const tasks = readStore()
  const existing = typeof body.id === "string" ? tasks.find((t) => t.id === body.id) : undefined
  if (body.action === "delete" || body.action === "run" || body.action === "update" || body.action === "duplicate") {
    if (!existing) return fail("This scheduled task couldn’t be found.", 404)
  }
  if (body.action === "delete") {
    writeStore(tasks.filter((t) => t !== existing))
    return { status: 200, body: listSchedules() }
  }
  if (body.action === "run") {
    try { return { status: 200, body: await fire(existing!.id, true) } } catch (error) { return fail((error as Error).message, 500) }
  }
  if (body.action === "duplicate") {
    let name = `${existing!.name} copy`
    while (tasks.some((t) => t.name.toLowerCase() === name.toLowerCase())) name += " copy"
    writeStore([...tasks, { ...existing!, id: crypto.randomUUID(), name, createdAt: Date.now(), lastRunAt: undefined, lastFiredAt: undefined, lastSessionId: undefined, lastError: undefined }])
    return { status: 200, body: listSchedules() }
  }
  if (body.action === "update" && Object.keys(body).every((key) => ["action", "id", "enabled"].includes(key))) {
    if (typeof body.enabled !== "boolean") return fail("Expected enabled")
    // Turning a task back on starts its clock from now, so the time it was off does not count as a missed run.
    writeStore(tasks.map((t) => (t === existing ? { ...t, enabled: body.enabled as boolean, lastError: undefined, ...(body.enabled && !t.enabled ? { createdAt: Date.now(), lastRunAt: undefined, lastFiredAt: undefined } : {}) } : t)))
    return { status: 200, body: listSchedules() }
  }
  if (body.action !== "create" && body.action !== "update") return fail("Unknown action")

  const name = typeof body.name === "string" ? body.name.trim() : ""
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  const mode = typeof body.mode === "string" && SPAWN_PERMISSION_MODES.has(body.mode) ? body.mode : "acceptEdits"
  if (!name) return fail("Enter a name")
  if (!prompt) return fail("Enter a prompt")
  if (typeof body.cwd !== "string" || !allowedFolder(resolve(body.cwd))) return fail("Choose one of your projects")
  const problem = frequencyError(body.frequency)
  if (problem) return fail(problem)
  if (tasks.some((t) => t.id !== existing?.id && t.name.toLowerCase() === name.toLowerCase())) return fail(`A scheduled task named “${name}” already exists.`)

  const fields = { name, prompt, cwd: resolve(body.cwd), frequency: body.frequency!, mode }
  if (existing) {
    const changedSchedule = cronOf(existing.frequency) !== cronOf(fields.frequency)
    writeStore(tasks.map((t) => (t === existing ? { ...t, ...fields, lastError: undefined, ...(changedSchedule ? { createdAt: Date.now(), lastRunAt: undefined, lastFiredAt: undefined } : {}) } : t)))
  } else {
    writeStore([...tasks, { ...fields, id: crypto.randomUUID(), enabled: true, createdAt: Date.now() }])
  }
  return { status: 200, body: listSchedules() }
}
