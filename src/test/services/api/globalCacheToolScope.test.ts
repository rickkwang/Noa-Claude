import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../../../constants/prompts.js'
import type { Options } from '../../../services/api/claude.js'
import type { Tools } from '../../../Tool.js'
import { createUserMessage } from '../../../utils/messages.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'

// Query-suffix import: ptlFallback.test.ts replaces claude.js in bun's
// process-global module registry with a stubbed queryModelWithStreaming, and
// whichever file runs first wins. This asks for a fresh instance of the real
// module; both tests below exercise this instance, never the registry entry.
// Held in a variable because tsc can't resolve a suffixed specifier.
const REAL_CLAUDE_MODULE = '../../../services/api/claude.js?real-cache-wiring'
const { hasRenderingToolSchemas, queryModelWithStreaming } = (await import(
  REAL_CLAUDE_MODULE
)) as typeof import('../../../services/api/claude.js')

describe('global cache tool scope', () => {
  test('counts final server tools but ignores deferred schemas', () => {
    expect(hasRenderingToolSchemas([])).toBe(false)
    expect(
      hasRenderingToolSchemas([
        { type: 'web_search_20250305', name: 'web_search' },
      ]),
    ).toBe(true)
    expect(
      hasRenderingToolSchemas([
        { name: 'deferred', defer_loading: true, input_schema: { type: 'object' } },
      ]),
    ).toBe(false)
  })
})

// Wiring-level regression test: hasRenderingToolSchemas() alone staying green
// says nothing if queryModel stops feeding it the final tool list. Capture the
// actual request body and assert on the system blocks' cache scope.
describe('global cache request wiring', () => {
  const ENV_VARS = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'USER_TYPE',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
    'CLAUDE_CODE_TEST_FIXTURES_ROOT',
    'VCR_RECORD',
  ] as const
  const savedEnv = new Map<string, string | undefined>()
  let fixturesRoot: string
  let savedMacro: unknown

  beforeEach(() => {
    for (const key of ENV_VARS) savedEnv.set(key, process.env[key])
    // MACRO is a build-time --define global (build.ts) with no runtime module;
    // source-run tests must stub it before queryModel's logging paths touch it.
    // Scoped to these tests so the stub doesn't leak into other files sharing
    // this process.
    savedMacro = (globalThis as Record<string, unknown>).MACRO
    ;(globalThis as Record<string, unknown>).MACRO = {
      VERSION: '0.0.0-test',
      DISPLAY_VERSION: '0.0.0-test',
      BUILD_TIME: new Date().toISOString(),
      PACKAGE_URL: 'test',
      NATIVE_PACKAGE_URL: undefined,
      FEEDBACK_CHANNEL: 'github',
      ISSUES_EXPLAINER: '',
      VERSION_CHANGELOG: '',
    }
    // First-party direct API is what gates global cache scope.
    process.env.ANTHROPIC_API_KEY = 'test-key'
    // An env OAuth token has no refreshToken, so the pre-flight OAuth refresh
    // check no-ops without touching the keychain or the network.
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-token'
    process.env.USER_TYPE = 'external'
    // NODE_ENV=test (set by bun test) turns on VCR cassette replay. Point it at
    // a throwaway root in record mode: the cassette always misses, the "live"
    // call lands on the fake fetch below, and no fixture is written into the
    // repo. (VCR_RECORD also keeps CI from failing on the missing cassette.)
    fixturesRoot = mkdtempSync(join(tmpdir(), 'noa-vcr-'))
    process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixturesRoot
    process.env.VCR_RECORD = '1'
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  })

  afterEach(() => {
    for (const key of ENV_VARS) {
      const value = savedEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    savedEnv.clear()
    if (savedMacro === undefined)
      delete (globalThis as Record<string, unknown>).MACRO
    else (globalThis as Record<string, unknown>).MACRO = savedMacro
    rmSync(fixturesRoot, { recursive: true, force: true })
  })

  const SSE_RESPONSE = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
    '',
  ].join('\n')

  async function captureRequestBody(
    extraToolSchemas: Options['extraToolSchemas'],
  ): Promise<{
    system?: Array<{ cache_control?: { scope?: string } }>
    tools?: Array<{ type?: string }>
  }> {
    let capturedBody: string | undefined
    const fetchOverride = (async (_url: unknown, init?: { body?: unknown }) => {
      capturedBody = String(init?.body)
      return new Response(SSE_RESPONSE, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as NonNullable<Options['fetchOverride']>

    const options: Options = {
      getToolPermissionContext: async () => ({}) as never,
      model: 'claude-sonnet-4-5',
      isNonInteractiveSession: true,
      querySource: 'repl_main_thread',
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [] as unknown as Tools,
      fetchOverride,
      enablePromptCaching: true,
      maxOutputTokensOverride: 256,
      extraToolSchemas,
    }

    const generator = queryModelWithStreaming({
      messages: [createUserMessage({ content: 'hi' })],
      systemPrompt: asSystemPrompt([
        'static prompt block',
        SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
        'dynamic prompt block',
      ]),
      thinkingConfig: { type: 'disabled' },
      tools: [] as unknown as Tools,
      signal: new AbortController().signal,
      options,
    })
    for await (const _ of generator) {
      void _
    }

    expect(capturedBody).toBeDefined()
    return JSON.parse(capturedBody!)
  }

  test('server tools force org-scoped system blocks on the wire', async () => {
    const body = await captureRequestBody([
      { type: 'web_search_20250305', name: 'web_search' },
    ] as unknown as Options['extraToolSchemas'])

    expect(body.tools?.some(tool => tool.type === 'web_search_20250305')).toBe(
      true,
    )
    const scopes = (body.system ?? []).map(
      block => block.cache_control?.scope ?? null,
    )
    expect(scopes).not.toContain('global')
  })

  test('tool-less requests keep global scope on the static system block', async () => {
    const body = await captureRequestBody(undefined)

    const scopes = (body.system ?? []).map(
      block => block.cache_control?.scope ?? null,
    )
    expect(scopes).toContain('global')
  })
})
