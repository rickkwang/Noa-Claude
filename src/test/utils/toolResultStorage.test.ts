import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getProjectDir } from '../../utils/sessionStorage.js'

// Results are persisted under the config home. Point it at a temp dir so the
// suite never writes into the real ~/.noa, and clear getProjectDir's cwd-keyed
// memo (another file in the run may already have populated it).
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'noa-trs-test-'))
getProjectDir.cache.clear?.()
afterAll(() => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
  getProjectDir.cache.clear?.()
})

import { MAX_TOOL_RESULTS_PER_MESSAGE_CHARS } from '../../constants/toolLimits.js'
import type { Message } from '../../types/message.js'
import {
  createContentReplacementState,
  cloneContentReplacementState,
  enforceToolResultBudget,
  getPerMessageBudgetLimit,
  getPersistenceThreshold,
  isToolResultContentEmpty,
  PERSISTED_OUTPUT_TAG,
  reconstructContentReplacementState,
} from '../../utils/toolResultStorage.js'

// tool_use_ids must be unique across the whole file: persistToolResult writes
// with flag 'wx' and treats EEXIST as "already persisted", so a reused id in a
// later test would silently pick up the earlier test's file.
let counter = 0
const nextId = () => `tu-${++counter}`

// Over half the per-message budget, so any two in one group exceed it.
const BIG = 'x'.repeat(150_000)

function assistant(msgId: string, toolIds: string[]): Message {
  return {
    type: 'assistant',
    id: msgId,
    uuid: `${msgId}-${++counter}`,
    message: {
      id: msgId,
      role: 'assistant',
      content: toolIds.map(id => ({
        type: 'tool_use',
        id,
        name: 'Bash',
        input: {},
      })),
    },
  } as unknown as Message
}

function userResult(toolId: string, text: string): Message {
  return {
    type: 'user',
    uuid: `u-${++counter}`,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, content: text }],
    },
  } as unknown as Message
}

function contentOf(messages: Message[], toolId: string): unknown {
  for (const m of messages) {
    if (m.type !== 'user') continue
    const blocks = (m as { message: { content: unknown } }).message.content
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      const block = b as { type?: string; tool_use_id?: string; content?: unknown }
      if (block.type === 'tool_result' && block.tool_use_id === toolId) {
        return block.content
      }
    }
  }
  return undefined
}

const isReplaced = (c: unknown) =>
  typeof c === 'string' && c.startsWith(PERSISTED_OUTPUT_TAG)

describe('getPersistenceThreshold', () => {
  test('clamps a declared cap to the system-wide default', () => {
    // 36 of the built-in tools declare 100_000; the global cap is what
    // actually applies. Guards against someone "fixing" the clamp away.
    expect(getPersistenceThreshold('Bash', 100_000)).toBe(50_000)
  })

  test('a declared cap below the default is kept', () => {
    expect(getPersistenceThreshold('Anything', 10_000)).toBe(10_000)
  })

  test('Infinity is a hard opt-out, not clamped', () => {
    // Read opts out: persisting its output to a file the model reads back
    // with Read is circular.
    expect(getPersistenceThreshold('Read', Infinity)).toBe(Infinity)
  })
})

describe('getPerMessageBudgetLimit', () => {
  test('falls back to the constant when no override is served', () => {
    expect(getPerMessageBudgetLimit()).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS)
  })
})

describe('isToolResultContentEmpty', () => {
  test.each([
    ['undefined', undefined, true],
    ['empty string', '', true],
    ['whitespace only', '   \n\t ', true],
    ['empty array', [], true],
    ['array of empty text blocks', [{ type: 'text', text: '  ' }], true],
    ['non-empty string', 'ok', false],
    ['array with text', [{ type: 'text', text: 'ok' }], false],
  ])('%s → %p', (_label, input, expected) => {
    expect(isToolResultContentEmpty(input as never)).toBe(expected)
  })

  test('an image block counts as non-empty', () => {
    expect(
      isToolResultContentEmpty([
        { type: 'image', source: { type: 'base64', data: '', media_type: 'image/png' } },
      ] as never),
    ).toBe(false)
  })
})

