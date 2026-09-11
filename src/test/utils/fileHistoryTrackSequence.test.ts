import { afterEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import {
  type FileHistoryState,
  fileHistoryTouch,
  fileHistoryTrackEdit,
} from '../../utils/fileHistory.js'

/**
 * The diff views refresh on `trackSequence`, so every edit path has to bump it
 * — including the ones checkpointing never records.
 */

const previousDisable = process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING

afterEach(() => {
  if (previousDisable === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
  } else {
    process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = previousDisable
  }
})

function store(initial: FileHistoryState) {
  let state = initial
  return {
    update: (updater: (prev: FileHistoryState) => FileHistoryState) => {
      state = updater(state)
    },
    get: () => state,
  }
}

const empty = (): FileHistoryState => ({
  snapshots: [],
  trackedFiles: new Set(),
  snapshotSequence: 0,
})

describe('trackSequence', () => {
  test('touch bumps it', () => {
    const s = store(empty())
    fileHistoryTouch(s.update)
    fileHistoryTouch(s.update)
    expect(s.get().trackSequence).toBe(2)
  })

  test('a tracked edit bumps it even with checkpointing off', async () => {
    process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
    const s = store(empty())
    await fileHistoryTrackEdit(
      s.update,
      '/tmp/does-not-matter.txt',
      '00000000-0000-4000-8000-000000000000' as UUID,
    )
    expect(s.get().trackSequence).toBe(1)
    expect(s.get().trackedFiles.size).toBe(0)
  })
})
