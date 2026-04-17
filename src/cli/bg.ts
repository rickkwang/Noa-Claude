import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { cliError } from './exit.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { isProcessRunning } from '../utils/genericProcessUtils.js'
import { writeToStdout } from '../utils/process.js'

type SessionRegistryEntry = {
  pid: number
  sessionId?: string
  cwd?: string
  startedAt?: number
  kind?: string
  name?: string
  logPath?: string
  agent?: string
}

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

async function readSessionRegistryEntries(): Promise<SessionRegistryEntry[]> {
  let names: string[]
  try {
    names = await readdir(getSessionsDir())
  } catch {
    return []
  }

  const entries: SessionRegistryEntry[] = []
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    const filePath = join(getSessionsDir(), name)
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<SessionRegistryEntry>
      if (typeof parsed.pid !== 'number') continue
      entries.push({
        pid: parsed.pid,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
        cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
        startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : undefined,
        kind: typeof parsed.kind === 'string' ? parsed.kind : undefined,
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
        logPath: typeof parsed.logPath === 'string' ? parsed.logPath : undefined,
        agent: typeof parsed.agent === 'string' ? parsed.agent : undefined,
      })
    } catch {
      // Ignore malformed registry entries so one bad file does not hide others.
    }
  }
  return entries.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
}

function formatSessionLabel(entry: SessionRegistryEntry): string {
  const parts = [entry.kind ?? 'interactive']
  if (entry.name) parts.push(entry.name)
  if (entry.agent) parts.push(`agent=${entry.agent}`)
  return parts.join(' ')
}

export async function psHandler(_args: string[]): Promise<void> {
  const entries = await readSessionRegistryEntries()
  if (entries.length === 0) {
    writeToStdout('No background sessions found.\n')
    return
  }

  writeToStdout('PID       STATE    KIND / NAME                         SESSION ID\n')
  writeToStdout('--------  -------  ----------------------------------  --------------------------------\n')
  for (const entry of entries) {
    const state = isProcessRunning(entry.pid) ? 'running' : 'stopped'
    const label = formatSessionLabel(entry).slice(0, 34).padEnd(34, ' ')
    const sessionId = (entry.sessionId ?? '').slice(0, 32).padEnd(32, ' ')
    writeToStdout(`${String(entry.pid).padEnd(8, ' ')}  ${state.padEnd(7, ' ')}  ${label}  ${sessionId}\n`)
  }
}

export async function logsHandler(sessionOrPid?: string): Promise<void> {
  if (!sessionOrPid) {
    cliError('Usage: noa logs <session-id|pid>')
  }

  const entries = await readSessionRegistryEntries()
  const entry = entries.find(
    item => item.sessionId === sessionOrPid || String(item.pid) === sessionOrPid,
  )
  if (!entry) {
    cliError(`No background session found for "${sessionOrPid}".`)
  }
  if (!entry.logPath) {
    cliError(`No log path recorded for "${sessionOrPid}".`)
  }

  try {
    const contents = await readFile(entry.logPath, 'utf8')
    const lines = contents.trimEnd().split('\n')
    const tail = lines.slice(Math.max(0, lines.length - 200))
    writeToStdout(tail.join('\n') + '\n')
  } catch (error) {
    cliError(`Unable to read logs for "${sessionOrPid}".`)
  }
}

export async function attachHandler(sessionOrPid?: string): Promise<void> {
  if (!sessionOrPid) {
    cliError('Usage: noa attach <session-id|pid>')
  }
  cliError(
    `Attach for "${sessionOrPid}" is not available in this build. Use the main interactive session instead.`,
  )
}

export async function killHandler(sessionOrPid?: string): Promise<void> {
  if (!sessionOrPid) {
    cliError('Usage: noa kill <session-id|pid>')
  }

  const entries = await readSessionRegistryEntries()
  const entry = entries.find(
    item => item.sessionId === sessionOrPid || String(item.pid) === sessionOrPid,
  )
  if (!entry) {
    cliError(`No background session found for "${sessionOrPid}".`)
  }

  try {
    process.kill(entry.pid, 'SIGTERM')
    writeToStdout(`Sent SIGTERM to ${entry.pid}.\n`)
  } catch {
    cliError(`Failed to kill process ${entry.pid}.`)
  }
}

export async function handleBgFlag(_args: string[]): Promise<void> {
  cliError('Background session launch is not available in this build.')
}
