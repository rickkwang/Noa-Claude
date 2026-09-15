import { describe, expect, test } from 'bun:test'
// Import order matters: AgentTool.tsx must evaluate before agentToolUtils,
// which prepareForkedCommandContext loads lazily.
import '../../tools/AgentTool/AgentTool.js'
import { prepareForkedCommandContext } from '../../utils/forkedAgent.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOOLS = [{ name: 'Bash' }, { name: 'Read' }] as any

function agent(agentType: string, tools: string[]): any {
  return { agentType, tools, source: 'built-in', getSystemPrompt: () => '' }
}

async function expansionContext(commandAgent: string | undefined): Promise<any> {
  let seen: any
  await prepareForkedCommandContext(
    {
      agent: commandAgent,
      getPromptForCommand: async (_args: string, ctx: any) => {
        seen = ctx
        return [{ type: 'text', text: 'body' }]
      },
    } as any,
    '',
    {
      getAppState: () => ({ toolPermissionContext: { mode: 'auto' } }),
      options: {
        tools: TOOLS,
        agentDefinitions: {
          activeAgents: [agent('general-purpose', ['*']), agent('reader', ['Read'])],
        },
      },
    } as any,
  )
  return seen
}

describe('prepareForkedCommandContext prompt shell hand-off', () => {
  test('judges hand-off against the general-purpose fork tools', async () => {
    const ctx = await expansionContext(undefined)
    expect(ctx.promptShellHandOff).toBe(true)
    expect(ctx.options.tools.map((t: any) => t.name)).toContain('Bash')
  })

  test("judges hand-off against a named agent's own tools", async () => {
    const ctx = await expansionContext('reader')
    expect(ctx.promptShellHandOff).toBe(true)
    expect(ctx.options.tools.map((t: any) => t.name)).toEqual(['Read'])
  })
})
