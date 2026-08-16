import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep as pathSep } from 'node:path'
import type { Message } from '../../../types/message.js'
import {
  clearOldToolResults,
  MC_CLEARED_INPUT_MESSAGE,
  MC_PERSISTED_OUTPUT_TAG,
  microcompactMessages,
  TIME_BASED_MC_CLEARED_MESSAGE,
} from '../../../services/compact/microCompact.js'
import {
  getSizeBasedMCConfig,
  shouldSizeTrigger,
} from '../../../services/compact/sizeBasedMCConfig.js'
import {
  PERSISTED_OUTPUT_TAG,
  TOOL_RESULT_CLEARED_MESSAGE,
  getToolResultPath,
  getToolResultsDir,
} from '../../../utils/toolResultStorage.js'
import { getProjectDir } from '../../../utils/sessionStorage.js'

// Cleared tool results are persisted under the config home. Point it at a temp
// dir so the suite never writes into the real ~/.noa. compact.test may have
// populated getProjectDir's cwd-keyed memo before this file runs, so clear it
// after changing the env and again after restoring the process environment.
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'noa-mc-test-'))
getProjectDir.cache.clear?.()
afterAll(() => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
  getProjectDir.cache.clear?.()
})

// A tool result counts as cleared in either form: the bare marker (persistence
// unavailable or refused) or a persisted pointer.
function isCleared(content: unknown): boolean {
  return (
    content === TIME_BASED_MC_CLEARED_MESSAGE ||
    (typeof content === 'string' && content.startsWith(MC_PERSISTED_OUTPUT_TAG))
  )
}

let counter = 0
function id(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

// assistant message issuing a tool_use of the given tool name
function toolUse(
  toolName: string,
  toolId: string,
  input: Record<string, unknown> = {},
): Message {
  const uuid = id('a')
  return {
    type: 'assistant',
    id: uuid,
    uuid,
    message: {
      id: uuid,
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
    },
  } as unknown as Message
}

function toolUseInput(
  message: Message,
  toolId: string,
): Record<string, unknown> | undefined {
  const content = (message as { message: { content: unknown[] } }).message
    .content
  const block = content.find(
    b =>
      typeof b === 'object' &&
      b !== null &&
      (b as { type?: string }).type === 'tool_use' &&
      (b as { id?: string }).id === toolId,
  )
  return (block as { input?: Record<string, unknown> } | undefined)?.input
}

// user message carrying the tool_result for a prior tool_use
function toolResult(toolId: string, text: string): Message {
  const uuid = id('u')
  return {
    type: 'user',
    uuid,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, content: text }],
    },
  } as unknown as Message
}

function resultContent(message: Message, toolId: string): unknown {
  const content = (message as { message: { content: unknown[] } }).message.content
  const block = content.find(
    (b): b is { type: string; tool_use_id: string; content: unknown } =>
      typeof b === 'object' &&
      b !== null &&
      (b as { type?: string }).type === 'tool_result' &&
      (b as { tool_use_id?: string }).tool_use_id === toolId,
  )
  return block?.content
}

