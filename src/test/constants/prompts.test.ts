import { describe, expect, test } from 'bun:test'
import {
  computeMainSessionEnvInfo,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from '../../constants/prompts.js'
import { getCLISyspromptPrefix } from '../../constants/system.js'
import { splitSysPromptPrefix } from '../../utils/api.js'

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
      const blocks = splitSysPromptPrefix([
        prefix,
        SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
        promptBody,
      ])

      expect(blocks.some(block => block.text === prefix)).toBe(true)
      expect(blocks.some(block => block.text === promptBody)).toBe(true)
    }
  })
})
