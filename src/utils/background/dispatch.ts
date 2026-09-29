/**
 * Starting background sessions: each one is a detached PTY host (ptyHost.ts)
 * running a normal interactive session with NOA_CLAUDE_BG_JOB set.
 */
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync } from 'fs'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { isInBundledMode } from '../bundledMode.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { isProcessRunning } from '../genericProcessUtils.js'
import { readAllSessions } from './sessionRegistry.js'
import {
  getJobDir,
  IDLE_DETAIL,
  IDLE_NEEDS,
  type Job,
  newJobShort,
  patchJob,
  readHostPid,
  writeJob,
  type JobRecord,
} from './jobs.js'
import { BG_JOB_ENV } from './ptyProtocol.js'

/**
 * argv prefix that re-runs this CLI: bun + script, or the compiled binary
 * alone. A compiled binary's argv[1] is its virtual entry (`/$bunfs/root/…`,
 * `B:\\~BUN\\root\\…` on Windows). isInBundledMode() misses binaries built
 * without embedded files, and fs calls resolve the virtual path too, so the
 * path itself is the test.
 */
export function selfCommand(): string[] {
  const script = process.argv[1]
  const compiled =
    isInBundledMode() ||
    !script ||
    script.startsWith('/$bunfs/') ||
    script.includes('~BUN')
  return compiled ? [process.execPath] : [process.execPath, script]
}

function spawnHost(short: string, cwd: string, sessionArgs: string[]): void {
  const cols = process.stdout.columns || 120
  const rows = process.stdout.rows || 40
  const self = selfCommand()
  const [file, ...prefix] = self
  const child = spawn(
    file!,
    [
      ...prefix,
      '--bg-pty-host',
      short,
      String(cols),
      String(rows),
      '--',
      ...self,
      ...sessionArgs,
    ],
    {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [BG_JOB_ENV]: short },
    },
  )
  child.unref()
  if (!child.pid) throw new Error('failed to start background session')
}

/**
 * The reply that was streaming when the conversation was handed over. The
 * fork drops everything after `boundaryUuid` and asks the model to continue
 * from this text instead of starting the reply over.
 */
export type HandoffPrefill = { text: string; boundaryUuid?: string }

/** Upper bound on the carried partial reply (its tail is kept). */
const PREFILL_MAX_CHARS = 16384

function getHandoffPath(short: string): string {
  return join(getJobDir(short), 'handoff.json')
}

/** Read (once) the partial reply the foreground left for this session. */
export async function takeHandoffPrefill(short: string): Promise<HandoffPrefill | undefined> {
  const path = getHandoffPath(short)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as HandoffPrefill
    return typeof parsed.text === 'string' && parsed.text ? parsed : undefined
  } catch {
    return undefined
  } finally {
    await rm(path, { force: true }).catch(() => {})
  }
}

export type DispatchOptions = {
  cwd: string
  /** First user message; omitted = the session waits for one. */
  prompt?: string
  /** Continue an existing transcript under a new session id. */
  forkFrom?: string
  /** The fork was cut off mid-turn: the session finishes that turn first. */
  replyOnResume?: boolean
  prefill?: HandoffPrefill
  name?: string
  respawnFlags: string[]
  /** Called with the new session's id before it starts (e.g. to seed its files). */
  beforeStart?: (sessionId: string) => Promise<void>
}