describe('enforceToolResultBudget — per-message grouping', () => {
  test('two results under one assistant message share a budget group', async () => {
    const [t1, t2] = [nextId(), nextId()]
    const messages = [
      assistant('m-same', [t1, t2]),
      userResult(t1, BIG),
      userResult(t2, BIG),
    ]
    const state = createContentReplacementState()
    const { messages: out, newlyReplaced } = await enforceToolResultBudget(
      messages,
      state,
    )

    // 300K in one wire message > 200K budget → the largest is shed until
    // the group is under budget. One replacement is enough (150K ≤ 200K).
    expect(newlyReplaced).toHaveLength(1)
    const replacedId = newlyReplaced[0]!.toolUseId
    expect([t1, t2]).toContain(replacedId)
    expect(isReplaced(contentOf(out, replacedId))).toBe(true)
  })

  test('separate assistant ids split the results into separate groups', async () => {
    const [t1, t2] = [nextId(), nextId()]
    const messages = [
      assistant('m-a', [t1]),
      userResult(t1, BIG),
      assistant('m-b', [t2]),
      userResult(t2, BIG),
    ]
    const state = createContentReplacementState()
    const { messages: out, newlyReplaced } = await enforceToolResultBudget(
      messages,
      state,
    )

    // Each group is 150K, under the 200K budget → nothing is replaced.
    // Messages are evaluated independently; this is the documented contract.
    expect(newlyReplaced).toHaveLength(0)
    expect(isReplaced(contentOf(out, t1))).toBe(false)
    expect(isReplaced(contentOf(out, t2))).toBe(false)
  })

  test('a repeated assistant id does NOT open a new group', async () => {
    // normalizeMessagesForAPI merges same-id assistant fragments into one wire
    // message, so their tool_results land in one user message. If the budget
    // split them here they would each look under-budget, get frozen, and then
    // be merged over-budget on the wire — exactly the case the grouping logic
    // exists for.
    const [t1, t2] = [nextId(), nextId()]
    const messages = [
      assistant('m-x', [t1, t2]),
      userResult(t1, BIG),
      assistant('m-x', []), // same id — a second streamed fragment
      userResult(t2, BIG),
    ]
    const state = createContentReplacementState()
    const { newlyReplaced } = await enforceToolResultBudget(messages, state)

    expect(newlyReplaced).toHaveLength(1)
  })
})

