import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID, type UUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { loadMessagesFromJsonlPath } from '../../utils/conversationRecovery.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
} from '../../utils/messages.js'
import {
  buildConversationChain,
  flushSessionStorage,
  isLoggableMessage,
  loadAllLogsFromSessionFile,
  recordTranscript,
  resetProjectForTesting,
  setSessionFileForTesting,
} from '../../utils/sessionStorage.js'
import type { Message } from '../../types/message.js'

type Entry = Record<string, unknown> & {
  uuid: UUID
  parentUuid: UUID | null
  timestamp: string
  type: string
}

const SESSION_ID = randomUUID()

function base(parentUuid: UUID | null, timestamp: string) {
  return {
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: '/tmp/noa-compact-resume',
    sessionId: SESSION_ID,
    version: 'test',
    uuid: randomUUID(),
    timestamp,
  }
}

// Shape of a conversation that ended with a compaction: boundary → summary
// (the user/assistant leaf) → restored-file attachments → file reference note.
// The attachments were stamped out of write order (reads finish in arbitrary
// order) and two share a millisecond.
function compactedTranscript(): Entry[] {
  const boundary: Entry = {
    ...base(null, '2026-09-11T10:00:00.000Z'),
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    level: 'info',
    compactMetadata: { trigger: 'manual', preTokens: 1000 },
  }
  const summary: Entry = {
    ...base(boundary.uuid, '2026-09-11T10:00:00.001Z'),
    type: 'user',
    isCompactSummary: true,
    message: { role: 'user', content: 'Summary:\n- work so far' },
  }
  const restoreA: Entry = {
    ...base(summary.uuid, '2026-09-11T10:00:00.090Z'),
    type: 'attachment',
    attachment: {
      type: 'compact_file_reference',
      filename: '/repo/a.ts',
      displayPath: 'a.ts',
    },
  }
  const restoreB: Entry = {
    ...base(restoreA.uuid, '2026-09-11T10:00:00.020Z'),
    type: 'attachment',
    attachment: {
      type: 'compact_file_reference',
      filename: '/repo/b.ts',
      displayPath: 'b.ts',
    },
  }
  const restoreC: Entry = {
    ...base(restoreB.uuid, '2026-09-11T10:00:00.020Z'),
    type: 'attachment',
    attachment: {
      type: 'compact_file_reference',
      filename: '/repo/c.ts',
      displayPath: 'c.ts',
    },
  }
  return [boundary, summary, restoreA, restoreB, restoreC]
}

function filenames(messages: readonly { type: string }[]): string[] {
  return messages
    .filter(m => m.type === 'attachment')
    .map(
      m => (m as unknown as { attachment: { filename: string } }).attachment.filename,
    )
}

const WRITE_ORDER = ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts']

