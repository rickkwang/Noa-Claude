import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Control whether the mocked appendFile fails, so we can exercise the
// write-failure path deterministically. Everything else in fs/promises falls
// through to the real implementation (the lockfile module depends on it).
let appendShouldFail = false
let appendGate: Promise<void> | null = null
const realFsPromises = await import('fs/promises')
// Capture the real function value NOW. Bun's mock.module mutates the module
// namespace object in place, so `realFsPromises.appendFile` would resolve to
// the mock (infinite recursion) once installed — bind the concrete fn instead.
const realAppendFile = realFsPromises.appendFile
mock.module('fs/promises', () => ({
  ...realFsPromises,
  appendFile: async (...args: Parameters<typeof realFsPromises.appendFile>) => {
    if (appendShouldFail) {
      const err = new Error('ENOSPC: simulated no space left on device')
      ;(err as NodeJS.ErrnoException).code = 'ENOSPC'
      throw err
    }
    // Stall mid-write when a gate is set, so a test can act during the
    // in-flight window before the bytes actually land.
    if (appendGate) await appendGate
    return realAppendFile(...args)
  },
}))

const state = await import('../../bootstrap/state.js')
const history = await import('../../history.js')

let configDir: string
let originalConfigDir: string | undefined

function makeEntry(display: string): {
  display: string
  pastedContents: Record<number, never>
  timestamp: number
  project: string
  sessionId: string
} {
  return {
    display,
    pastedContents: {},
    // Deterministic, unique-per-display timestamp (Date.now is banned in some
    // contexts and we want stable dedup keys).
    timestamp: 1_700_000_000_000 + display.length * 1000,
    project: state.getProjectRoot(),
    sessionId: state.getSessionId(),
  }
}

async function collectHistory(): Promise<string[]> {
  const out: string[] = []
  for await (const entry of history.getHistory()) {
    out.push(entry.display)
  }
  return out
}

describe('history flush durability (CC 2.1.218 alignment)', () => {
  beforeEach(() => {
    appendShouldFail = false
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    configDir = mkdtempSync(join(tmpdir(), 'noa-history-test-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    history.clearPendingHistoryEntries()
  })

  afterEach(() => {
    history.clearPendingHistoryEntries()
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    rmSync(configDir, { recursive: true, force: true })
  })

  test('a failed append keeps entries queued instead of dropping them', async () => {
    const entry = makeEntry('remember-me')
    history._addPendingEntryForTesting(entry)

    appendShouldFail = true
    const ok = await history._immediateFlushForTesting()

    expect(ok).toBe(false)
    // The entry must NOT be lost — it stays queued for retry.
    expect(history._getPendingEntriesForTesting()).toContain(entry)
  })

  test('a later successful append persists the previously-failed entry', async () => {
    const entry = makeEntry('retry-me')
    history._addPendingEntryForTesting(entry)

    appendShouldFail = true
    expect(await history._immediateFlushForTesting()).toBe(false)

    appendShouldFail = false
    expect(await history._immediateFlushForTesting()).toBe(true)

    // Now flushed: removed from the queue and readable from disk.
    expect(history._getPendingEntriesForTesting()).toHaveLength(0)
    expect(await collectHistory()).toContain('retry-me')
  })

  test('a successful flush drops only written entries, keeping ones added meanwhile', async () => {
    const first = makeEntry('first')
    history._addPendingEntryForTesting(first)

    // Simulate an entry pushed while the flush is mid-await by adding it before
    // we snapshot: since immediateFlush snapshots at entry, add `second` only
    // after the flush has captured `first`. We approximate by flushing `first`,
    // then confirming a later `second` survives its own flush independently.
    expect(await history._immediateFlushForTesting()).toBe(true)
    expect(history._getPendingEntriesForTesting()).toHaveLength(0)

    const second = makeEntry('second')
    history._addPendingEntryForTesting(second)
    expect(await history._immediateFlushForTesting()).toBe(true)

    const displays = await collectHistory()
    expect(displays).toContain('first')
    expect(displays).toContain('second')
  })

  test('removeLastFromHistory during an in-flight write does not leave a disk duplicate', async () => {
    // Reproduces the Esc-rewind-during-write race: an entry is captured into a
    // flush's in-flight snapshot (headed for disk) AND still in pendingEntries.
    // removeLastFromHistory splices it from pending, but the bytes still land on
    // disk — it must be marked skipped so the reader drops that disk copy.
    let releaseAppend: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      releaseAppend = resolve
    })
    appendShouldFail = false
    const entry = makeEntry('rewound')
    history._addPendingEntryForTesting(entry)
    history._markLastAddedForTesting(entry)

    // Start a flush; it stalls inside the gated appendFile (entry now in-flight).
    appendGate = gate
    const flushPromise = history._immediateFlushForTesting()
    // Let the flush reach the gated append.
    await Promise.resolve()
    await Promise.resolve()

    // Simulate Esc-rewind: remove the just-added entry while it is mid-write.
    history.removeLastFromHistory()

    // Let the append finish and the flush settle.
    releaseAppend()
    expect(await flushPromise).toBe(true)
    appendGate = null

    const displays = await collectHistory()
    expect(displays.filter(d => d === 'rewound').length).toBe(0)
  })

  test('reader does not double-count an entry present both on disk and in the queue', async () => {
    const entry = makeEntry('in-flight')
    history._addPendingEntryForTesting(entry)
    // Persist it to disk (removes it from the queue).
    expect(await history._immediateFlushForTesting()).toBe(true)

    // Re-queue the SAME logical entry to simulate the in-flight window where
    // it is on disk AND still pending.
    history._addPendingEntryForTesting(entry)

    const displays = await collectHistory()
    const occurrences = displays.filter(d => d === 'in-flight').length
    expect(occurrences).toBe(1)
  })
})