const originalEnv = {
  CLAUDE_CODE_SIZE_MICROCOMPACT: process.env.CLAUDE_CODE_SIZE_MICROCOMPACT,
  CLAUDE_CODE_SIZE_MICROCOMPACT_PCT: process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT,
  CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP:
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('clearOldToolResults', () => {
  test('keeps the last N compactable tool results, clears older ones', () => {
    const messages: Message[] = []
    for (let i = 0; i < 5; i++) {
      const t = `tool-${i}`
      messages.push(toolUse('Read', t))
      messages.push(toolResult(t, `content of read ${i} ${'x'.repeat(40)}`))
    }

    const out = clearOldToolResults(messages, 2)
    expect(out).not.toBeNull()
    expect(out!.cleared).toBe(3)
    expect(out!.kept).toBe(2)
    expect(out!.tokensSaved).toBeGreaterThan(0)

    // tool-0..tool-2 cleared, tool-3/tool-4 preserved
    expect(resultContent(out!.messages[1]!, 'tool-0')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[5]!, 'tool-2')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[7]!, 'tool-3')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[9]!, 'tool-4')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
  })

  test('does not clear non-compactable tool results', () => {
    const messages: Message[] = [
      toolUse('AskUserQuestion', 'q-1'),
      toolResult('q-1', 'an answer that should survive clearing entirely'),
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'file contents '.repeat(20)),
      toolUse('Read', 'r-2'),
      toolResult('r-2', 'more file contents '.repeat(20)),
    ]
    // keepRecent 1 → only r-2 kept among compactables; r-1 cleared; q-1 untouched
    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    expect(resultContent(out!.messages[1]!, 'q-1')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[3]!, 'r-1')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[5]!, 'r-2')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
  })

  test('returns null when nothing is clearable', () => {
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'only one result, kept by keepRecent'),
    ]
    expect(clearOldToolResults(messages, 5)).toBeNull()
  })

  test('floors keepRecent at 1 so it never clears everything', () => {
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'first '.repeat(20)),
      toolUse('Read', 'r-2'),
      toolResult('r-2', 'second '.repeat(20)),
    ]
    const out = clearOldToolResults(messages, 0)
    expect(out).not.toBeNull()
    // last result always survives
    expect(resultContent(out!.messages[3]!, 'r-2')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
  })

  test('clears large Write inputs alongside their cleared results', () => {
    const bigContent = 'line of generated file content\n'.repeat(200)
    const messages: Message[] = [
      toolUse('Write', 'w-1', { file_path: '/tmp/a.ts', content: bigContent }),
      toolResult('w-1', 'File written successfully'),
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'recent read kept '.repeat(20)),
    ]

    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    const input = toolUseInput(out!.messages[0]!, 'w-1')
    expect(input?.content).toBe(MC_CLEARED_INPUT_MESSAGE)
    // file_path stays — the model needs it to re-Read the file if required
    expect(input?.file_path).toBe('/tmp/a.ts')
  })

  test('clears large Edit input strings field-by-field', () => {
    const bigOld = 'old function body\n'.repeat(200)
    const messages: Message[] = [
      toolUse('Edit', 'e-1', {
        file_path: '/tmp/b.ts',
        old_string: bigOld,
        new_string: 'tiny replacement',
      }),
      toolResult('e-1', 'edited'),
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'recent read kept '.repeat(20)),
    ]

    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    const input = toolUseInput(out!.messages[0]!, 'e-1')
    expect(input?.old_string).toBe(MC_CLEARED_INPUT_MESSAGE)
    // small fields stay — clearing them saves nothing and loses context
    expect(input?.new_string).toBe('tiny replacement')
  })

  test('leaves small Write inputs untouched', () => {
    const messages: Message[] = [
      toolUse('Write', 'w-1', { file_path: '/tmp/a.ts', content: 'short' }),
      toolResult('w-1', 'File written successfully '.repeat(20)),
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'recent read kept '.repeat(20)),
    ]

    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    expect(toolUseInput(out!.messages[0]!, 'w-1')?.content).toBe('short')
  })

  test('keeps inputs of the most recent tool uses intact', () => {
    const bigContent = 'kept content\n'.repeat(300)
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'old read cleared '.repeat(20)),
      toolUse('Write', 'w-1', { file_path: '/tmp/a.ts', content: bigContent }),
      toolResult('w-1', 'File written successfully'),
    ]

    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    expect(toolUseInput(out!.messages[2]!, 'w-1')?.content).toBe(bigContent)
  })

  test('input clearing counts toward tokensSaved and is idempotent', () => {
    const bigContent = 'generated file content\n'.repeat(300)
    const small = 'File written successfully'
    const make = (content: string): Message[] => [
      toolUse('Write', 'w-1', { file_path: '/tmp/a.ts', content }),
      toolResult('w-1', small),
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'recent read kept '.repeat(20)),
    ]

    const first = clearOldToolResults(make(bigContent), 1)
    expect(first).not.toBeNull()
    // result text is tiny; the bulk of the savings must come from the input
    expect(first!.tokensSaved).toBeGreaterThan(1000)

    // Second pass over already-cleared messages: nothing new to clear
    const second = clearOldToolResults(first!.messages, 1)
    expect(second).toBeNull()
  })

  test('ignores a pointer that costs more than the content it replaces', () => {
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'tiny'),
      toolUse('Read', 'r-2'),
      toolResult('r-2', 'recent read kept '.repeat(20)),
    ]
    const pointers = {
      results: new Map([
        [
          'r-1',
          `${MC_PERSISTED_OUTPUT_TAG}Tool result saved to: ${'/very/long/path'.repeat(20)}\n\nUse Read to view</persisted-output>`,
        ],
      ]),
      inputs: new Map<string, string>(),
    }

    const out = clearOldToolResults(messages, 1, undefined, pointers)

    // The clear still happens — returning null here would throw away a rewrite
    // whose content is already on disk — but with the cheap marker.
    expect(out).not.toBeNull()
    expect(resultContent(out!.messages[1]!, 'r-1')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(out!.cleared).toBe(1)
  })

  test('cleared count reflects only results cleared on this pass', () => {
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      // r-1 was already cleared on a prior turn
      toolResult('r-1', TIME_BASED_MC_CLEARED_MESSAGE),
      toolUse('Read', 'r-2'),
      toolResult('r-2', 'still has real content '.repeat(20)),
      toolUse('Read', 'r-3'),
      toolResult('r-3', 'also real content '.repeat(20)),
      toolUse('Read', 'r-4'),
      toolResult('r-4', 'most recent, kept '.repeat(20)),
    ]
    // keepRecent 1 → keep r-4; clearSet = {r-1, r-2, r-3} but r-1 is already
    // cleared, so only r-2 and r-3 are newly cleared.
    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    expect(out!.cleared).toBe(2)
  })
})