describe('resume of a conversation that ended with a compaction', () => {
  test('trailing attachments follow write order, whatever the map order', () => {
    const entries = compactedTranscript()
    const leaf = entries[1]!
    const orders = [
      entries,
      [...entries].reverse(),
      [entries[0]!, entries[4]!, entries[2]!, entries[1]!, entries[3]!],
    ]
    for (const order of orders) {
      const map = new Map(order.map(e => [e.uuid, e])) as never
      const chain = buildConversationChain(map, leaf as never)
      expect(chain.map(m => m.uuid)).toEqual(entries.map(e => e.uuid))
      expect(filenames(chain)).toEqual(WRITE_ORDER)
    }
  })

  test('true siblings below the leaf are ordered by timestamp', () => {
    const entries = compactedTranscript()
    const summary = entries[1]!
    const late: Entry = {
      ...base(summary.uuid, '2026-09-11T10:00:05.000Z'),
      type: 'system',
      subtype: 'informational',
      content: 'late sibling',
    }
    const map = new Map([...entries, late].map(e => [e.uuid, e])) as never
    const chain = buildConversationChain(map, summary as never)
    // restoreA (10:00:00.090) precedes the later sibling, and its whole
    // subtree is emitted before moving on.
    expect(chain.slice(2).map(m => m.uuid)).toEqual([
      entries[2]!.uuid,
      entries[3]!.uuid,
      entries[4]!.uuid,
      late.uuid,
    ])
  })

  describe('loading from disk', () => {
    let root: string
    let file: string

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'noa-compact-resume-'))
      file = join(root, `${SESSION_ID}.jsonl`)
      writeFileSync(
        file,
        compactedTranscript()
          .map(e => JSON.stringify(e))
          .join('\n') + '\n',
      )
    })

    afterEach(() => {
      rmSync(root, { recursive: true, force: true })
    })

    test('--resume <path> keeps every restored-file note in write order', async () => {
      for (let i = 0; i < 3; i++) {
        const { messages } = await loadMessagesFromJsonlPath(file)
        expect(filenames(messages)).toEqual(WRITE_ORDER)
      }
    })

    test('session log listing keeps the whole trailing tail, not only direct children', async () => {
      const logs = await loadAllLogsFromSessionFile(file)
      expect(logs).toHaveLength(1)
      expect(filenames(logs[0]!.messages)).toEqual(WRITE_ORDER)
    })
  })

  describe('recorded through recordTranscript', () => {
    let root: string
    let file: string

    beforeEach(() => {
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
      resetProjectForTesting()
      root = mkdtempSync(join(tmpdir(), 'noa-compact-record-'))
      file = join(root, 'session.jsonl')
      writeFileSync(file, '', { mode: 0o600 })
      setSessionFileForTesting(file)
    })

    afterEach(() => {
      resetProjectForTesting()
      rmSync(root, { recursive: true, force: true })
      delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
    })

    test('post-compact attachments reach disk and come back on resume', async () => {
      const restore = (filename: string) =>
        createAttachmentMessage({
          type: 'compact_file_reference',
          filename,
          displayPath: filename.slice('/repo/'.length),
        })
      await recordTranscript([
        createCompactBoundaryMessage('manual', 1000),
        createUserMessage({
          content: 'Summary:\n- work so far',
          isCompactSummary: true,
        }),
        ...WRITE_ORDER.map(restore),
      ])
      await flushSessionStorage()

      const { messages } = await loadMessagesFromJsonlPath(file)
      expect(messages.map(m => m.type)).toEqual([
        'system',
        'user',
        'attachment',
        'attachment',
        'attachment',
      ])
      expect(filenames(messages)).toEqual(WRITE_ORDER)
    })
  })
})

describe('transcript persistence of attachments', () => {
  const attachment = (payload: Record<string, unknown>) =>
    ({
      type: 'attachment',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      attachment: payload,
    }) as unknown as Message

  test('persists post-compact context attachments', () => {
    expect(
      isLoggableMessage(
        attachment({ type: 'compact_file_reference', filename: '/repo/a.ts' }),
      ),
    ).toBe(true)
    expect(
      isLoggableMessage(attachment({ type: 'invoked_skills', skills: [] })),
    ).toBe(true)
    expect(
      isLoggableMessage(
        attachment({ type: 'plan_file_reference', planFilePath: '/p.md' }),
      ),
    ).toBe(true)
  })

  test('drops hook_success only when it carries no output', () => {
    const hook = (output: Record<string, string>) =>
      attachment({
        type: 'hook_success',
        hookName: 'h',
        toolUseID: 't',
        hookEvent: 'SessionStart',
        ...output,
      })
    expect(
      isLoggableMessage(hook({ content: '', stdout: ' \n', stderr: '' })),
    ).toBe(false)
    expect(isLoggableMessage(hook({ content: '', stdout: 'ok' }))).toBe(true)
    expect(isLoggableMessage(hook({ content: 'ran' }))).toBe(true)
  })

  test('never persists progress', () => {
    const progress = { type: 'progress', uuid: randomUUID() }
    expect(isLoggableMessage(progress as unknown as Message)).toBe(false)
  })
})
