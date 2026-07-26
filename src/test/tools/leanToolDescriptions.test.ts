import { describe, expect, test } from 'bun:test'

// Read's description resolves PDF support, which walks through model defaults
// into auth. Tests here are self-contained (no preload), so seed a key first.
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'

import { getDescription as globDescription } from '../../tools/GlobTool/prompt.js'
import { getDescription as grepDescription } from '../../tools/GrepTool/prompt.js'
import { getWriteToolDescription } from '../../tools/FileWriteTool/prompt.js'
import { getEditToolDescription } from '../../tools/FileEditTool/prompt.js'
import { getWebSearchPrompt } from '../../tools/WebSearchTool/prompt.js'
import { getTodoWritePrompt } from '../../tools/TodoWriteTool/prompt.js'
import { getPrompt as agentPrompt } from '../../tools/AgentTool/prompt.js'
import {
  LINE_FORMAT_INSTRUCTION,
  OFFSET_INSTRUCTION_TARGETED,
  renderPromptTemplate,
} from '../../tools/FileReadTool/prompt.js'

const LEAN_MODEL = 'claude-opus-5'
const FULL_MODEL = 'claude-sonnet-5'

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
      expect(render(undefined)).toBe(render(FULL_MODEL))
    },
  )

  test('lean variants keep the behaviour-defining facts', () => {
    // Each of these changes what the model is allowed or expected to do, so
    // they must survive trimming.
    expect(getEditToolDescription(LEAN_MODEL)).toContain('Read')
    expect(getWriteToolDescription(LEAN_MODEL)).toContain('fail')
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

    expect(lean).toContain('## When to use\nReach for this when the task matches an available agent type')
    expect(lean).toContain(
      "For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself — wait for the result.",
    )
    expect(lean).not.toContain('## When not to use')
  })

  test('falls back to the full description without a model', async () => {
    const full = await agentPrompt([], false, undefined, FULL_MODEL)
    expect(await agentPrompt([], false, undefined, undefined)).toBe(full)
    expect((await agentPrompt([], false, undefined, LEAN_MODEL)).length)
      .toBeLessThan(full.length)
  })
})
