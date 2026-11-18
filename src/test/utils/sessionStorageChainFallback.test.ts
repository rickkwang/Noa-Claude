import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptMessage } from '../../types/logs.js'
import {
  buildConversationChain,
  loadTranscriptFile,
} from '../../utils/sessionStorage.js'

function makeMsg(
  uuid: string,
  parentUuid: string | null,
  timestamp: string,
  overrides: Partial<TranscriptMessage> = {},
): TranscriptMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    parentUuid: parentUuid as UUID | null,
    isSidechain: false,
    userType: 'external',
    cwd: '/tmp',
    sessionId: '00000000-0000-4000-8000-000000000099',
    version: '1.0.0',
    timestamp,
    message: { role: 'user', content: uuid },
    ...overrides,
  } as TranscriptMessage
}

const U1 = '11111111-1111-4111-8111-111111111111' as UUID
const U2 = '22222222-2222-4222-8222-222222222222' as UUID
const U3 = '33333333-3333-4333-8333-333333333333' as UUID
const U4 = '44444444-4444-4444-8444-444444444444' as UUID

describe('buildConversationChain timestamp fallback & self-cycle guard', () => {
  test('recovers prior history across a cyclic parentUuid within 5s on the same sidechain', () => {
    const m1 = makeMsg(U1, null, '2026-01-01T00:00:00.000Z')
    const m2 = makeMsg(U2, U1, '2026-01-01T00:00:01.000Z')
    // u3's parentUuid points to itself (cycle), but m2 is 1s earlier on the same sidechain
    const m3 = makeMsg(U3, U3, '2026-01-01T00:00:02.000Z')
    const m4 = makeMsg(U4, U3, '2026-01-01T00:00:03.000Z')

    const messages = new Map<UUID, TranscriptMessage>([
      [m1.uuid, m1],
      [m2.uuid, m2],
      [m3.uuid, m3],
      [m4.uuid, m4],
    ])

    const chain = buildConversationChain(messages, m4)
    expect(chain.map(m => m.uuid)).toEqual([U1, U2, U3, U4])
  })

  test('does not fall back across >5s gap or different isSidechain', () => {
    const m1 = makeMsg(U1, null, '2026-01-01T00:00:00.000Z', {
      isSidechain: true,
    })
    const m2 = makeMsg(U2, null, '2026-01-01T00:00:00.000Z', {
      isSidechain: false,
    })
    // >5s gap from m2 and m1 is on a different sidechain
    const m3 = makeMsg(
      U3,
      '99999999-9999-4999-8999-999999999999',
      '2026-01-01T00:00:10.000Z',
      {
        isSidechain: false,
      },
    )

    const messages = new Map<UUID, TranscriptMessage>([
      [m1.uuid, m1],
      [m2.uuid, m2],
      [m3.uuid, m3],
    ])

    const chain = buildConversationChain(messages, m3)
    expect(chain.map(m => m.uuid)).toEqual([U3])
  })

  test('loadTranscriptFile ignores duplicate self-looping UUID overwrite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noa-chain-fallback-'))
    const file = join(dir, 'transcript.jsonl')
    try {
      const m1 = makeMsg('11111111-1111-4111-8111-111111111111', null, '2026-01-01T00:00:00.000Z')
      const m2Valid = makeMsg(
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '2026-01-01T00:00:01.000Z',
      )
      const m2CorruptSelfLoop = makeMsg(
        '22222222-2222-4222-8222-222222222222',
        '22222222-2222-4222-8222-222222222222',
        '2026-01-01T00:00:01.500Z',
      )
      const m3 = makeMsg(
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222',
        '2026-01-01T00:00:02.000Z',
      )
      writeFileSync(
        file,
        [m1, m2Valid, m2CorruptSelfLoop, m3].map(e => JSON.stringify(e)).join('\n') +
          '\n',
      )

      const loaded = await loadTranscriptFile(file)
      const chain = buildConversationChain(
        loaded.messages,
        loaded.messages.get(m3.uuid)!,
      )
      expect(chain.map(m => m.uuid)).toEqual([m1.uuid, m2Valid.uuid, m3.uuid])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
