import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getPromptCache1hEnvAllowlist,
  matchAllowlist,
  PROMPT_CACHE_1H_DEFAULT_SOURCES,
} from '../../utils/promptCache1hEnv.js'
import { getPromptCache1hDiagnostic } from '../../utils/promptCache1h.js'

const SAVED = { ...process.env }

beforeEach(() => {
  delete process.env.NOA_CLAUDE_PROMPT_CACHE_1H
  delete process.env.CLAUDE_CODE_PROMPT_CACHE_1H
  delete process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK
  delete process.env.DISABLE_PROMPT_CACHING
})

afterEach(() => {
  process.env = { ...SAVED }
})

describe('1h prompt-cache TTL env opt-in', () => {
  test('unset means unset — callers fall through to the existing path', () => {
    expect(getPromptCache1hEnvAllowlist()).toBeUndefined()
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '   '
    expect(getPromptCache1hEnvAllowlist()).toBeUndefined()
  })

  test('a bare truthy value covers only the human-paced sources', () => {
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '1'
    expect(getPromptCache1hEnvAllowlist()).toEqual(
      PROMPT_CACHE_1H_DEFAULT_SOURCES,
    )
    // Subagents run back-to-back inside a turn: a 1h write there is surcharge
    // on a read that would have hit the 5-minute entry anyway.
    expect(matchAllowlist('agent:general-purpose', PROMPT_CACHE_1H_DEFAULT_SOURCES)).toBe(false)
    expect(matchAllowlist('repl_main_thread', PROMPT_CACHE_1H_DEFAULT_SOURCES)).toBe(true)
    expect(matchAllowlist('repl_main_thread:explanatory', PROMPT_CACHE_1H_DEFAULT_SOURCES)).toBe(true)
    expect(matchAllowlist('sdk', PROMPT_CACHE_1H_DEFAULT_SOURCES)).toBe(true)
  })

  test('an explicit falsy value is a hard off, not a fall-through', () => {
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '0'
    expect(getPromptCache1hEnvAllowlist()).toEqual([])
  })

  test('a comma list is taken as query-source patterns', () => {
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = 'repl_main_thread*, agent:*'
    expect(getPromptCache1hEnvAllowlist()).toEqual([
      'repl_main_thread*',
      'agent:*',
    ])
  })

  test('the legacy CLAUDE_CODE_ name still works, NOA_CLAUDE_ wins', () => {
    process.env.CLAUDE_CODE_PROMPT_CACHE_1H = 'sdk'
    expect(getPromptCache1hEnvAllowlist()).toEqual(['sdk'])
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = 'repl_main_thread*'
    expect(getPromptCache1hEnvAllowlist()).toEqual(['repl_main_thread*'])
  })
})

describe('1h TTL diagnostic', () => {
  test('reports the env opt-in as the reason, bypassing eligibility', () => {
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '1'
    const d = getPromptCache1hDiagnostic('repl_main_thread')
    expect(d.enabled).toBe(true)
    expect(d.reason).toBe('enabled_env')
  })

  test('a source outside the opt-in list is an allowlist miss, not enabled', () => {
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '1'
    const d = getPromptCache1hDiagnostic('agent:explore')
    expect(d.enabled).toBe(false)
    expect(d.reason).toBe('allowlist_miss')
  })

  test('an explicit off outranks the Bedrock env var', () => {
    process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK = '1'
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '0'
    const d = getPromptCache1hDiagnostic('repl_main_thread')
    expect(d.enabled).toBe(false)
    expect(d.reason).toBe('disabled_env')
  })

  test('DISABLE_PROMPT_CACHING still wins over the opt-in', () => {
    process.env.DISABLE_PROMPT_CACHING = '1'
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '1'
    const d = getPromptCache1hDiagnostic('repl_main_thread')
    expect(d.enabled).toBe(false)
    expect(d.reason).toBe('prompt_caching_disabled')
  })
})