describe('inlined constants track toolResultStorage', () => {
  // microCompact.ts inlines these to avoid a circular import; this is the
  // drift check its comment promises.
  test('cleared-result marker matches the source of truth', () => {
    expect(TIME_BASED_MC_CLEARED_MESSAGE).toBe(TOOL_RESULT_CLEARED_MESSAGE)
  })

  test('persisted-output tag matches the source of truth', () => {
    expect(MC_PERSISTED_OUTPUT_TAG).toBe(PERSISTED_OUTPUT_TAG)
  })
})

describe('tool result persistence paths', () => {
  test('keeps provider-controlled tool ids inside the session directory', () => {
    const base = getToolResultsDir()
    const target = getToolResultPath('../../outside', false)
    const relativeTarget = relative(base, target)

    expect(relativeTarget).not.toBe('..')
    expect(relativeTarget.startsWith(`..${pathSep}`)).toBe(false)
  })
})

describe('cleared tool results are persisted', () => {
  afterEach(restoreEnv)

  const ctx = {
    options: { mainLoopModel: 'claude-sonnet-4-5' },
  } as unknown as Parameters<typeof microcompactMessages>[1]

  function conversation(): Message[] {
    const messages: Message[] = []
    for (let i = 0; i < 4; i++) {
      const t = `persist-${i}`
      messages.push(toolUse('Read', t))
      messages.push(toolResult(t, `payload ${i} `.repeat(400)))
    }
    return messages
  }

  function contents(messages: Message[]): unknown[] {
    return messages.flatMap(m =>
      ((m as { message: { content: unknown[] } }).message.content ?? []).map(
        (b: unknown) => (b as { content?: unknown })?.content,
      ),
    )
  }

  async function runMicrocompact(input: Message[]): Promise<Message[]> {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP = '1'
    const out = await microcompactMessages(input, ctx, 'repl_main_thread')
    return out.messages
  }

  test('replaces content with a pointer to the persisted file', async () => {
    const pointers = contents(await runMicrocompact(conversation())).filter(
      (c): c is string =>
        typeof c === 'string' && c.startsWith(MC_PERSISTED_OUTPUT_TAG),
    )
    expect(pointers.length).toBe(3) // 4 results minus the 1 most recent kept

    const [first] = pointers
    expect(first).toContain('Tool result saved to: ')
    expect(first).toContain('Use Read to view')

    // The pointer has to actually resolve, or it is worse than the bare marker.
    const filepath = first!.match(/Tool result saved to: (.+)\n/)![1]!
    expect(readFileSync(filepath, 'utf-8')).toContain('payload 0')
  })

  test('a persisted pointer is not re-cleared on the next fire', async () => {
    const once = await runMicrocompact(conversation())
    const twice = await runMicrocompact(once)
    expect(contents(twice)).toEqual(contents(once))
  })

  // Clearing a Write/Edit input is the one microcompact loss with no upstream
  // analogue — upstream never touches tool_use inputs. Persisting them keeps
  // the token saving without making the content unrecoverable.
  function writeConversation(): Message[] {
    const messages: Message[] = []
    for (let i = 0; i < 4; i++) {
      const t = `wpersist-${i}`
      messages.push(
        toolUse('Write', t, {
          file_path: `/tmp/gen-${i}.ts`,
          content: `export const v${i} = ${i}\n`.repeat(400),
        }),
      )
      messages.push(toolResult(t, 'File written successfully'))
    }
    return messages
  }

  test('replaces a cleared Write input with a pointer to the persisted file', async () => {
    const out = await runMicrocompact(writeConversation())
    const input = toolUseInput(out[0]!, 'wpersist-0')

    expect(typeof input?.content).toBe('string')
    const pointer = input!.content as string
    expect(pointer.startsWith(MC_PERSISTED_OUTPUT_TAG)).toBe(true)
    expect(pointer).toContain('Tool input saved to: ')

    const filepath = pointer.match(/Tool input saved to: (.+)\n/)![1]!
    expect(readFileSync(filepath, 'utf-8')).toContain('export const v0 = 0')

    // file_path is small and load-bearing — it must survive unchanged
    expect(input?.file_path).toBe('/tmp/gen-0.ts')
  })

  test('a persisted input pointer is not overwritten on the next fire', async () => {
    const once = await runMicrocompact(writeConversation())
    const twice = await runMicrocompact(once)
    expect(toolUseInput(twice[0]!, 'wpersist-0')).toEqual(
      toolUseInput(once[0]!, 'wpersist-0'),
    )
  })

  test('each clearable input field gets its own file', async () => {
    const messages: Message[] = [
      toolUse('Edit', 'epersist-1', {
        file_path: '/tmp/e.ts',
        old_string: 'const before = 1\n'.repeat(400),
        new_string: 'const after = 2\n'.repeat(400),
      }),
      toolResult('epersist-1', 'edited'),
      toolUse('Read', 'epersist-keep'),
      toolResult('epersist-keep', 'recent read kept '.repeat(400)),
    ]
    const input = toolUseInput(
      (await runMicrocompact(messages))[0]!,
      'epersist-1',
    )

    const paths = ['old_string', 'new_string'].map(
      key => (input![key] as string).match(/Tool input saved to: (.+)\n/)![1]!,
    )
    expect(paths[0]).not.toBe(paths[1])
    expect(readFileSync(paths[0]!, 'utf-8')).toContain('const before = 1')
    expect(readFileSync(paths[1]!, 'utf-8')).toContain('const after = 2')
  })
})

