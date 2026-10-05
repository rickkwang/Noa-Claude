/**
 * Background session ("job") records.
 *
 * Every background session owns `<config>/jobs/<short>/state.json`. The
 * session itself (via bgSession.ts) keeps it current; the agents view reads
 * it; the PTY host stamps the terminal outcome when the session exits. The
 * file is the only shared state — there is no daemon.
 */
import { createHash, randomBytes } from 'crypto'
import { mkdirSync, realpathSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { homedir, tmpdir, userInfo } from 'os'
import { connect } from 'net'
import { join, resolve } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getProcessCommand, isProcessRunning } from '../genericProcessUtils.js'
import { PRODUCT_HOME_DIR } from '../productPathConstants.js'
import { sanitizePersistedFlags } from './launchFlags.js'
import { readAllSessions } from './sessionRegistry.js'
import { processBirth } from './processIdentity.js'
import { encodeControl } from './ptyProtocol.js'

/** Where the session is in its lifecycle. */
export type JobState = 'working' | 'blocked' | 'done' | 'failed'
/**
 * Which list the agents view files it under: `blocked` = Needs input,
 * `active` = Working, `idle` = Completed.
 */
export type JobTempo = 'active' | 'blocked' | 'idle'

export type JobRecord = {
  short: string
  sessionId: string
  cwd: string
  name?: string
  /** `user` names (from /rename) are never overwritten by auto-naming. */
  nameSource?: 'auto' | 'user'
  state: JobState
  tempo: JobTempo
  detail: string
  needs?: string
  output?: { result?: string }
  /** Flags every relaunch of this session carries (model, permission mode…). */
  respawnFlags: string[]
  /** The foreground session this one was forked from (/background, ←). */
  forkParentSessionId?: string
  /** The session's first launch, replayed if it never got as far as starting. */
  launchArgs?: string[]
  exitCode?: number | null
  /** Stopped on request (ctrl+x, `noa stop`), not by its own exit or a crash. */
  stopRequested?: boolean
  createdAt: string
  updatedAt: string
}

export type Job = JobRecord & {
  /** From host.json, which only the PTY host writes. */
  hostPid?: number
  /** A live session whose PTY host may have gone away. */
  sessionPid?: number
  /** The PTY host is still running, so the session can be attached. */
  alive: boolean
}

export const IDLE_NEEDS = 'send a prompt to start'
/** `detail` of a session waiting for its first prompt with nothing else to show. */
export const IDLE_DETAIL = `(idle — ${IDLE_NEEDS})`

export function getJobsDir(): string {
  return join(getClaudeConfigHomeDir(), 'jobs')
}

export function getJobDir(short: string): string {
  return join(getJobsDir(), short)
}

function getStatePath(short: string): string {
  return join(getJobDir(short), 'state.json')
}

/**
 * The host's pid lives apart from state.json: the session rewrites
 * state.json as it works, and would race a pid written by anyone else.
 */
function getHostPath(short: string): string {
  return join(getJobDir(short), 'host.json')
}

