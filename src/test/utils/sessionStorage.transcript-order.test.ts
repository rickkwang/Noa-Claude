import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enqueueEntryForTesting,
  flushSessionStorage,
  reAppendSessionMetadata,
  resetProjectForTesting,
  restoreSessionMetadata,
  saveTag,
  setSessionFileForTesting,
} from '../../utils/sessionStorage.js'
import { getSessionId } from '../../bootstrap/state.js'

// Repros the sync/async write race: reAppendSessionMetadata() writes
// synchronously via appendEntryToFile while appendEntry() entries sit in
// the FLUSH_INTERVAL_MS queue. If metadata wins the race, queued entries
// land AFTER metadata, breaking the "metadata at EOF" invariant that
// readLiteMetadata's 64KB tail scan depends on.
describe('transcript write order under concurrent sync+async writes', () => {
  let tmpFile: string
  let tmpRoot: string

  beforeEach(() => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    resetProjectForTesting()
    tmpRoot = mkdtempSync(join(tmpdir(), 'noa-transcript-order-'))
    tmpFile = join(tmpRoot, 'session.jsonl')
    writeFileSync(tmpFile, '', { mode: 0o600 })
    setSessionFileForTesting(tmpFile)
  })

  afterEach(() => {
    resetProjectForTesting()
    rmSync(tmpRoot, { recursive: true, force: true })
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  })

  test('queued entry stays ahead of subsequent reAppendSessionMetadata', async () => {
    const sessionId = getSessionId() as `${string}-${string}-${string}-${string}-${string}`

    // Seed metadata so reAppendSessionMetadata actually writes a custom-title row.
    restoreSessionMetadata({ customTitle: 'TestTitle-Race' })

    // 1) Issue an async-queued entry — sits in queue for FLUSH_INTERVAL_MS.
    void enqueueEntryForTesting({ type: 'mode', mode: 'normal', sessionId })

    // 2) Synchronously re-append metadata (mirrors compact.ts:716).
    reAppendSessionMetadata()

    // 3) Drain the queue.
    await flushSessionStorage()

    const lines = readFileSync(tmpFile, 'utf8')
      .split('\n')
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l) as { type: string; customTitle?: string })

    const modeIdx = lines.findIndex(l => l.type === 'mode')
    const titleIdx = lines.findIndex(
      l => l.type === 'custom-title' && l.customTitle === 'TestTitle-Race',
    )

    expect(modeIdx).toBeGreaterThanOrEqual(0)
    expect(titleIdx).toBeGreaterThanOrEqual(0)
    // Insertion order: mode was issued FIRST, custom-title write happened
    // AFTER. On disk the mode entry must come before the metadata block,
    // otherwise readLiteMetadata's tail scan can't trust EOF position.
    expect(modeIdx).toBeLessThan(titleIdx)
  })

  test('saveTag (sync) lands after queued entry', async () => {
    const sessionId = getSessionId() as `${string}-${string}-${string}-${string}-${string}`

    void enqueueEntryForTesting({ type: 'mode', mode: 'normal', sessionId })

    // saveTag is one of ~10 sync writers using appendEntryToFile directly.
    // Same race shape as #1 but no reAppendSessionMetadata involved.
    await saveTag(sessionId, 'order-test-tag', tmpFile)

    await flushSessionStorage()

    const lines = readFileSync(tmpFile, 'utf8')
      .split('\n')
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l) as { type: string; tag?: string })

    const modeIdx = lines.findIndex(l => l.type === 'mode')
    const tagIdx = lines.findIndex(
      l => l.type === 'tag' && l.tag === 'order-test-tag',
    )

    expect(modeIdx).toBeGreaterThanOrEqual(0)
    expect(tagIdx).toBeGreaterThanOrEqual(0)
    expect(modeIdx).toBeLessThan(tagIdx)
  })
})