describe('getSizeBasedMCConfig', () => {
  afterEach(restoreEnv)

  test('enabled by default with conservative fraction', () => {
    delete process.env.CLAUDE_CODE_SIZE_MICROCOMPACT
    delete process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT
    delete process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP
    const cfg = getSizeBasedMCConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.triggerFraction).toBeGreaterThan(0)
    expect(cfg.triggerFraction).toBeLessThanOrEqual(1)
    expect(cfg.keepRecent).toBeGreaterThanOrEqual(1)
  })

  test('disabled via env "0"', () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '0'
    expect(getSizeBasedMCConfig().enabled).toBe(false)
  })

  test('percent and keep overrides applied', () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '70'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP = '12'
    const cfg = getSizeBasedMCConfig()
    expect(cfg.triggerFraction).toBeCloseTo(0.7, 5)
    expect(cfg.keepRecent).toBe(12)
  })

  test('ignores out-of-range percent, falls back to default', () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '900'
    const cfg = getSizeBasedMCConfig()
    expect(cfg.triggerFraction).toBeGreaterThan(0)
    expect(cfg.triggerFraction).toBeLessThanOrEqual(1)
  })
})

describe('microcompactMessages — size-based wiring', () => {
  afterEach(restoreEnv)

  const ctx = {
    options: { mainLoopModel: 'claude-sonnet-4-5' },
  } as unknown as Parameters<typeof microcompactMessages>[1]

  function bigConversation(): Message[] {
    const messages: Message[] = []
    for (let i = 0; i < 6; i++) {
      const t = `big-${i}`
      messages.push(toolUse('Read', t))
      messages.push(toolResult(t, 'payload '.repeat(400)))
    }
    return messages
  }

  test('clears old tool results once the size threshold is crossed', async () => {
    // 1% of any window is tiny, so the conversation above always trips it.
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP = '2'

    const out = await microcompactMessages(
      bigConversation(),
      ctx,
      'repl_main_thread',
    )
    const cleared = out.messages.filter(m =>
      ((m as { message: { content: unknown[] } }).message.content ?? []).some(
        (b: unknown) => isCleared((b as { content?: unknown })?.content),
      ),
    )
    expect(cleared.length).toBe(4) // 6 results minus the 2 most recent kept
  })

  test('does nothing when disabled', async () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '0'
    const input = bigConversation()
    const out = await microcompactMessages(input, ctx, 'repl_main_thread')
    expect(out.messages).toEqual(input)
  })

  test('does not run for non-main-thread sources', async () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '1'
    const input = bigConversation()
    const out = await microcompactMessages(input, ctx, 'session_memory')
    expect(out.messages).toEqual(input)
  })
})

describe('shouldSizeTrigger', () => {
  const cfg = { enabled: true, triggerFraction: 0.85, keepRecent: 8 }

  test('fires once estimated tokens cross the fraction of the window', () => {
    expect(shouldSizeTrigger(86_000, 100_000, cfg)).toBe(true)
    expect(shouldSizeTrigger(84_000, 100_000, cfg)).toBe(false)
  })

  test('never fires when disabled', () => {
    expect(
      shouldSizeTrigger(99_000, 100_000, { ...cfg, enabled: false }),
    ).toBe(false)
  })

  test('never fires for a non-positive window', () => {
    expect(shouldSizeTrigger(99_000, 0, cfg)).toBe(false)
  })
})