export async function writeHostPid(short: string, pid: number, sessionPid?: number): Promise<void> {
  const temp = `${getHostPath(short)}.${process.pid}.tmp`
  try {
    const [hostStartedAt, sessionStartedAt] = await Promise.all([processBirth(pid), sessionPid ? processBirth(sessionPid) : undefined])
    await writeFile(temp, JSON.stringify({ pid, hostStartedAt, sessionPid, sessionStartedAt }), { mode: 0o600 })
    await rename(temp, getHostPath(short))
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

export async function readHostPid(short: string): Promise<number | undefined> {
  try {
    const { pid } = JSON.parse(await readFile(getHostPath(short), 'utf8'))
    return typeof pid === 'number' ? pid : undefined
  } catch {
    return undefined
  }
}

/** Liveness is enough to refuse a second launch, but is not authority to send a signal. */
export async function readHostedSessionHint(short: string): Promise<number | undefined> {
  try {
    const { sessionPid } = JSON.parse(await readFile(getHostPath(short), 'utf8'))
    return typeof sessionPid === 'number' && isProcessRunning(sessionPid) ? sessionPid : undefined
  } catch { return undefined }
}

/** Covers a host lost before the child registered its session. */
export async function readHostedSessionPid(short: string): Promise<number | undefined> {
  try {
    const { sessionPid, sessionStartedAt } = JSON.parse(await readFile(getHostPath(short), 'utf8'))
    if (typeof sessionPid !== 'number' || !isProcessRunning(sessionPid) || typeof sessionStartedAt !== 'string') return undefined
    return await processBirth(sessionPid) === sessionStartedAt ? sessionPid : undefined
  } catch {
    return undefined
  }
}

export async function readRunningHostPid(short: string): Promise<number | undefined> {
  try {
    const { pid, hostStartedAt } = JSON.parse(await readFile(getHostPath(short), 'utf8'))
    if (typeof pid !== 'number' || !isProcessRunning(pid)) return undefined
    const matches = typeof hostStartedAt === 'string'
      ? await processBirth(pid) === hostStartedAt
      : getProcessCommand(pid)?.includes(`--bg-pty-host ${short}`) === true
    return matches ? pid : undefined
  } catch { return undefined }
}

/**
 * Attach socket for a job. Kept under /tmp rather than the job dir: macOS
 * caps sun_path at 104 bytes, and CLAUDE_CONFIG_DIR can be arbitrarily deep.
 */
export function getJobSocketPath(short: string): string {
  const base = process.platform === 'win32' ? tmpdir() : '/tmp'
  const canonical = (path: string): string => {
    try { return realpathSync(path) } catch { return resolve(path) }
  }
  const config = canonical(getClaudeConfigHomeDir())
  const isDefault = config === canonical(join(homedir(), PRODUCT_HOME_DIR))
  const namespace = isDefault ? '' : `-${createHash('sha256').update(config).digest('hex').slice(0, 12)}`
  return join(base, `noa-bg-${userInfo().uid}${namespace}`, `${short}.sock`)
}

export function ensureJobSocketDir(short: string): string {
  const sock = getJobSocketPath(short)
  mkdirSync(join(sock, '..'), { recursive: true, mode: 0o700 })
  return sock
}

export function newJobShort(): string {
  return randomBytes(4).toString('hex')
}

export async function readJob(short: string): Promise<JobRecord | null> {
  if (!/^[0-9a-f]{8}$/.test(short)) return null
  try {
    const record = JSON.parse(await readFile(getStatePath(short), 'utf8')) as JobRecord
    if (record?.short !== short) return null
    // Persisted flags are untrusted: anything running as this user can edit
    // state.json, and reviveJob would replay them into a spawn verbatim.
    if (Array.isArray(record.respawnFlags)) {
      record.respawnFlags = sanitizePersistedFlags(record.respawnFlags)
    }
    if (Array.isArray(record.launchArgs)) {
      record.launchArgs = sanitizePersistedFlags(record.launchArgs)
    }
    return record
  } catch {
    return null
  }
}

export async function writeJob(record: JobRecord): Promise<void> {
  const dir = getJobDir(record.short)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.state.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(record, null, 2), { mode: 0o600 })
  await rename(tmp, getStatePath(record.short))
}

const patchChains = new Map<string, Promise<unknown>>()

/**
 * Cross-process mutex for state.json read-modify-write: the session reports
 * activity while `noa stop` or the agents view (stop, rename) writes from
 * another process, and a full-record write built on a stale read would drop
 * the other side's fields. mkdir is atomic. The holder records its pid inside
 * the lock, so a lock whose holder died mid-patch is broken at once: a session
 * ending on /stop exits while its last activity report holds the lock, and the
 * host — waiting on that lock to stamp the outcome — would otherwise give up
 * and leave the job unmarked. A lock with no readable pid is broken after 30s.
 * If the job dir doesn't exist there is nothing to race with — proceed
 * unlocked.
 */
const STATE_LOCK_STALE_MS = 30_000

async function withStateLock<T>(short: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(getJobDir(short), 'state.lock')
  const deadline = Date.now() + 10_000
  for (;;) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for the job state lock')
    try {
      await mkdir(lock)
      await writeFile(join(lock, 'pid'), String(process.pid)).catch(() => {})
      break
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return fn()
      if ((e as { code?: string }).code !== 'EEXIST') throw e
      let stale = false
      try {
        stale = Date.now() - (await stat(lock)).mtimeMs > STATE_LOCK_STALE_MS
      } catch {
        // The holder may have released the lock; use the normal retry backoff.
      }
      if (!stale) {
        const holder = Number(await readFile(join(lock, 'pid'), 'utf8').catch(() => ''))
        stale = Number.isInteger(holder) && holder > 0 && !isProcessRunning(holder)
      }
      if (stale) {
        await rm(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() >= deadline) throw new Error('timed out waiting for the job state lock')
      await new Promise(r => setTimeout(r, 25))
    }
  }
  try {
    return await fn()
  } finally {
    await rm(lock, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Read-modify-write. The file lock serializes writers across processes; the
 * per-job promise chain serializes them within this one (the chain alone
 * can't order two processes, the lock alone would let this process's own
 * bursts interleave lock acquisition — both are needed).
 */
export function patchJob(
  short: string,
  patch: Partial<JobRecord>,
): Promise<JobRecord | null> {
  const run = async (): Promise<JobRecord | null> =>
    withStateLock(short, async () => {
      const current = await readJob(short)
      if (!current) return null
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
      await writeJob(next)
      return next
    })
  const result = (patchChains.get(short) ?? Promise.resolve()).then(run, run)
  const tail = result.catch(() => null)
  patchChains.set(short, tail)
  void tail.then(() => {
    if (patchChains.get(short) === tail) patchChains.delete(short)
  })
  return result
}

export async function listJobs(): Promise<Job[]> {
  let names: string[]
  try {
    names = await readdir(getJobsDir())
  } catch {
    return []
  }
  const sessions = await readAllSessions()
  const jobs = await Promise.all(
    names.map(async (name): Promise<Job | null> => {
      if (!/^[0-9a-f]{8}$/.test(name)) return null
      const record = await readJob(name)
      if (!record) return null
      const hostPid = await readHostPid(name)
      const alive = hostPid ? isProcessRunning(hostPid) : false
      const hostedPid = !alive ? await readHostedSessionHint(name) : undefined
      const sessionPid = sessions.find(s => s.alive && s.kind === 'bg' && s.sessionId === record.sessionId)?.pid
        ?? (hostedPid && isProcessRunning(hostedPid) ? hostedPid : undefined)
      const interrupted = hostPid !== undefined && !alive && record.exitCode === undefined && !record.stopRequested
      return {
        ...record,
        ...(interrupted && {
          state: 'failed' as const,
          tempo: 'idle' as const,
          needs: undefined,
          detail: sessionPid ? 'background host disconnected; session is still running' : 'background host exited before reporting its result',
        }),
        hostPid,
        sessionPid,
        alive,
      }
    }),
  )
  return jobs.filter((j): j is Job => j !== null)
}

/**
 * Stop a job's session; its record and transcript stay, so it can be opened
 * (revived) again. The host forwards SIGTERM to the session and exits with it.
 */
export async function stopJob(job: Job): Promise<boolean> {
  const requested = await new Promise<boolean>(resolve => {
    const socket = connect(getJobSocketPath(job.short))
    let done = false
    const finish = (result: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish(false), 2000)
    socket.once('connect', () => {
      void patchJob(job.short, { stopRequested: true }).catch(() => null).then(() => {
        if (!done) socket.end(encodeControl({ t: 'kill' }), () => finish(true))
      })
    })
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
  if (requested) return true
  const hostPid = await readRunningHostPid(job.short)
  const hostAlive = hostPid !== undefined
  const hostedPid = !hostAlive ? await readHostedSessionPid(job.short) : undefined
  const session = !hostAlive ? (await readAllSessions()).find(s => s.alive && s.kind === 'bg' && s.sessionId === job.sessionId) : undefined
  const sessionPid = session?.processStartedAt && await processBirth(session.pid) === session.processStartedAt ? session.pid : undefined
  const pid = hostAlive
    ? hostPid
    : hostedPid ?? sessionPid
  if (!pid) return false
  await patchJob(job.short, { stopRequested: true }).catch(() => null)
  try {
    process.kill(pid, 'SIGTERM')
    if (!hostAlive) await patchJob(job.short, { state: 'done', tempo: 'idle', detail: 'stopped', needs: undefined }).catch(() => {})
    return true
  } catch {
    return false
  }
}

/** Stop a job's session (if running) and forget it. */
export async function deleteJob(job: Job): Promise<void> {
  if (job.alive || job.sessionPid) {
    await stopJob(job)
    // Let the host take its session down first, so nothing outlives the row.
    // (It gives the session 5s before a SIGKILL.)
    const pid = job.alive ? job.hostPid : job.sessionPid
    for (let i = 0; i < 70 && pid && isProcessRunning(pid); i++) {
      await new Promise(r => setTimeout(r, 100))
    }
    if (pid && isProcessRunning(pid)) throw new Error('session is still running; stop it before deleting this job')
  }
  await rm(getJobDir(job.short), { recursive: true, force: true })
}

/**
 * The live background session running this conversation, if any. Resuming it
 * in place here would put two writers on one transcript. For --continue a
 * session just forked from it also counts: until the fork writes its own
 * transcript, the original is still the newest one. A background session
 * reviving itself is not held.
 */
export async function findBackgroundHolder(
  sessionId: string,
  self: string | undefined,
  via: 'continue' | 'resume',
): Promise<Job | undefined> {
  const jobs = (await listJobs()).filter(j => j.alive && j.short !== self)
  return (
    jobs.find(j => j.sessionId === sessionId) ??
    (via === 'continue' ? jobs.find(j => j.forkParentSessionId === sessionId) : undefined)
  )
}

/** Why `--continue` / `--resume <id>` refuses a conversation a background session holds. */
/**
 * Tag the resume picker's rows whose conversation a live background session
 * is running (`bg:<id>`): resuming one here would put two writers on it.
 */
export async function markBackgroundHeld<T extends { sessionId?: string; messages?: Array<{ sessionId?: string }>; backgroundJob?: string }>(
  logs: T[],
  self?: string,
): Promise<T[]> {
  const held = new Map<string, string>()
  for (const job of await listJobs()) if (job.alive && job.short !== self) held.set(job.sessionId, job.short)
  if (held.size === 0) return logs
  for (const log of logs) {
    const id = log.sessionId ?? log.messages?.[0]?.sessionId
    const short = id ? held.get(id) : undefined
    if (short) log.backgroundJob = short
  }
  return logs
}

export function heldByBackgroundMessage(job: Job, via: 'continue' | 'resume'): string {
  return via === 'continue'
    ? `Your most recent conversation is running in the background (session ${job.sessionId}). Use \`noa agents\` to find and attach to it, or \`noa --resume\` to pick another session.`
    : `This conversation is running in a background session (${job.short}). Use \`noa attach ${job.short}\` to open it, or add --fork-session to branch off a copy.`
}
