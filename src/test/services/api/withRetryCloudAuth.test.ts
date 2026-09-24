import Anthropic, { APIConnectionError } from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { formatAPIError } from '../../../services/api/errorUtils.js'
import { withRetry } from '../../../services/api/withRetry.js'

// vertex-sdk and bedrock-sdk wrap credential failures in an APIConnectionError
// whose `cause` is the original error. withRetry must still see them as cloud
// auth errors, which rebuild the client (fresh credentials) before retrying;
// a plain connection error retries on the same client.

const ENV_KEYS = ['CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_BEDROCK'] as const
const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

function wrapped(cause?: Error) {
  return new APIConnectionError({ message: 'Failed to acquire credentials.', cause })
}

/** Fails once with `error`, then succeeds; returns how many clients were built. */
async function clientsBuiltAfterOneFailure(error: unknown): Promise<number> {
  let built = 0
  let attempts = 0
  const gen = withRetry(
    async () => {
      built++
      return {} as Anthropic
    },
    async () => {
      if (attempts++ === 0) throw error
      return 'ok'
    },
    { maxRetries: 1, model: 'claude-opus-4-8', thinkingConfig: { type: 'disabled' } },
  )
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  expect(step.value).toBe('ok')
  return built
}

describe('withRetry cloud credential errors wrapped by the provider SDKs', () => {
  test('plain connection error keeps the client (control)', async () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(await clientsBuiltAfterOneFailure(wrapped())).toBe(1)
  })

  test('Vertex: wrapped google-auth-library error rebuilds the client', async () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    const cause = new Error(
      'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.',
    )
    expect(await clientsBuiltAfterOneFailure(wrapped(cause))).toBe(2)
  })

  test('Bedrock: wrapped CredentialsProviderError rebuilds the client', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const cause = Object.assign(new Error('Could not load credentials from any providers'), {
      name: 'CredentialsProviderError',
    })
    expect(await clientsBuiltAfterOneFailure(wrapped(cause))).toBe(2)
  })
})

describe('formatAPIError for wrapped cloud credential errors', () => {
  test('surfaces the underlying reason', () => {
    const cause = new Error(
      'Unable to read the credential file specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable.',
    )
    const error = new APIConnectionError({
      message: 'Failed to acquire Google OAuth credentials.',
      cause,
    })
    expect(formatAPIError(error)).toBe(
      'Failed to acquire Google OAuth credentials. Unable to read the credential file specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable.',
    )
  })

  test('leaves the generic connection error unchanged', () => {
    const error = new APIConnectionError({ cause: new TypeError('fetch failed') })
    expect(formatAPIError(error)).toBe(
      'Unable to connect to API. Check your internet connection',
    )
  })
})

