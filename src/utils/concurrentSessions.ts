import { randomUUID } from 'crypto'
import { chmod, link, mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  getIsNonInteractiveSession,
  getOriginalCwd,
  getSessionId,
  onSessionSwitch,
} from '../bootstrap/state.js'
import { getBgJobShort, isBgSession } from './background/bgJob.js'
import { patchJob } from './background/jobs.js'
import { processBirth } from './background/processIdentity.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage, getErrnoCode, isFsInaccessible } from './errors.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { getPlatform } from './platform.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { getAgentId } from './teammate.js'

export type SessionKind = 'interactive' | 'bg' | 'daemon' | 'daemon-worker'
export type SessionStatus = 'busy' | 'idle' | 'waiting'

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

/**
 * Write a PID file for this session and register cleanup.
 *
 * Registers all top-level sessions — interactive CLI, SDK (vscode, desktop,
 * typescript, python, -p), bg/daemon spawns — so `claude ps` sees everything
 * the user might be running. Skips only teammates/subagents, which would
 * conflate swarm usage with genuine concurrency and pollute ps with noise.
 *
 * Returns true if registered, false if skipped.
 * Errors logged to debug, never thrown.
 */
export async function registerSession(): Promise<boolean> {
  if (getAgentId() != null) return false

  const kind: SessionKind = isBgSession() ? 'bg' : 'interactive'
  const dir = getSessionsDir()
  const pidFile = join(dir, `${process.pid}.json`)

  registerCleanup(async () => {
    try {
      await unlink(pidFile)
    } catch {
      // ENOENT is fine (already deleted or never written)
    }
  })

  // --resume / /resume mutates getSessionId() via switchSession. Without
  // this, the PID file's sessionId goes stale and `claude ps` sparkline
  // reads the wrong transcript. Subscribed before the awaits below: a
  // `-p --resume` switches while processBirth is still running.
  onSessionSwitch(id => {
    void updatePidFile({ sessionId: id })
    const short = getBgJobShort()
    if (short) void patchJob(short, { sessionId: id }).catch(() => {})
  })

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    const processStartedAt = await processBirth(process.pid)
    const sessionId = getSessionId()
    await writeFile(
      pidFile,
      jsonStringify({
        pid: process.pid,
        ppid: process.ppid,
        sessionId,
        cwd: getOriginalCwd(),
        startedAt: Date.now(),
        processStartedAt,
        kind,
        nonInteractive: getIsNonInteractiveSession(),
        entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
      }),
    )
    // A switch during the write found no file to patch.
    if (getSessionId() !== sessionId) await updatePidFile({ sessionId: getSessionId() })
    return true
  } catch (e) {
    logForDebugging(`[concurrentSessions] register failed: ${errorMessage(e)}`)
    return false
  }
}

/**
 * Update this session's name in its PID registry file so ListPeers
 * can surface it. Best-effort: silently no-op if name is falsy, the
 * file doesn't exist (session not registered), or read/write fails.
 */
let pidUpdateChain = Promise.resolve()

function updatePidFile(patch: Record<string, unknown>): Promise<void> {
  const run = async (): Promise<void> => {
    const pidFile = join(getSessionsDir(), `${process.pid}.json`)
    const temp = `${pidFile}.${randomUUID()}.tmp`
    try {
      const data = jsonParse(await readFile(pidFile, 'utf8')) as Record<string, unknown>
      await writeFile(temp, jsonStringify({ ...data, ...patch }), { mode: 0o600 })
      await rename(temp, pidFile)
    } catch (e) {
      logForDebugging(`[concurrentSessions] updatePidFile failed: ${errorMessage(e)}`)
    } finally {
      await unlink(temp).catch(() => {})
    }
  }
  pidUpdateChain = pidUpdateChain.then(run, run)
  return pidUpdateChain
}

export async function updateSessionName(
  name: string | undefined,
): Promise<void> {
  if (!name) return
  await updatePidFile({ name })
}

