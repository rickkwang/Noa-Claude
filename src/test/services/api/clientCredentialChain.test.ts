import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getAnthropicClient,
  NoaAnthropic,
} from '../../../services/api/client.js'

// With no apiKey/authToken the SDK falls back to a local credential chain
// (ant-CLI profiles, ANTHROPIC_PROFILE, Workload Identity Federation env vars).
// WIF is the easiest link to observe: it exchanges a token at /v1/oauth/token
// and then sends it as a Bearer header.
const WIF_ENV = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
  ANTHROPIC_ORGANIZATION_ID: 'org_test',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
  ANTHROPIC_IDENTITY_TOKEN: 'jwt_test',
}

const ENV_KEYS = [
  ...Object.keys(WIF_ENV),
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLOUD_ML_REGION',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, WIF_ENV)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

function recordingFetch() {
  const calls: { url: string; auth: string | null }[] = []
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(url),
      auth: headers.get('authorization') ?? headers.get('x-api-key'),
    })
    return new Response(
      JSON.stringify({
        access_token: 'wif_token',
        token_type: 'Bearer',
        expires_in: 3600,
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  return { calls, fetch }
}

const request = {
  model: 'test',
  max_tokens: 1,
  messages: [{ role: 'user' as const, content: 'hi' }],
}

describe('SDK default credential chain', () => {
  test('plain SDK client picks up WIF env credentials (control)', async () => {
    // If this stops holding, the SDK renamed or dropped the hook NoaAnthropic
    // overrides, and the tests below would pass vacuously.
    const { calls, fetch } = recordingFetch()
    const client = new Anthropic({
      apiKey: null,
      authToken: null,
      baseURL: 'http://127.0.0.1:9',
      maxRetries: 0,
      fetch,
    })
    await client.messages.create(request)
    expect(calls.map(c => new URL(c.url).pathname)).toEqual([
      '/v1/oauth/token',
      '/v1/messages',
    ])
    expect(calls[1]!.auth).toBe('Bearer wif_token')
  })

  test('NoaAnthropic never resolves local credentials', async () => {
    const { calls, fetch } = recordingFetch()
    const client = new NoaAnthropic({
      apiKey: null,
      authToken: null,
      baseURL: 'http://127.0.0.1:9',
      maxRetries: 0,
      fetch,
    })
    // APIPromise is lazy, so await it directly rather than via expect().rejects.
    let error: unknown
    try {
      await client.messages.create(request)
    } catch (e) {
      error = e
    }
    expect(String(error)).toContain('Could not resolve authentication method')
    expect(calls).toEqual([])
  })

  test('getAnthropicClient builds the Anthropic-API client as NoaAnthropic', async () => {
    // Non-interactive sessions require the key in the environment.
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const client = await getAnthropicClient({ maxRetries: 0 })
    expect(client).toBeInstanceOf(NoaAnthropic)
  })

  // Foundry sends its own auth headers, so local credentials never reach it;
  // the skip-auth token must also be non-empty or the Foundry SDK throws.
  test('Foundry skip-auth sends its placeholder token, not local credentials', async () => {
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH = '1'
    process.env.ANTHROPIC_FOUNDRY_BASE_URL = 'http://127.0.0.1:9'
    const { calls, fetch } = recordingFetch()
    const client = await getAnthropicClient({
      maxRetries: 0,
      fetchOverride: fetch,
    })
    await client.messages.create(request)
    expect(calls.some(c => c.url.includes('/oauth/token'))).toBe(false)
    expect(calls.map(c => c.auth)).toEqual(['Bearer skip-foundry-auth'])
  })
})

describe('provider skip-auth mocks', () => {
  test('Vertex skip-auth mock satisfies the SDK auth-header contract', async () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH = '1'
    process.env.ANTHROPIC_VERTEX_PROJECT_ID = 'test-project'
    process.env.CLOUD_ML_REGION = 'us-east5'
    process.env.ANTHROPIC_VERTEX_BASE_URL = 'http://127.0.0.1:9'
    const { calls, fetch } = recordingFetch()
    const client = await getAnthropicClient({
      maxRetries: 0,
      model: 'claude-opus-4-8',
      fetchOverride: fetch,
    })
    await client.messages.create(request)
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]!.url).pathname).toContain('/projects/test-project/')
    expect(calls[0]!.auth).toBeNull()
  })
})
