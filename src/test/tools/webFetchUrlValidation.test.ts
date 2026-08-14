import { describe, expect, test } from 'bun:test'
import { validateURL } from '../../tools/WebFetchTool/utils.js'

// validateURL is WebFetch's only synchronous gate. The domain blocklist
// preflight that also catches private addresses is a network round-trip and
// can be turned off via settings.skipWebFetchPreflight, so these assertions
// are what stands between the tool and a private-range request in that
// configuration. Removing the isLocalOrPrivateUrl call from validateURL
// should fail here loudly rather than silently.

describe('validateURL — private and local addresses', () => {
  test.each([
    ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP link-local metadata'],
    ['http://100.100.100.200/latest/meta-data/', 'Alibaba metadata (CGNAT)'],
    ['http://10.0.0.1/admin', 'RFC1918 10/8'],
    ['http://192.168.1.1/', 'RFC1918 192.168/16'],
    ['http://172.16.0.5/', 'RFC1918 172.16/12'],
    ['http://127.0.0.1:3000/', 'loopback'],
    ['http://0.0.0.0:8080/', 'this-network'],
    ['http://[fd00::1]/', 'IPv6 unique local'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://printer.local/', 'mDNS .local'],
  ])('rejects %s (%s)', url => {
    expect(validateURL(url)).toBe(false)
  })
})

describe('validateURL — public addresses stay reachable', () => {
  test.each([
    ['https://example.com/'],
    ['https://docs.anthropic.com/en/docs'],
    ['https://sub.domain.co.uk/path?q=1'],
    // Public literal IPs must not be caught by the private-range check.
    ['https://8.8.8.8/'],
    ['https://1.1.1.1/'],
  ])('allows %s', url => {
    expect(validateURL(url)).toBe(true)
  })
})

describe('validateURL — pre-existing rules still hold', () => {
  test('rejects embedded credentials', () => {
    expect(validateURL('https://user:pass@example.com/')).toBe(false)
  })

  test('rejects a hostname with no dot', () => {
    expect(validateURL('https://localhost/')).toBe(false)
  })

  test('rejects an unparseable URL', () => {
    expect(validateURL('not a url')).toBe(false)
  })
})
