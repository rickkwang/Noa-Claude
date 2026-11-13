import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const settingsLockWaitArray = new Int32Array(new SharedArrayBuffer(4))

const SETTINGS_LOCK_TIMEOUT_MS = 6_000
const LEGACY_SETTINGS_LOCK_STALE_MS = 10_000
const SETTINGS_LOCK_RECOVERY_GUARD_STALE_MS = 2_000
const SETTINGS_LOCK_MAX_OWNER_AGE_MS = 5 * 60_000

type SettingsLockOwner = {
  pid: number
  token: string
  acquiredAt: number
}

type SettingsLockState =
  | { kind: 'owned'; owner: SettingsLockOwner }
  | { kind: 'unowned'; ageMs: number }

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

function getSettingsLockAgeMs(path: string): number {
  try {
    return Math.max(0, Date.now() - statSync(path).mtimeMs)
  } catch {
    return 0
  }
}

function readSettingsLockState(lockPath: string): SettingsLockState {
  try {
    const parsed = JSON.parse(
      readFileSync(join(lockPath, 'owner.json'), 'utf8'),
    )
    if (
      typeof parsed?.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.acquiredAt === 'number'
    ) {
      return { kind: 'owned', owner: parsed }
    }
  } catch {
    // A lock from an older build has no owner metadata; the same is briefly
    // true between mkdir and owner.json creation below.
  }
  return { kind: 'unowned', ageMs: getSettingsLockAgeMs(lockPath) }
}

function isSettingsLockOwnerRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errnoCode(error) === 'EPERM'
  }
}

function isRecoverableSettingsLock(state: SettingsLockState): boolean {
  if (state.kind === 'owned') {
    return (
      Date.now() - state.owner.acquiredAt >=
        SETTINGS_LOCK_MAX_OWNER_AGE_MS ||
      !isSettingsLockOwnerRunning(state.owner.pid)
    )
  }
  return state.ageMs >= LEGACY_SETTINGS_LOCK_STALE_MS
}

function tryRecoverSettingsLock(lockPath: string): boolean {
  const recoveryPath = `${lockPath}.recovery`

  try {
    mkdirSync(recoveryPath)
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') {
      throw error
    }
    if (
      getSettingsLockAgeMs(recoveryPath) <
      SETTINGS_LOCK_RECOVERY_GUARD_STALE_MS
    ) {
      return false
    }
    rmSync(recoveryPath, { recursive: true, force: true })
    try {
      mkdirSync(recoveryPath)
    } catch (retryError) {
      if (errnoCode(retryError) === 'EEXIST') {
        return false
      }
      throw retryError
    }
  }

  try {
    if (!isRecoverableSettingsLock(readSettingsLockState(lockPath))) {
      return false
    }
    rmSync(lockPath, { recursive: true, force: true })
    return true
  } finally {
    rmSync(recoveryPath, { recursive: true, force: true })
  }
}

function createSettingsLockError(): Error {
  return Object.assign(new Error('Lock file is already being held'), {
    code: 'ELOCKED',
  })
}

/**
 * Acquire an exclusive cross-process directory lock for a settings file.
 * Returns a release callback that verifies lock ownership before removing it.
 */
export function acquireSettingsLock(filePath: string): () => void {
  const lockPath = `${filePath}.lock`
  const owner: SettingsLockOwner = {
    pid: process.pid,
    token: randomUUID(),
    acquiredAt: Date.now(),
  }
  const standardDeadline = Date.now() + SETTINGS_LOCK_TIMEOUT_MS
  const legacyDeadline =
    Date.now() + LEGACY_SETTINGS_LOCK_STALE_MS + SETTINGS_LOCK_TIMEOUT_MS
  let waitMs = 5

  while (true) {
    try {
      mkdirSync(lockPath)
      try {
        writeFileSync(
          join(lockPath, 'owner.json'),
          JSON.stringify(owner),
          { mode: 0o600 },
        )
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true })
        throw error
      }

      return () => {
        const currentState = readSettingsLockState(lockPath)
        if (
          currentState.kind !== 'owned' ||
          currentState.owner.token !== owner.token
        ) {
          throw new Error(`Settings lock ownership changed at ${lockPath}`)
        }
        rmSync(lockPath, { recursive: true, force: true })
      }
    } catch (error) {
      if (errnoCode(error) !== 'EEXIST') {
        throw error
      }

      const state = readSettingsLockState(lockPath)
      if (isRecoverableSettingsLock(state)) {
        if (tryRecoverSettingsLock(lockPath)) {
          continue
        }
      }

      const deadline =
        state.kind === 'unowned' ? legacyDeadline : standardDeadline
      if (Date.now() >= deadline) {
        throw createSettingsLockError()
      }
      Atomics.wait(settingsLockWaitArray, 0, 0, waitMs)
      waitMs = Math.min(Math.ceil(waitMs * 1.5), 100)
    }
  }
}