/**
 * Record this session's Remote Control session ID so peer enumeration can
 * dedup: a session reachable over both UDS and bridge should only appear
 * once (local wins). Cleared on bridge teardown so stale IDs don't
 * suppress a legitimately-remote session after reconnect.
 */
export async function updateSessionBridgeId(
  bridgeSessionId: string | null,
): Promise<void> {
  await updatePidFile({ bridgeSessionId })
}

/**
 * Push live activity state for `claude ps`. Fire-and-forget from REPL's
 * status-change effect — a dropped write just means ps falls back to
 * transcript-tail derivation for one refresh.
 */
export async function updateSessionActivity(patch: {
  status?: SessionStatus
  waitingFor?: string
}): Promise<void> {
  await updatePidFile({ ...patch, updatedAt: Date.now() })
}

export type LiveSessionHolder = { pid: number; entrypoint?: string }

/**
 * Another live foreground process (a terminal REPL, or a `-p` stream such as
 * the desktop app's) whose PID file says it is writing `sessionId`'s
 * transcript. Background kinds are left to findBackgroundHolder, which can
 * point at `noa attach`. A `-p` sibling of a `-p` process is skipped: the
 * desktop server replaces its own CLI for a session and may start the new one
 * before the old one has exited. Interactive siblings (two REPLs a tmux server
 * started directly) still conflict.
 */