export async function dispatchJob(opts: DispatchOptions): Promise<string> {
  const short = newJobShort()
  const sessionId = randomUUID()
  const now = new Date().toISOString()
  const prompt = opts.prompt?.trim()
  const record: JobRecord = {
    short,
    sessionId,
    cwd: opts.cwd,
    ...(opts.name && { name: opts.name, nameSource: 'auto' as const }),
    state: prompt ? 'working' : 'blocked',
    tempo: prompt ? 'active' : 'blocked',
    detail: prompt ? 'starting…' : IDLE_DETAIL,
    ...(!prompt && { needs: IDLE_NEEDS }),
    respawnFlags: opts.respawnFlags,
    ...(opts.forkFrom && { forkParentSessionId: opts.forkFrom }),
    createdAt: now,
    updatedAt: now,
  }
  const args = [
    ...opts.respawnFlags,
    ...(opts.forkFrom
      ? [
          '--resume',
          opts.forkFrom,
          '--fork-session',
          ...(opts.replyOnResume ? ['--reply-on-resume'] : []),
        ]
      : []),
    '--session-id',
    sessionId,
    ...(prompt ? ['--', prompt] : []),
  ]
  await writeJob({ ...record, launchArgs: args })
  const prefillText = opts.prefill?.text.trimEnd()
  if (opts.replyOnResume && prefillText) {
    await writeFile(
      getHandoffPath(short),
      JSON.stringify({
        text: prefillText.slice(-PREFILL_MAX_CHARS),
        boundaryUuid: opts.prefill!.boundaryUuid,
      }),
      { mode: 0o600 },
    )
  }
  // Capped: seeding is a convenience, it must not hold up the session.
  if (opts.beforeStart) {
    await Promise.race([opts.beforeStart(sessionId).catch(() => {}), new Promise(r => setTimeout(r, 2000))])
  }
  spawnHost(short, opts.cwd, args)
  return short
}

/**
 * Cross-process spawn mutex: two terminals can find the same job's host dead
 * at once, and without serialization both would spawn a session resuming the
 * same transcript. mkdir is atomic; a lock whose holder died mid-spawn is
 * broken after 60s. (Upstream serializes this through its spare-host claim
 * protocol; a lock file is the fork's smaller equivalent.)
 */
const SPAWN_LOCK_STALE_MS = 60_000

async function acquireSpawnLock(short: string): Promise<(() => void) | null> {
  const lock = join(getJobDir(short), 'spawn.lock')
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      await mkdir(lock)
      return () => {
        rm(lock, { recursive: true, force: true }).catch(() => {})
      }
    } catch {
      let stale = false
      try {
        stale = Date.now() - (await stat(lock)).mtimeMs > SPAWN_LOCK_STALE_MS
      } catch {
        // lock vanished between attempts: loop and try again
        continue
      }
      if (stale) {
        await rm(lock, { recursive: true, force: true }).catch(() => {})
        continue
      }
      if (Date.now() >= deadline) return null
      await new Promise(r => setTimeout(r, 50))
    }
  }
}

/**
 * Bring a stopped session back (its host exited: /exit, crash, reboot) by
 * resuming its transcript under the same session id.
 */
function transcriptExists(sessionId: string): boolean {
  const projects = join(getClaudeConfigHomeDir(), 'projects')
  try {
    return readdirSync(projects).some(dir =>
      existsSync(join(projects, dir, `${sessionId}.jsonl`)),
    )
  } catch {
    return false
  }
}

export async function reviveJob(job: Job): Promise<void> {
  const release = await acquireSpawnLock(job.short)
  // No lock: another process is starting this host — leave it to them.
  if (!release) return
  try {
    // The process we waited on for the lock may have spawned the host.
    const pid = await readHostPid(job.short)
    if (pid !== undefined && isProcessRunning(pid)) return
    // A live interactive session holding this transcript would make two
    // writers on it.
    const holder = (await readAllSessions()).find(
      s => s.alive && s.kind !== 'bg' && s.sessionId === job.sessionId,
    )
    if (holder) {
      throw new Error(
        `this conversation is open in another running session (pid ${holder.pid}) — resume it there or /exit that session first`,
      )
    }
    if (job.stopRequested) void patchJob(job.short, { stopRequested: undefined }).catch(() => null)
    // A session that never started has no transcript to resume: launch it
    // the way it was first meant to.
    const args =
      job.launchArgs && !transcriptExists(job.sessionId)
        ? job.launchArgs
        : [...job.respawnFlags, '--resume', job.sessionId]
    spawnHost(job.short, job.cwd, args)
    // Hold the lock until the new host has recorded its pid: released any
    // earlier, the next holder finds no live host and spawns a second one.
    for (let i = 0; i < 100; i++) {
      const hostPid = await readHostPid(job.short)
      if (hostPid !== undefined && isProcessRunning(hostPid)) break
      await new Promise(r => setTimeout(r, 50))
    }
  } finally {
    release()
  }
}
