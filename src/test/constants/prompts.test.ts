import { describe, expect, test } from 'bun:test'
import {
  computeMainSessionEnvInfo,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from '../../constants/prompts.js'
import { getCLISyspromptPrefix } from '../../constants/system.js'
import { buildMemoryLines } from '../../memdir/memdir.js'
import { buildCombinedMemoryPrompt } from '../../memdir/teamMemPrompts.js'
import { getCompactPrompt } from '../../services/compact/prompt.js'
import { VERIFICATION_AGENT } from '../../tools/AgentTool/built-in/verificationAgent.js'
import { getEnterPlanModeToolPrompt } from '../../tools/EnterPlanModeTool/prompt.js'
import { getPrompt as getSkillToolPrompt } from '../../tools/SkillTool/prompt.js'
import { getWebSearchPrompt } from '../../tools/WebSearchTool/prompt.js'
import { splitSysPromptPrefix } from '../../utils/api.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

describe('system prompt provider neutrality', () => {
  test('environment info does not inject Claude model marketing', async () => {
    const envInfo = await computeMainSessionEnvInfo('gpt-4o')

    expect(envInfo).toContain('You are powered by the model gpt-4o.')
    expect(envInfo).toContain('Noa Claude is available as a CLI in the terminal.')
    expect(envInfo).not.toContain('The most recent Claude model family')
    expect(envInfo).not.toContain(
      'default to the latest and most capable Claude models',
    )
    expect(envInfo).not.toContain('Fast mode for Noa Claude uses')
  })
})

describe('CLI sysprompt prefix splitting', () => {
  test('keeps each prefix variant in a dedicated prompt block', () => {
    const promptBody = 'Prompt body'
    const variants = [
      getCLISyspromptPrefix({
        isNonInteractive: false,
        hasAppendSystemPrompt: false,
      }),
      getCLISyspromptPrefix({
        isNonInteractive: true,
        hasAppendSystemPrompt: true,
      }),
      getCLISyspromptPrefix({
        isNonInteractive: true,
        hasAppendSystemPrompt: false,
      }),
    ]

    for (const prefix of variants) {
      const blocks = splitSysPromptPrefix(
        asSystemPrompt([prefix, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, promptBody]),
      )

      expect(blocks.some(block => block.text === prefix)).toBe(true)
      expect(blocks.some(block => block.text === promptBody)).toBe(true)
    }
  })
})

describe('prompt behavior contracts', () => {
  test('plan mode is reserved for material ambiguity instead of routine implementation', () => {
    const prompt = getEnterPlanModeToolPrompt()

    expect(prompt).toContain(
      'Skip plan mode when you can reasonably infer the right approach',
    )
    expect(prompt).toContain('just get started')
    expect(prompt).toContain('prefer starting work')
    expect(prompt).not.toContain('Prefer using EnterPlanMode')
    expect(prompt).not.toContain('err on the side of planning')
  })

  test('skill invocation preserves explicit commands without making broad matches blocking', async () => {
    const prompt = await getSkillToolPrompt('/tmp')

    expect(prompt).toContain(
      'If the user explicitly names a skill or uses /<skill-name>, invoking that skill is required',
    )
    expect(prompt).toContain(
      'Do not treat broad or ambiguous skill matches as a blocking requirement',
    )
    expect(prompt).not.toContain('this is a BLOCKING REQUIREMENT')
  })

  test('web search cites material sources without forcing noisy source sections or query years', () => {
    const prompt = getWebSearchPrompt()

    expect(prompt).toContain('When web results materially support your answer')
    expect(prompt).toContain('a separate Sources section is optional')
    expect(prompt).toContain('Do not force the current year')
    expect(prompt).not.toContain('This is MANDATORY')
    expect(prompt).not.toContain('MUST include a "Sources:" section')
  })

  test('compact summaries optimize continuation quality without reproducing transcripts', () => {
    const prompt = getCompactPrompt()

    expect(prompt).toContain('detailed continuation summary')
    expect(prompt).toContain('do not turn the summary into a full transcript')
    expect(prompt).toContain(
      'Do not reproduce all user messages, long file contents, or full code snippets',
    )
    expect(prompt).toContain(
      'Include file reads only when exact text is necessary to preserve meaning',
    )
    expect(prompt).not.toContain('Include file reads verbatim')
    expect(prompt).not.toContain('List ALL user messages')
  })

  test('incremental compact prompt updates an existing checkpoint summary', () => {
    const prompt = getCompactPrompt(undefined, {
      previousSummary: 'Summary:\n- Existing checkpoint',
    })

    expect(prompt).toContain('update an existing continuation summary')
    expect(prompt).toContain('Existing checkpoint summary to update')
    expect(prompt).toContain('Summary:\n- Existing checkpoint')
    expect(prompt).toContain('Treat the existing checkpoint summary as the authoritative record of earlier history')
  })

  test('memory prompt defaults away from saving transient or speculative context', () => {
    const prompt = buildMemoryLines('Memory', '/tmp/noa-memory').join('\n')

    expect(prompt).toContain('Default to not saving memory')
    expect(prompt).toContain('likely to matter in future conversations')
    expect(prompt).toContain(
      'Do not save transient tasks, speculative inferences, or details that are likely to change soon',
    )
  })

  test('combined team memory prompt uses the same conservative save default', () => {
    const prompt = buildCombinedMemoryPrompt()

    expect(prompt).toContain('Default to not saving memory')
    expect(prompt).toContain('likely to matter in future conversations')
    expect(prompt).toContain(
      'Do not save transient tasks, speculative inferences, or details that are likely to change soon',
    )
  })

  test('verification agent contract prevents substituting implementer confidence', () => {
    expect(VERIFICATION_AGENT.whenToUse).toContain(
      'Also use it for smaller changes when the work is risky',
    )
    expect(VERIFICATION_AGENT.whenToUse).toContain(
      'the implementer should not substitute its own confidence for this verdict',
    )
    expect((VERIFICATION_AGENT.getSystemPrompt as () => string)()).toContain(
      'PARTIAL is for environmental limitations only',
    )
  })
})
