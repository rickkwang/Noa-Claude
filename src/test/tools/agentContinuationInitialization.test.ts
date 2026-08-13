import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('foreground agent continuation initialization', () => {
  test('reuses the captured initialized prompt without injecting hooks or skills twice', () => {
    const agentTool = readFileSync(
      resolve(import.meta.dir, '../../tools/AgentTool/AgentTool.tsx'),
      'utf8',
    )
    const runAgent = readFileSync(
      resolve(import.meta.dir, '../../tools/AgentTool/runAgent.ts'),
      'utf8',
    )

    expect(agentTool).toContain(
      'reuseInitializedPromptContext: hasInitializedPromptContext',
    )
    expect(agentTool).toContain(
      'const hasInitializedPromptContext = foregroundInitialMessages !== undefined',
    )
    expect(runAgent).toContain('reuseInitializedPromptContext?: boolean')
    expect(runAgent).toContain('if (!reuseInitializedPromptContext) {')
  })
})
