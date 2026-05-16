import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getAutoMemPath } from '../../../memdir/paths.js'
import {
  readLastConsolidatedAt,
  recordConsolidation,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
} from '../../../services/autoDream/consolidationLock.js'

const LOCK_FILE = '.consolidate-lock'
// PID 999_999 sits above the kernel max-PID on all current defaults
// (macOS kern.maxproc ~2048-4096; Linux /proc/sys/kernel/pid_max ~32768),
// so `process.kill(pid, 0)` reliably throws ESRCH → isProcessRunning false.
const DEAD_PID = 999_999

let tmpRoot: string
let originalEnv: string | undefined

function lockPath(): string {
  return join(getAutoMemPath(), LOCK_FILE)
}

function clearAutoMemPathCache(): void {
  const cache = (getAutoMemPath as unknown as { cache?: { clear(): void } })
    .cache
  cache?.clear()
}

async function presetLock(pid: number, mtimeMs: number): Promise<void> {
  const path = lockPath()
  await writeFile(path, String(pid))
  const t = mtimeMs / 1000
  await utimes(path, t, t)
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'dream-lock-'))
  originalEnv = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = tmpRoot
  clearAutoMemPathCache()
})

afterEach(async () => {
  clearAutoMemPathCache()
  if (originalEnv === undefined) {
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  } else {
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = originalEnv
  }
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('readLastConsolidatedAt', () => {
  test('returns 0 when lock file absent', async () => {
    const result = await readLastConsolidatedAt()
    expect(result).toBe(0)
  })

  test('returns mtimeMs when lock file present', async () => {
    const stamp = Date.now() - 60_000
    await presetLock(DEAD_PID, stamp)
    const result = await readLastConsolidatedAt()
    expect(Math.abs(result - stamp)).toBeLessThan(1500)
  })
})

describe('tryAcquireConsolidationLock', () => {
  test('clean acquire on absent lock returns 0 priorMtime', async () => {
    const before = Date.now()
    const result = await tryAcquireConsolidationLock()
    const after = Date.now()
    expect(result).toBe(0)

    const body = await readFile(lockPath(), 'utf8')
    expect(parseInt(body.trim(), 10)).toBe(process.pid)
    const s = await stat(lockPath())
    expect(s.mtimeMs).toBeGreaterThanOrEqual(before - 1000)
    expect(s.mtimeMs).toBeLessThanOrEqual(after + 1000)
  })

  test('reclaims a stale lock held by a dead PID', async () => {
    const priorMtime = Date.now() - 60_000
    await presetLock(DEAD_PID, priorMtime)

    const result = await tryAcquireConsolidationLock()
    expect(result).not.toBeNull()
    expect(Math.abs((result as number) - priorMtime)).toBeLessThan(1500)

    const body = await readFile(lockPath(), 'utf8')
    expect(parseInt(body.trim(), 10)).toBe(process.pid)
  })

  test('refuses to reclaim a fresh lock held by a live PID', async () => {
    // Write the current process's PID — it's trivially alive.
    await presetLock(process.pid, Date.now() - 1000)
    const result = await tryAcquireConsolidationLock()
    expect(result).toBeNull()
  })

  test('concurrent reclaim within same process — both succeed (same PID body verifies)', async () => {
    const priorMtime = Date.now() - 60_000
    await presetLock(DEAD_PID, priorMtime)

    const [a, b] = await Promise.all([
      tryAcquireConsolidationLock(),
      tryAcquireConsolidationLock(),
    ])
    // Both calls write process.pid → both re-read process.pid → both succeed.
    // Cross-process race correctness (different PIDs writing) is covered by
    // the verify-re-read in tryAcquireConsolidationLock but cannot be
    // exercised inside one Bun test process.
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    const body = await readFile(lockPath(), 'utf8')
    expect(parseInt(body.trim(), 10)).toBe(process.pid)
  })
})

describe('rollbackConsolidationLock', () => {
  test('priorMtime === 0 unlinks the lock', async () => {
    await tryAcquireConsolidationLock()
    expect((await stat(lockPath())).isFile()).toBe(true)

    await rollbackConsolidationLock(0)
    await expect(stat(lockPath())).rejects.toThrow()
  })

  test('priorMtime > 0 keeps the file, clears PID body, rewinds mtime', async () => {
    const priorMtime = Date.now() - 5 * 60_000
    await presetLock(DEAD_PID, priorMtime)
    await tryAcquireConsolidationLock() // mtime advances to now, body=our pid

    await rollbackConsolidationLock(priorMtime)

    const body = await readFile(lockPath(), 'utf8')
    expect(body).toBe('')
    const s = await stat(lockPath())
    // utimes is second-precision, allow 1.5s tolerance for rounding.
    expect(Math.abs(s.mtimeMs - priorMtime)).toBeLessThan(1500)
  })
})

describe('recordConsolidation', () => {
  test('creates the lock file and stamps mtime', async () => {
    const before = Date.now()
    await recordConsolidation()
    const after = Date.now()
    const body = await readFile(lockPath(), 'utf8')
    expect(parseInt(body.trim(), 10)).toBe(process.pid)
    const s = await stat(lockPath())
    expect(s.mtimeMs).toBeGreaterThanOrEqual(before - 1000)
    expect(s.mtimeMs).toBeLessThanOrEqual(after + 1000)
  })

  test('works even when the memory dir does not pre-exist', async () => {
    // Point env at a non-existent subdir of tmpRoot; recordConsolidation
    // should mkdir -p it.
    const fresh = join(tmpRoot, 'nested-not-yet-created') + sep
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = fresh
    clearAutoMemPathCache()

    await recordConsolidation()
    const s = await stat(join(fresh, LOCK_FILE))
    expect(s.isFile()).toBe(true)
  })
})
