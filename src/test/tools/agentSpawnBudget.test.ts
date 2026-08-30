import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'
import {
  getTotalAgentSpawns,
  resetSessionBudgets,
} from '../../utils/task/sessionBudget.js'

describe('AgentTool spawn budget', () => {
  beforeEach(resetSessionBudgets)
  afterEach(resetSessionBudgets)

  test('does not consume budget when the agent type is rejected before launch', async () => {
    const appState = {
      toolPermissionContext: {
        mode: 'acceptEdits',
        alwaysAllowRules: {},
        alwaysDenyRules: {},
      },
    }
    const context = {
      getAppState: () => appState,
      setAppState: () => undefined,
      options: {
        agentDefinitions: { activeAgents: [] },
      },
    }

    await expect(
      AgentTool.call(
        {
          prompt: 'test',
          description: 'test agent',
          subagent_type: 'missing-agent',
        },
        context as never,
        undefined as never,
        undefined as never,
      ),
    ).rejects.toThrow("Agent type 'missing-agent' not found")

    expect(getTotalAgentSpawns()).toBe(0)
  })

  test('does not consume budget when required MCP servers are unavailable', async () => {
    const appState = {
      toolPermissionContext: {
        mode: 'acceptEdits',
        alwaysAllowRules: {},
        alwaysDenyRules: {},
      },
      mcp: { clients: [], tools: [] },
    }
    const context = {
      getAppState: () => appState,
      setAppState: () => undefined,
      options: {
        agentDefinitions: {
          activeAgents: [
            {
              agentType: 'mcp-agent',
              source: 'custom',
              requiredMcpServers: ['missing-server'],
            },
          ],
        },
      },
    }

    await expect(
      AgentTool.call(
        {
          prompt: 'test',
          description: 'test agent',
          subagent_type: 'mcp-agent',
        },
        context as never,
        undefined as never,
        undefined as never,
      ),
    ).rejects.toThrow("Agent 'mcp-agent' requires MCP servers")

    expect(getTotalAgentSpawns()).toBe(0)
  })
})