async function findLiveSessionHolder(
  sessionId: string,
): Promise<LiveSessionHolder | undefined> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return undefined
  }
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (pid === process.pid || !isProcessRunning(pid)) continue
    let entry: Record<string, unknown>
    try {
      entry = jsonParse(await readFile(join(dir, file), 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    if (entry.sessionId !== sessionId || entry.kind !== 'interactive') continue
    if (
      entry.nonInteractive === true &&
      getIsNonInteractiveSession() &&
      entry.ppid === process.ppid
    )
      continue
    // A recycled PID belongs to some unrelated process, not the writer.
    if (typeof entry.processStartedAt === 'string') {
      const birth = await processBirth(pid)
      if (birth && birth !== entry.processStartedAt) continue
    }
    return {
      pid,
      entrypoint: typeof entry.entrypoint === 'string' ? entry.entrypoint : undefined,
    }
  }
  return undefined
}

// A PID file names its session only after the resume has switched to it, so two processes
// resuming one conversation at the same moment both pass findLiveSessionHolder. A claim file
// created with link(2), which fails if the file exists, lets exactly one of them through.
const claimed = new Set<string>()
let claimHooksRegistered = false

function claimPath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.claim`)
}

type ClaimEntry = { pid: number; ppid?: number; processStartedAt?: string; nonInteractive?: boolean; entrypoint?: string }

async function readClaim(sessionId: string): Promise<ClaimEntry | undefined> {
  try {
    return jsonParse(await readFile(claimPath(sessionId), 'utf8')) as ClaimEntry
  } catch {
    return undefined
  }
}

async function writeClaim(sessionId: string, entry: ClaimEntry, replace: boolean): Promise<boolean> {
  const path = claimPath(sessionId)
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, jsonStringify(entry), { mode: 0o600 })
    if (replace) await rename(temp, path)
    else await link(temp, path)
    return true
  } catch (e) {
    if (getErrnoCode(e) === 'EEXIST') return false
    throw e
  } finally {
    await unlink(temp).catch(() => {})
  }
}

async function releaseClaim(sessionId: string): Promise<void> {
  claimed.delete(sessionId)
  // A same-parent replacement may have taken the claim over; leave its file alone.
  if ((await readClaim(sessionId))?.pid === process.pid) await unlink(claimPath(sessionId)).catch(() => {})
}

/** Drop a claim whose resume did not go through; the session this process is on stays claimed. */
export async function releaseSessionClaim(sessionId: string): Promise<void> {
  if (claimed.has(sessionId) && getSessionId() !== sessionId) await releaseClaim(sessionId)
}

/**
 * Claim `sessionId` for this process before resuming it, or return the live
 * process that holds it. A claim lasts until this process exits or switches
 * to another session.
 */
export async function claimSession(
  sessionId: string,
): Promise<LiveSessionHolder | undefined> {
  const mine: ClaimEntry = {
    pid: process.pid,
    ppid: process.ppid,
    processStartedAt: await processBirth(process.pid),
    nonInteractive: getIsNonInteractiveSession(),
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
  }
  try {
    await mkdir(getSessionsDir(), { recursive: true, mode: 0o700 })
    let won = await writeClaim(sessionId, mine, false)
    for (let attempt = 0; !won && attempt < 2; attempt++) {
      const holder = await readClaim(sessionId)
      const live =
        holder &&
        holder.pid !== process.pid &&
        isProcessRunning(holder.pid) &&
        !(typeof holder.processStartedAt === 'string' && (await processBirth(holder.pid)) !== holder.processStartedAt)
      if (holder?.pid === process.pid) won = true
      // The desktop server may start a session's replacement CLI before the old one exits.
      else if (live && holder.nonInteractive === true && mine.nonInteractive && holder.ppid === process.ppid)
        won = await writeClaim(sessionId, mine, true)
      else if (live) return { pid: holder.pid, entrypoint: holder.entrypoint }
      else {
        // Left by a process that exited without cleanup (or a recycled PID).
        await unlink(claimPath(sessionId)).catch(() => {})
        won = await writeClaim(sessionId, mine, false)
      }
    }
    if (!won) {
      // Lost a race to recover a stale claim: the winner holds it now.
      const holder = await readClaim(sessionId)
      if (holder) return { pid: holder.pid, entrypoint: holder.entrypoint }
    } else {
      claimed.add(sessionId)
      if (!claimHooksRegistered) {
        claimHooksRegistered = true
        registerCleanup(async () => {
          await Promise.all([...claimed].map(releaseClaim))
        })
        onSessionSwitch(id => {
          for (const other of claimed) if (other !== id) void releaseClaim(other)
        })
      }
    }
  } catch (e) {
    logForDebugging(`[concurrentSessions] claim failed: ${errorMessage(e)}`)
  }
  // A holder that started this conversation fresh never claimed it.
  const holder = await findLiveSessionHolder(sessionId)
  if (holder && claimed.has(sessionId)) await releaseClaim(sessionId)
  return holder
}

/** Why a resume refuses a conversation another live process is writing. */
export function heldByLiveSessionMessage(
  holder: LiveSessionHolder,
  via: 'continue' | 'resume',
): string {
  const subject =
    via === 'continue' ? 'Your most recent conversation' : 'This conversation'
  return `${subject} is open in another Noa process (pid ${holder.pid}). Close it there first, or add --fork-session to branch off a copy.`
}

/**
 * Count live concurrent CLI sessions (including this one).
 * Filters out stale PID files (crashed sessions) and deletes them.
 * Returns 0 on any error (conservative).
 */
export async function countConcurrentSessions(): Promise<number> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (e) {
    if (!isFsInaccessible(e)) {
      logForDebugging(`[concurrentSessions] readdir failed: ${errorMessage(e)}`)
    }
    return 0
  }

  let count = 0
  for (const file of files) {
    // Strict filename guard: only `<pid>.json` is a candidate. parseInt's
    // lenient prefix-parsing means `2026-03-14_notes.md` would otherwise
    // parse as PID 2026 and get swept as stale — silent user data loss.
    // See anthropics/claude-code#34210.
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (pid === process.pid) {
      count++
      continue
    }
    if (isProcessRunning(pid)) {
      count++
    } else if (getPlatform() !== 'wsl') {
      // Stale file from a crashed session — sweep it. Skip on WSL: if
      // ~/.noa/sessions/ is shared with Windows-native Claude (symlink
      // or CLAUDE_CONFIG_DIR), a Windows PID won't be probeable from WSL
      // and we'd falsely delete a live session's file. This is just
      // telemetry so conservative undercount is acceptable.
      void unlink(join(dir, file)).catch(() => {})
    }
  }
  return count
}
