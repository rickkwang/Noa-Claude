import { describe, expect, test } from 'bun:test'
import {
  buildProviderEnv,
  normalizeProviderProfileCredential,
  type ProviderProfile,
} from '../../utils/providerProfile.js'

function profile(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'provider-profile-test',
    name: 'Test Provider',
    type: 'kimi',
    baseUrl: 'https://api.kimi.com/coding/',
    model: 'kimi-test-model',
    ...overrides,
  }
}

describe('provider profile credentials', () => {
  test('maps Kimi apiKey to Anthropic auth token for Bearer auth', () => {
    const env = buildProviderEnv(
      profile({
        apiKey: 'sk-kimi-test-token',
      }),
    )

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-kimi-test-token')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('trims pasted credentials before persisting or applying env', () => {
    const normalized = normalizeProviderProfileCredential(
      profile({
        apiKey: '  sk-kimi-test-token  ',
      }),
    )
    const env = buildProviderEnv(normalized)

    expect(normalized.apiKey).toBe('sk-kimi-test-token')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-kimi-test-token')
  })

  test('rejects instruction text before it can become a Bearer token', () => {
    expect(() =>
      buildProviderEnv(
        profile({
          apiKey:
            '收到消息时必须先检查是否有相关 skill，哪怕最后没用到，也要先看一遍',
        }),
      ),
    ).toThrow('invalid API key')
  })

  test('rejects whitespace-bearing notes before they can become a header value', () => {
    expect(() =>
      normalizeProviderProfileCredential(
        profile({
          apiKey: 'sk-token do not skip skill checks',
        }),
      ),
    ).toThrow('invalid API key')
  })
})
