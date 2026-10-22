import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// Read's description resolves PDF support, which walks through model defaults
// into auth. Tests here are self-contained (no preload), so seed a key first.
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'

// The lean/verbose gate judges provider identity from env
// (isUntrustedModelIdentity): an ambient ANTHROPIC_BASE_URL or
// CLAUDE_CODE_USE_* from the dev shell flips every assertion here to the
// verbose branch. Scrub before each test, restore after.
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
  'NOA_CLAUDE_WRITE_REQUIRE_READ',
  'CLAUDE_CODE_AGENT_LIST_IN_MESSAGES',
] as const
const originalProviderEnv = Object.fromEntries(
  PROVIDER_ENV_KEYS.map(k => [k, process.env[k]]),
)
beforeEach(() => {
  for (const k of PROVIDER_ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of PROVIDER_ENV_KEYS) {
    const value = originalProviderEnv[k]
    if (value === undefined) delete process.env[k]
    else process.env[k] = value
  }
})

import { getDescription as globDescription } from '../../tools/GlobTool/prompt.js'
import { getDescription as grepDescription } from '../../tools/GrepTool/prompt.js'
import { getWriteToolDescription } from '../../tools/FileWriteTool/prompt.js'
import { getEditToolDescription } from '../../tools/FileEditTool/prompt.js'
import { getWebSearchPrompt } from '../../tools/WebSearchTool/prompt.js'
import { getTodoWritePrompt } from '../../tools/TodoWriteTool/prompt.js'
import { getPrompt as agentPrompt } from '../../tools/AgentTool/prompt.js'
import { EXPLORE_AGENT } from '../../tools/AgentTool/built-in/exploreAgent.js'
import { getAgentListingDeltaAttachment } from '../../utils/attachments.js'
import { getSubagentSteer, resetSubagentSteerLatch } from '../../utils/subagentSteer.js'
import { getSessionSpecificGuidanceSection } from '../../constants/systemPromptDynamicSections.js'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  LINE_FORMAT_INSTRUCTION,
  OFFSET_INSTRUCTION_TARGETED,
  renderPromptTemplate,
} from '../../tools/FileReadTool/prompt.js'

const LEAN_MODEL = 'claude-opus-5'
const FULL_MODEL = 'claude-sonnet-5'
/** Verbose *and* still required to Read before writing — the most complete form. */
const PRE_READ_MODEL = 'claude-sonnet-4-5'

const RENDERERS: Array<[string, (model?: string) => string]> = [
  ['Glob', globDescription],
  ['Grep', grepDescription],
  ['Write', getWriteToolDescription],
  ['Edit', getEditToolDescription],
  ['WebSearch', getWebSearchPrompt],
  ['TodoWrite', getTodoWritePrompt],
  [
    'Read',
    model =>
      renderPromptTemplate(
        LINE_FORMAT_INSTRUCTION,
        '',
        OFFSET_INSTRUCTION_TARGETED,
        model,
      ),
  ],
]

describe('lean tool descriptions', () => {
  test.each(RENDERERS)('%s has a shorter lean variant', (_name, render) => {
    const full = render(FULL_MODEL)
    const lean = render(LEAN_MODEL)
    expect(lean.length).toBeLessThan(full.length)
    expect(lean.trim().length).toBeGreaterThan(0)
  })

  test.each(RENDERERS)(
    '%s falls back to the full description without a model',
    (_name, render) => {
      expect(render(undefined)).toBe(render(PRE_READ_MODEL))
    },
  )

  test('lean variants keep the behaviour-defining facts', () => {
    // Each of these changes what the model is allowed or expected to do, so
    // they must survive trimming.
    expect(getEditToolDescription(LEAN_MODEL)).toContain('Read')
    process.env.NOA_CLAUDE_WRITE_REQUIRE_READ = '1'
    expect(getWriteToolDescription(LEAN_MODEL)).toContain('fail')
    delete process.env.NOA_CLAUDE_WRITE_REQUIRE_READ
    expect(grepDescription(LEAN_MODEL)).toContain('output_mode')
    expect(getTodoWritePrompt(LEAN_MODEL)).toContain('in_progress')
    expect(
      renderPromptTemplate(
        LINE_FORMAT_INSTRUCTION,
        '',
        OFFSET_INSTRUCTION_TARGETED,
        LEAN_MODEL,
      ),
    ).toContain('absolute path')
  })
})

