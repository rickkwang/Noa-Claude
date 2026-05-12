import { readFile, readdir, unlink } from 'fs/promises'
import { join } from 'path'
import type { SessionKind, SessionStatus } from '../concurrentSessions.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getProcessCommand, isProcessRunning } from '../genericProcessUtils.js'
import { getPlatform } from '../platform.js'

export type SessionState = 'working' | 'waiting' | 'idle' | 'completed' | 'stopped'

export type SessionEntry = {
  pid: number
  sessionId?: string
  cwd?: string
  startedAt?: number
  kind?: SessionKind
  name?: string
  logPath?: string
  agent?: string
  entrypoint?: string
  status?: SessionStatus
  waitingFor?: string
  updatedAt?: number
  alive: boolean
  derivedState: SessionState
}

export type SessionGroup = {
  label: string
  state: SessionState
  sessions: SessionEntry[]
}

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

function deriveState(alive: boolean, status?: SessionStatus): SessionState {
  if (!alive) return 'stopped'
  switch (status) {
    case 'busy':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'idle':
    default:
      return 'idle'
  }
}

export async function readAllSessions(): Promise<SessionEntry[]> {
  const dir = getSessionsDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const entries: SessionEntry[] = []
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    const filePath = join(dir, name)
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const pid = parsed.pid
      if (typeof pid !== 'number') continue

      const alive = isProcessRunning(pid)
      if (!alive && getPlatform() !== 'wsl') {
        void unlink(filePath).catch(() => {})
      }

      const status = typeof parsed.status === 'string' ? parsed.status as SessionStatus : undefined

      entries.push({
        pid,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
        cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
        startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : undefined,
        kind: typeof parsed.kind === 'string' ? parsed.kind as SessionKind : undefined,
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
        logPath: typeof parsed.logPath === 'string' ? parsed.logPath : undefined,
        agent: typeof parsed.agent === 'string' ? parsed.agent : undefined,
        entrypoint: typeof parsed.entrypoint === 'string' ? parsed.entrypoint : undefined,
        status,
        waitingFor: typeof parsed.waitingFor === 'string' ? parsed.waitingFor : undefined,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
        alive,
        derivedState: deriveState(alive, status),
      })
    } catch {
      // skip malformed entries
    }
  }
  return entries.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
}

const GROUP_ORDER: { state: SessionState; label: string }[] = [
  { state: 'waiting', label: 'Needs input' },
  { state: 'working', label: 'Working' },
  { state: 'idle', label: 'Idle' },
  { state: 'stopped', label: 'Stopped' },
]

export function groupSessionsByState(entries: SessionEntry[]): SessionGroup[] {
  const groups: SessionGroup[] = []
  for (const { state, label } of GROUP_ORDER) {
    const sessions = entries.filter(e => e.derivedState === state)
    if (sessions.length > 0) {
      groups.push({ label, state, sessions })
    }
  }
  return groups
}

export function formatRelativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function truncateCwd(cwd: string, maxLen: number = 30): string {
  if (cwd.length <= maxLen) return cwd
  const home = process.env.HOME
  if (home && cwd.startsWith(home)) {
    cwd = '~' + cwd.slice(home.length)
  }
  if (cwd.length <= maxLen) return cwd
  return '...' + cwd.slice(cwd.length - maxLen + 3)
}

export async function isTrustedLiveSession(
  session: Pick<SessionEntry, 'pid' | 'sessionId' | 'startedAt'>,
): Promise<boolean> {
  const current = (await readAllSessions()).find(entry => entry.pid === session.pid)
  if (!current?.alive) return false
  if (session.sessionId && current.sessionId !== session.sessionId) return false
  if (session.startedAt && current.startedAt !== session.startedAt) return false

  const command = getProcessCommand(session.pid)
  if (!command) return false

  return /\b(noa|claude)\b/i.test(command)
}
