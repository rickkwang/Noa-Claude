/**
 * Background sessions from the shell: `noa attach|logs|stop|kill|respawn|rm
 * <id>`, `noa --bg <task>` and `noa agents --json`. `<id>` is a job id (as
 * `noa agents` and /background print it), a unique prefix of one, or a
 * session id.
 */
import { attachToJob, readJobOutput } from '../../utils/background/attach.js'
import { dispatchJob, reviveJob } from '../../utils/background/dispatch.js'
import { formatBackgrounded, passthroughLaunchFlags } from '../../utils/background/fork.js'
import { isAgentViewDisabled } from '../../utils/background/gate.js'
import { ensureHost } from '../../utils/background/host.js'
import { deleteJob, type Job, listJobs, readJob, stopJob } from '../../utils/background/jobs.js'
import { DETACH_SEQUENCE } from '../../utils/background/ptyProtocol.js'
import { readAllSessions } from '../../utils/background/sessionRegistry.js'
import { queueJobReply } from '../../utils/background/replies.js'

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

async function resolveJob(id: string): Promise<Job> {
  const jobs = await listJobs()
  const exact = jobs.find(j => j.short === id || j.sessionId === id)
  if (exact) return exact
  const matches = jobs.filter(j => j.short.startsWith(id) || j.sessionId.startsWith(id))
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) fail(`"${id}" matches ${matches.length} background sessions — use more of the id (see \`noa agents --json\`)`)
  return fail(`No background session "${id}" — \`noa agents\` lists them`)
}

/** Resolves with the short id when the user detached (the caller shows the agents view); exits otherwise. */
export async function attachHandler(id: string): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail('noa attach requires an interactive terminal')
  const job = await resolveJob(id)
  if (!(await ensureHost(job))) fail(`Couldn't open ${job.name ?? job.short}`)
  process.stdout.write('\x1b[?1049h')
  const outcome = await attachToJob(job.short)
  process.stdout.write('\x1b[?1049l')
  const label = job.name ?? job.short
  // The agents view takes over stdin as it is; only a process that is about to exit releases it.
  if (outcome === 'detached' && !isAgentViewDisabled()) return job.short
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.stdin.pause()
  if (outcome === 'unavailable') fail(`Couldn't open ${label}`)
  process.stdout.write(
    outcome === 'detached'
      ? `detached · ${job.short} keeps running — \`noa attach ${job.short}\` reopens it\n`
      : `${label} exited\n`,
  )
  process.exit(0)
}