describe('Agent lean description', () => {
  // Upstream builds a "## When not to use" block into a local and then never
  // interpolates it into either return, so no real build emits it. The section
  // it does emit is "## When to use".
  test('carries upstream\'s When-to-use section, not the dead one', async () => {
    const lean = await agentPrompt([], false, undefined, LEAN_MODEL)

    expect(lean).toContain('## When to use\n\nA fresh agent costs more than it looks.')
    expect(lean).toContain("When in doubt, don't spawn.")
    expect(lean).not.toContain('## When not to use')
  })

  // Pro subscriptions and third-party providers share the do-not-spawn gate
  // (isAgentSpawnRestricted); the provider side is reachable from env alone.
  // The parallel nudges follow the session-latched subagent steer.
  const spawnSteer = async () => {
    resetSubagentSteerLatch()
    process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES = '1'
    const [delta] = getAgentListingDeltaAttachment({
      options: { tools: [{ name: 'Agent' }], agentDefinitions: { activeAgents: [EXPLORE_AGENT] }, mainLoopModel: FULL_MODEL },
      getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
    } as never, [])
    const full = await agentPrompt([], false, undefined, FULL_MODEL)
    return {
      note: full.includes('**Do not spawn agents unless the user asks.**'),
      parallelNudge: full.includes('run agents "in parallel", you MUST'),
      concurrencyNote: (delta as { showConcurrencyNote: boolean }).showConcurrencyNote,
    }
  }

  test('third-party providers get the do-not-spawn note and no parallel nudges', async () => {
    expect(await spawnSteer()).toEqual({ note: false, parallelNudge: true, concurrencyNote: true })
    process.env.ANTHROPIC_BASE_URL = 'https://api.kimi.com/coding'
    expect(await spawnSteer()).toEqual({ note: true, parallelNudge: false, concurrencyNote: false })
    delete process.env.ANTHROPIC_BASE_URL
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    expect(await spawnSteer()).toEqual({ note: true, parallelNudge: false, concurrencyNote: false })
  })

  test('subagent steer follows upstream: Opus 5 bundle drops the nudges, env wins', () => {
    const steer = (model: string) => (resetSubagentSteerLatch(), getSubagentSteer(model))
    expect(steer(FULL_MODEL)).toBe('default')
    expect(steer('claude-opus-5')).toBe('no_nudges')
    process.env.NOA_CLAUDE_SUBAGENT_STEER = 'counter_steer'
    try {
      expect(steer('claude-opus-5')).toBe('counter_steer')
    } finally {
      delete process.env.NOA_CLAUDE_SUBAGENT_STEER
    }
    // Latched for the session once a model is known: a later model does not flip it.
    resetSubagentSteerLatch()
    expect(getSubagentSteer(undefined)).toBe('default')
    expect(getSubagentSteer('claude-opus-5')).toBe('no_nudges')
    expect(getSubagentSteer(FULL_MODEL)).toBe('no_nudges')
    expect(getSessionSpecificGuidanceSection(new Set([AGENT_TOOL_NAME]), [], null, true, false, 'no_nudges'))
      .not.toContain('parallelizing independent queries')
    expect(getSessionSpecificGuidanceSection(new Set([AGENT_TOOL_NAME]), [], null, true, false, 'default'))
      .toContain('parallelizing independent queries')
  })

  test('the lean variant drops When-to-use under the note', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const lean = await agentPrompt([], false, undefined, LEAN_MODEL)
    expect(lean).toContain('**Do not spawn agents unless the user asks.**')
    expect(lean).not.toContain('## When to use')
  })

  test('lists Explore with its lean description only in the lean variant', async () => {
    const lean = await agentPrompt([EXPLORE_AGENT], false, undefined, LEAN_MODEL)
    const full = await agentPrompt([EXPLORE_AGENT], false, undefined, FULL_MODEL)
    expect(lean).toContain('- Explore: Read-only search agent for broad fan-out searches')
    expect(full).toContain('- Explore: Fast read-only search agent for locating code.')
  })

  test('the agent-listing attachment follows the same lean choice', () => {
    process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES = '1'
    const lines = (mainLoopModel: string) => {
      const [delta] = getAgentListingDeltaAttachment({
        options: { tools: [{ name: 'Agent' }], agentDefinitions: { activeAgents: [EXPLORE_AGENT] }, mainLoopModel },
        getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
      } as never, [])
      return (delta as { addedLines: string[] }).addedLines.join('\n')
    }
    expect(lines(LEAN_MODEL)).toContain('- Explore: Read-only search agent for broad fan-out searches')
    expect(lines(FULL_MODEL)).toContain('- Explore: Fast read-only search agent for locating code.')
  })

  test('falls back to the full description without a model', async () => {
    const full = await agentPrompt([], false, undefined, FULL_MODEL)
    expect(await agentPrompt([], false, undefined, undefined)).toBe(full)
    expect((await agentPrompt([], false, undefined, LEAN_MODEL)).length)
      .toBeLessThan(full.length)
  })
})
