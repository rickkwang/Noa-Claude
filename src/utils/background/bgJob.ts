/**
 * Whether this process is a background session, and how it hands the
 * terminal back to the agents view. Dependency-free so early startup code
 * (session registry, main) can ask.
 */
import { BG_JOB_ENV, DETACH_SEQUENCE } from './ptyProtocol.js'

let jobShort: string | undefined

/**
 * Read and scrub the job marker once at startup. Scrubbing keeps it out of
 * every subprocess env — a `noa` started from the Bash tool inside a
 * background session must not report into this session's job.
 */
export function captureBgJobEnv(): void {
  const value = process.env[BG_JOB_ENV]
  if (value === undefined) return
  delete process.env[BG_JOB_ENV]
  if (!/^[0-9a-f]{8}$/.test(value)) return
  jobShort = value
  // The PTY host sends SIGWINCH on every attach; that is how the session
  // learns someone just arrived. Resizes while attached raise it too, so
  // only the first one after a detach counts as an arrival.
  process.on('SIGWINCH', () => {
    if (detachedSinceAttach || attachedAt === 0) attachedAt = Date.now()
    detachedSinceAttach = false
  })
}

let attachedAt = 0
let detachedSinceAttach = false

/** When a client last attached (0 = never, or not a background session). */
export function getLastAttachAt(): number {
  return attachedAt
}

export function getBgJobShort(): string | undefined {
  return jobShort
}

export function isBgSession(): boolean {
  return jobShort !== undefined
}

/** Hand the terminal back to the agents view; the session keeps running. */
export function requestBgDetach(): void {
  process.stdout.write(DETACH_SEQUENCE)
  detachedSinceAttach = true
}
