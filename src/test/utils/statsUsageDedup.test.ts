import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { aggregateClaudeCodeStatsForRange } from '../../utils/stats.js'

const savedConfigDir = process.env.CLAUDE_CONFIG_DIR
let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'noa-stats-dedup-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  rmSync(configDir, { recursive: true, force: true })
})

function assistantEntry(
  id: string,
  block: Record<string, unknown>,
  usage: Record<string, number>,
  timestamp: string,
) {
  return {
    type: 'assistant',
    uuid: `${id}-${String(block.type)}`,
    timestamp,
    sessionId: 's1',
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      content: [block],
      usage,
    },
  }
}

describe('stats token usage', () => {
  test('counts one API response once, not once per content-block entry', async () => {
    const now = new Date().toISOString()
    // message_start snapshot on the first block, final usage on the last.
    const snapshot = {
      input_tokens: 2,
      output_tokens: 0,
      cache_read_input_tokens: 90_000,
      cache_creation_input_tokens: 1_000,
    }
    const final = { ...snapshot, output_tokens: 300 }
    const entries = [
      { type: 'user', uuid: 'u1', timestamp: now, sessionId: 's1', message: { role: 'user', content: 'hi' } },
      assistantEntry('msg_a', { type: 'thinking', thinking: '' }, snapshot, now),
      assistantEntry('msg_a', { type: 'text', text: 'ok' }, snapshot, now),
      assistantEntry('msg_a', { type: 'tool_use', id: 't1', name: 'Read', input: {} }, final, now),
    ]
    const projectDir = join(configDir, 'projects', 'p')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      join(projectDir, 's1.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n',
    )

    const stats = await aggregateClaudeCodeStatsForRange('7d')
    const usage = stats.modelUsage['claude-opus-5']!

    expect(usage.cacheReadInputTokens).toBe(90_000)
    expect(usage.cacheCreationInputTokens).toBe(1_000)
    expect(usage.inputTokens).toBe(2)
    expect(usage.outputTokens).toBe(300)
  })

  test('counts a response replayed into a forked transcript once', async () => {
    const now = new Date().toISOString()
    const usage = {
      input_tokens: 2,
      output_tokens: 100,
      cache_read_input_tokens: 50_000,
      cache_creation_input_tokens: 500,
    }
    const user = { type: 'user', uuid: 'u1', timestamp: now, sessionId: 's1', message: { role: 'user', content: 'hi' } }
    const parent = assistantEntry('msg_p', { type: 'text', text: 'ok' }, usage, now)
    const projectDir = join(configDir, 'projects', 'p')
    const subagentsDir = join(projectDir, 's1', 'subagents')
    mkdirSync(subagentsDir, { recursive: true })
    writeFileSync(join(projectDir, 's1.jsonl'), [user, parent].map(e => JSON.stringify(e)).join('\n') + '\n')
    // The compact fork's transcript replays the parent's history.
    writeFileSync(
      join(subagentsDir, 'agent-acompact-abc.jsonl'),
      [user, parent].map(e => JSON.stringify({ ...e, isSidechain: true })).join('\n') + '\n',
    )

    const stats = await aggregateClaudeCodeStatsForRange('7d')
    expect(stats.modelUsage['claude-opus-5']!.cacheReadInputTokens).toBe(50_000)
  })
})
