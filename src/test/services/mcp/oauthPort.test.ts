import { afterEach, describe, expect, test } from 'bun:test'
import { buildRedirectUri } from '../../../services/mcp/oauthPort.js'

const ENV_KEY = 'MCP_OAUTH_REDIRECT_HOST'

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('buildRedirectUri', () => {
  // Upstream shipped 127.0.0.1 in 2.1.229 and reverted to localhost in 2.1.231
  // after it broke pre-registered OAuth clients (Slack). This pins the default
  // so the reverted change doesn't get reintroduced. See REDIRECT_HOST.
  test('defaults to localhost, matching upstream 2.1.231', () => {
    expect(buildRedirectUri(51004)).toBe('http://localhost:51004/callback')
  })

  test('falls back to the default port when none is given', () => {
    expect(buildRedirectUri()).toBe('http://localhost:3118/callback')
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

  test('ignores an empty override', () => {
    process.env[ENV_KEY] = ''
    expect(buildRedirectUri(51004)).toBe('http://localhost:51004/callback')
  })
})
