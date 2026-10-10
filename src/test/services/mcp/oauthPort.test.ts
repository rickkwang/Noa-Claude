import { afterEach, describe, expect, test } from 'bun:test'
import { buildRedirectUri } from '../../../services/mcp/oauthPort.js'

const ENV_KEY = 'MCP_OAUTH_REDIRECT_HOST'

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('buildRedirectUri', () => {
  // Pins the default to localhost. The 127.0.0.1 change broke pre-registered
  // OAuth clients (Slack) and was reverted, so it must not come back.
  // See REDIRECT_HOST.
  test('defaults to localhost, matching upstream', () => {
    expect(buildRedirectUri(51004)).toBe('http://localhost:51004/callback')
  })

  test('opts into the IPv4 loopback literal for strict authorization servers', () => {
    process.env[ENV_KEY] = '127.0.0.1'
    expect(buildRedirectUri(51004)).toBe('http://127.0.0.1:51004/callback')
  })

  // The callback server binds 127.0.0.1 only, so advertising ::1 would be a
  // guaranteed connection refused — never offer a host we don't listen on.
  test('rejects the IPv6 loopback literal, which nothing listens on', () => {
    process.env[ENV_KEY] = '[::1]'
    expect(buildRedirectUri(51004)).toBe('http://localhost:51004/callback')
  })

  test('ignores a non-loopback override rather than leaking the auth code', () => {
    process.env[ENV_KEY] = 'attacker.example.com'
    expect(buildRedirectUri(51004)).toBe('http://localhost:51004/callback')
  })

})