describe('enforceToolResultBudget — decisions are frozen for prompt cache', () => {
  test('a result left unreplaced is never replaced on a later turn', async () => {
    const [t1, t2, t3] = [nextId(), nextId(), nextId()]
    const turn1 = [assistant('m-1', [t1]), userResult(t1, BIG)]
    const state = createContentReplacementState()

    // Turn 1: 150K alone is under budget → untouched, but now "seen".
    const first = await enforceToolResultBudget(turn1, state)
    expect(first.newlyReplaced).toHaveLength(0)
    expect(state.seenIds.has(t1)).toBe(true)

    // Turn 2: two more results arrive under the SAME assistant id, so t1 is
    // now in an over-budget group. It must still not be replaced — the model
    // already saw it unreplaced and rewriting it would break the cached prefix.
    const turn2 = [
      assistant('m-1', [t2, t3]),
      userResult(t1, BIG),
      userResult(t2, BIG),
      userResult(t3, BIG),
    ]
    const second = await enforceToolResultBudget(turn2, state)

    expect(second.newlyReplaced.map(r => r.toolUseId)).not.toContain(t1)
    expect(isReplaced(contentOf(second.messages, t1))).toBe(false)
  })

  test('a replacement is re-applied byte-identically and not re-reported', async () => {
    const [t1, t2] = [nextId(), nextId()]
    const messages = [
      assistant('m-2', [t1, t2]),
      userResult(t1, BIG),
      userResult(t2, BIG),
    ]
    const state = createContentReplacementState()

    const first = await enforceToolResultBudget(messages, state)
    expect(first.newlyReplaced).toHaveLength(1)
    const id = first.newlyReplaced[0]!.toolUseId
    const firstContent = contentOf(first.messages, id)

    // Re-running the same turn (microcompact replays the original messages)
    // must produce the same bytes and report nothing new to the transcript.
    const second = await enforceToolResultBudget(messages, state)
    expect(second.newlyReplaced).toHaveLength(0)
    expect(contentOf(second.messages, id)).toBe(firstContent as string)
  })

  test('tagged content is not a candidate even to a state that has never seen it', async () => {
    // The tag — not the state — is what disqualifies already-compacted
    // content. A state with no memory of this id (fresh session reading a
    // resumed transcript, or the per-tool limit having already persisted it)
    // must still skip it rather than wrap a preview in a second preview.
    const [t1, t2] = [nextId(), nextId()]
    const alreadyTagged = `${PERSISTED_OUTPUT_TAG}\n${'y'.repeat(250_000)}\n</persisted-output>`
    const messages = [
      assistant('m-3', [t1, t2]),
      userResult(t1, alreadyTagged),
      userResult(t2, 'small'),
    ]

    const { messages: out, newlyReplaced } = await enforceToolResultBudget(
      messages,
      createContentReplacementState(),
    )

    // 250K would blow the 200K budget on its own if it counted as a candidate.
    expect(newlyReplaced).toHaveLength(0)
    const content = contentOf(out, t1) as string
    expect(content).toBe(alreadyTagged)
    expect(content.indexOf(PERSISTED_OUTPUT_TAG)).toBe(
      content.lastIndexOf(PERSISTED_OUTPUT_TAG),
    )
  })

  test('a cloned state makes the same decisions as its source', async () => {
    // Cache-sharing forks clone the parent's state so both send identical
    // bytes for the same tool_use_ids.
    const [t1, t2] = [nextId(), nextId()]
    const messages = [
      assistant('m-4', [t1, t2]),
      userResult(t1, BIG),
      userResult(t2, BIG),
    ]
    const source = createContentReplacementState()
    const parent = await enforceToolResultBudget(messages, source)
    const id = parent.newlyReplaced[0]!.toolUseId

    const fork = cloneContentReplacementState(source)
    const forked = await enforceToolResultBudget(messages, fork)

    expect(forked.newlyReplaced).toHaveLength(0)
    expect(contentOf(forked.messages, id)).toBe(
      contentOf(parent.messages, id) as string,
    )

    // Mutating the clone must not reach back into the source.
    fork.seenIds.add('unrelated')
    expect(source.seenIds.has('unrelated')).toBe(false)
  })
})

describe('enforceToolResultBudget — skipToolNames', () => {
  test('a skipped tool is frozen rather than persisted', async () => {
    const [t1, t2] = [nextId(), nextId()]
    const messages = [
      {
        type: 'assistant',
        id: 'm-5',
        uuid: `m-5-${++counter}`,
        message: {
          id: 'm-5',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: t1, name: 'Read', input: {} },
            { type: 'tool_use', id: t2, name: 'Read', input: {} },
          ],
        },
      } as unknown as Message,
      userResult(t1, BIG),
      userResult(t2, BIG),
    ]
    const state = createContentReplacementState()
    const { messages: out, newlyReplaced } = await enforceToolResultBudget(
      messages,
      state,
      new Set(['Read']),
    )

    // Read self-bounds via its own maxTokens; the budget must leave it alone
    // even when the group is over budget — but still mark it seen so the
    // decision sticks.
    expect(newlyReplaced).toHaveLength(0)
    expect(isReplaced(contentOf(out, t1))).toBe(false)
    expect(isReplaced(contentOf(out, t2))).toBe(false)
    expect(state.seenIds.has(t1)).toBe(true)
    expect(state.seenIds.has(t2)).toBe(true)
  })
})

