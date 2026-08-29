import { describe, expect, test } from 'bun:test'
import { getAgentSystemPrompt } from '../../tools/AgentTool/runAgent.js'

// Pins the fallback reporting contract: the [WARN] marker is driven by this
// callback, so it must fire exactly when the custom prompt build fails and
// DEFAULT_AGENT_PROMPT is used — not on the caller's first attempt, and not
// be skipped on the worktree/cwd path where runAgent builds internally.
describe('getAgentSystemPrompt fallback reporting', () => {
  const base = {
    toolUseContext: { options: {} },
    model: 'claude-opus-5',
    dirs: [] as string[],
    tools: [] as never[],
  }

  test('fires onFallback when the custom prompt build throws', async () => {
    let fellBack = false
    const result = await getAgentSystemPrompt(
      {
        getSystemPrompt: () => {
          throw new Error('boom')
        },
      } as never,
      base.toolUseContext as never,
      base.model,
      base.dirs,
      base.tools,
      () => {
        fellBack = true
      },
    )
    expect(fellBack).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  test('does not fire onFallback when the build succeeds', async () => {
    let fellBack = false
    await getAgentSystemPrompt(
      { getSystemPrompt: () => 'custom prompt' } as never,
      base.toolUseContext as never,
      base.model,
      base.dirs,
      base.tools,
      () => {
        fellBack = true
      },
    )
    expect(fellBack).toBe(false)
  })
})