/** Keep text, colors and cursor movement; drop modes, titles, OSC/DCS/APC and stray controls. */
const SEQUENCE =
  /\x1b\[(?<params>[<-?]?[0-;]*)(?<intermediates>[ -/]*)(?<final>[@-~])|\x1b[\]PX^_][^\x07\x18\x1a\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b(?:\[[0-?]*[ -/]*|[ -/]*)$|\x1b(?<esc>[ -/]*[0-~])|\x1b|[\x00-\x07\x0e-\x1a\x1c-\x1f\x7f-\x9f]/g
const KEPT_FINALS = new Set('ABCDEFGHJKLMPSTXZ@`adefm')
const KEPT_ESCAPES = new Set('78DEM')
const ALT_SCREEN_MODES = new Set(['1049', '1047', '47'])

function keepCsi(params: string, final: string): boolean {
  if (!KEPT_FINALS.has(final)) return false
  if (final !== 'J' && final !== 'T') return true
  const nums = params.split(';').map(p => (/^\d*$/.test(p) ? Number(p) : Number.NaN))
  return final === 'J' ? nums.every(n => n === 0 || n === 1 || n === 2) : nums.length === 1 && !Number.isNaN(nums[0])
}

export function sanitizeReplay(text: string): { replay: string; cursorAddressed: boolean } {
  let cursorAddressed = false
  let out = ''
  let last = 0
  for (const m of text.matchAll(SEQUENCE)) {
    out += text.slice(last, m.index)
    last = m.index! + m[0].length
    const { params = '', intermediates, final, esc } = m.groups ?? {}
    if (final !== undefined) {
      const lead = params[0]
      const privateMode = lead === '?' || lead === '>' || lead === '<' || lead === '='
      if (lead === '?' && final === 'h') {
        if (params.slice(1).split(';').some(p => ALT_SCREEN_MODES.has(p))) cursorAddressed = true
      } else if (!privateMode && !intermediates && keepCsi(params, final)) {
        if (final === 'H' || final === 'f') cursorAddressed = true
        out += m[0]
      }
    } else if (esc !== undefined && esc.length === 1 && KEPT_ESCAPES.has(esc)) {
      out += m[0]
    }
  }
  return { replay: out + text.slice(last), cursorAddressed }
}

export async function logsHandler(id: string): Promise<void> {
  const job = await resolveJob(id)
  if (!job.alive) fail(`${job.name ?? job.short} is not running — no recent output (\`noa attach ${job.short}\` restarts it)`)
  const raw = await readJobOutput(job.short)
  if (raw === null) fail(`Couldn't read logs for ${job.short}`)
  const { replay, cursorAddressed } = sanitizeReplay(raw.split(DETACH_SEQUENCE).join(''))
  const tail = process.stdout.isTTY ? `\x1b[0m${cursorAddressed ? `\x1b[${process.stdout.rows || 9999};1H\n` : ''}` : ''
  process.stdout.write(replay + tail)
  process.exit(0)
}

export async function stopHandler(id: string): Promise<void> {
  const job = await resolveJob(id)
  if (!job.alive && !job.sessionPid) {
    process.stdout.write(`${job.short} is not running\n`)
    process.exit(0)
  }
  if (!(await stopJob(job))) fail(`Couldn't stop ${job.short}`)
  process.stdout.write(`stopped · ${job.short} (transcript kept — \`noa attach ${job.short}\` resumes it)\n`)
  process.exit(0)
}

/** Queue a plain-text user message without opening the terminal or answering a dialog. */
export async function replyHandler(id: string, text: string): Promise<void> {
  const job = await resolveJob(id)
  const uuid = await queueJobReply(job.short, text)
  const current = (await listJobs()).find(j => j.short === job.short)
  if (!current || (!current.alive && !current.sessionPid && !(await ensureHost(current)))) {
    fail(`Reply ${uuid} is saved, but ${job.short} could not start — it will be delivered when the session resumes`)
  }
  process.stdout.write(`queued reply · ${job.short} · ${uuid}\n`)
  process.exit(0)
}

/** Start a stopped session again without opening it: its conversation resumes where it left off. */
export async function respawnHandler(id: string): Promise<void> {
  const job = await resolveJob(id)
  if (job.alive) {
    process.stdout.write(`${job.short} is already running — \`noa attach ${job.short}\` opens it\n`)
    process.exit(0)
  }
  // A refusal (e.g. the transcript is open in a live interactive session) is
  // surfaced; lock contention means another process is starting the host, so
  // fall through to the same polling.
  try {
    await reviveJob(job)
  } catch (e) {
    fail(`Couldn't respawn ${job.short}: ${e instanceof Error ? e.message : String(e)}`)
  }
  // The host writes host.json once it has the session running.
  for (let i = 0; i < 50; i++) {
    const again = (await listJobs()).find(j => j.short === job.short)
    if (again?.alive) {
      process.stdout.write(`respawned · ${job.short} — \`noa attach ${job.short}\` opens it\n`)
      process.exit(0)
    }
    await new Promise(r => setTimeout(r, 100))
  }
  fail(`Couldn't respawn ${job.short}`)
}

/** Stop a session if it is running and delete it, transcript aside, from the list. */
export async function rmHandler(id: string): Promise<void> {
  const job = await resolveJob(id)
  await deleteJob(job)
  if (await readJob(job.short)) fail(`Couldn't remove ${job.short}`)
  process.stdout.write(`removed ${job.short}\n`)
  process.exit(0)
}

/** `noa --bg <task>`: start a background session on the task and return to the shell. */
export async function bgFlagHandler(prompt: string | undefined, argv: string[], picked: string[]): Promise<void> {
  const task = prompt?.trim()
  if (!task) fail("--bg needs a task: noa --bg '<task>'")
  const short = await dispatchJob({
    cwd: process.cwd(),
    prompt: task,
    respawnFlags: [...passthroughLaunchFlags(argv), ...picked],
  })
  process.stdout.write(`${formatBackgrounded(short)}\n`)
  process.exit(0)
}

/** Active sessions — interactive and background — as JSON (`--all` adds finished background ones). */
export async function agentsJsonHandler(opts: { all?: boolean; cwd?: string }): Promise<void> {
  const underCwd = (cwd?: string) => !opts.cwd || (cwd !== undefined && (cwd === opts.cwd || cwd.startsWith(`${opts.cwd}/`)))
  const jobs = (await listJobs()).filter(j => (opts.all || j.alive) && underCwd(j.cwd))
  const jobSessions = new Set(jobs.map(j => j.sessionId))
  const interactive = (await readAllSessions()).filter(
    s => s.alive && s.kind !== 'bg' && !jobSessions.has(s.sessionId ?? '') && underCwd(s.cwd),
  )
  const rows = [
    ...interactive.map(s => ({
      kind: 'interactive' as const,
      sessionId: s.sessionId,
      pid: s.pid,
      cwd: s.cwd,
      name: s.name,
      status: s.status,
      waitingFor: s.waitingFor,
    })),
    ...jobs.map(j => ({
      kind: 'background' as const,
      id: j.short,
      sessionId: j.sessionId,
      cwd: j.cwd,
      name: j.name,
      state: j.state,
      running: j.alive || j.sessionPid !== undefined,
      needs: j.needs,
      detail: j.detail,
      result: j.output?.result,
      updatedAt: j.updatedAt,
    })),
  ]
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
  process.exit(0)
}