describe('reconstructContentReplacementState', () => {
  test('every candidate in the transcript is frozen', async () => {
    const [t1, t2] = [nextId(), nextId()]
    const messages = [
      assistant('m-6', [t1, t2]),
      userResult(t1, BIG),
      userResult(t2, BIG),
    ]

    // Resume with no records at all: the model already saw both unreplaced,
    // so neither may be replaced now.
    const state = reconstructContentReplacementState(messages, [])
    expect(state.seenIds.has(t1)).toBe(true)
    expect(state.seenIds.has(t2)).toBe(true)

    const { newlyReplaced } = await enforceToolResultBudget(messages, state)
    expect(newlyReplaced).toHaveLength(0)
  })

  test('a stored replacement is restored verbatim, not re-derived', async () => {
    const t1 = nextId()
    const messages = [assistant('m-7', [t1]), userResult(t1, BIG)]
    const stored = `${PERSISTED_OUTPUT_TAG}\nfrom a previous session\n</persisted-output>`

    const state = reconstructContentReplacementState(messages, [
      { kind: 'tool-result', toolUseId: t1, replacement: stored },
    ])
    const { messages: out } = await enforceToolResultBudget(messages, state)

    // Storing the exact string (rather than rebuilding it) is what makes a
    // preview-template change safe across resume.
    expect(contentOf(out, t1)).toBe(stored)
  })

  test('records for ids absent from the messages are dropped', () => {
    const t1 = nextId()
    const messages = [assistant('m-8', [t1]), userResult(t1, 'small')]
    const state = reconstructContentReplacementState(messages, [
      { kind: 'tool-result', toolUseId: 'gone-after-compact', replacement: 'x' },
    ])
    expect(state.replacements.has('gone-after-compact')).toBe(false)
  })

  test('inherited replacements gap-fill only ids present in the messages', () => {
    const [t1, t2] = [nextId(), nextId()]
    const messages = [assistant('m-9', [t1]), userResult(t1, 'small')]
    const state = reconstructContentReplacementState(
      messages,
      [],
      new Map([
        [t1, 'inherited-preview'],
        [t2, 'not-in-messages'],
      ]),
    )
    // A fork's parent-inherited replacements are never written as records, so
    // without this gap-fill a resumed fork would classify them as frozen and
    // send full content while the parent sends the preview.
    expect(state.replacements.get(t1)).toBe('inherited-preview')
    expect(state.replacements.has(t2)).toBe(false)
  })

  test('a record never overrides an inherited value for the same id', () => {
    const t1 = nextId()
    const messages = [assistant('m-10', [t1]), userResult(t1, 'small')]
    const state = reconstructContentReplacementState(
      messages,
      [{ kind: 'tool-result', toolUseId: t1, replacement: 'from-record' }],
      new Map([[t1, 'from-parent']]),
    )
    expect(state.replacements.get(t1)).toBe('from-record')
  })
})

describe('enforceToolResultBudget — pass-through', () => {
  test('returns the same array instance when nothing needs replacing', async () => {
    const t1 = nextId()
    const messages = [assistant('m-11', [t1]), userResult(t1, 'small')]
    const state = createContentReplacementState()
    const { messages: out, newlyReplaced } = await enforceToolResultBudget(
      messages,
      state,
    )
    expect(out).toBe(messages)
    expect(newlyReplaced).toHaveLength(0)
  })

  test('image blocks are never persisted', async () => {
    const t1 = nextId()
    const image = {
      type: 'user',
      uuid: `u-img-${++counter}`,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: t1,
            content: [
              { type: 'text', text: BIG },
              {
                type: 'image',
                source: { type: 'base64', data: '', media_type: 'image/png' },
              },
            ],
          },
        ],
      },
    } as unknown as Message
    const messages = [assistant('m-12', [t1]), image, userResult(nextId(), BIG)]
    const state = createContentReplacementState()
    const { newlyReplaced } = await enforceToolResultBudget(messages, state)

    expect(newlyReplaced.map(r => r.toolUseId)).not.toContain(t1)
  })
})
