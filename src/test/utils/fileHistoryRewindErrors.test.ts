import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UUID } from 'crypto'
import {
  type FileHistoryState,
  RewindNoFilesRestoredError,
  RewindPartialRestoreError,
  fileHistoryGetDiffStats,
  fileHistoryRewind,
} from '../../utils/fileHistory.js'

const prevSdk = process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING
const prevDisable = process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING

beforeEach(() => {
  process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = '1'
  delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
})

afterEach(() => {
  if (prevSdk === undefined) delete process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING
  else process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = prevSdk
  if (prevDisable === undefined) delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
  else process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = prevDisable
})

describe('fileHistory rewind error & diff reporting', () => {
  test('fileHistoryGetDiffStats reports unverifiedCount when backup resolution fails', async () => {
    const msgId = '11111111-1111-1111-1111-111111111111' as UUID
    const state: FileHistoryState = {
      snapshots: [
        {
          messageId: msgId,
          trackedFileBackups: {},
          timestamp: new Date(),
        },
      ],
      trackedFiles: new Set(['/nonexistent-untracked-path/foo.txt']),
      snapshotSequence: 1,
    }

    const stats = await fileHistoryGetDiffStats(state, msgId)
    expect(stats?.filesChanged).toEqual([])
    expect(stats?.unverifiedCount).toBe(1)
  })

  test('fileHistoryRewind throws RewindNoFilesRestoredError when no files can be restored', async () => {
    const msgId = '22222222-2222-2222-2222-222222222222' as UUID
    const state: FileHistoryState = {
      snapshots: [
        {
          messageId: msgId,
          trackedFileBackups: {},
          timestamp: new Date(),
        },
      ],
      trackedFiles: new Set(['/nonexistent-untracked-path/bar.txt']),
      snapshotSequence: 1,
    }

    await expect(
      fileHistoryRewind(updater => updater(state), msgId),
    ).rejects.toBeInstanceOf(RewindNoFilesRestoredError)
  })

  test('fileHistoryRewind throws RewindPartialRestoreError when some files restore and others fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noa-fh-partial-'))
    try {
      const createdFile = join(dir, 'created-after.txt')
      writeFileSync(createdFile, 'new content')
      const msgId = '33333333-3333-3333-3333-333333333333' as UUID
      const state: FileHistoryState = {
        snapshots: [
          {
            messageId: msgId,
            trackedFileBackups: {
              [createdFile]: {
                backupFileName: null,
                version: 1,
                backupTime: new Date(),
              },
            },
            timestamp: new Date(),
          },
        ],
        trackedFiles: new Set([createdFile, '/nonexistent-untracked-path/baz.txt']),
        snapshotSequence: 1,
      }

      await expect(
        fileHistoryRewind(updater => updater(state), msgId),
      ).rejects.toBeInstanceOf(RewindPartialRestoreError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
