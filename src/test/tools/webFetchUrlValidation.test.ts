import { describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import {
  clearWebFetchCache,
  getURLMarkdownContent,
  validateURL,
} from '../../tools/WebFetchTool/utils.js'

// validateURL is WebFetch's synchronous gate against malformed URLs and
// private/local addresses. Removing the isLocalOrPrivateUrl call from
// validateURL should fail here loudly rather than silently.

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

describe('getURLMarkdownContent — no Anthropic domain_info preflight', () => {
  test('fetches target URL directly without calling api.anthropic.com', async () => {
    clearWebFetchCache()
    const requestedUrls: string[] = []
    const spy = spyOn(axios, 'get').mockImplementation((async (url: string) => {
      requestedUrls.push(url)
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        data: Buffer.from('hello world'),
      } as any
    }) as any)

    try {
      const result = await getURLMarkdownContent(
        'http://example.com/test',
        new AbortController(),
      )
      expect(requestedUrls).toEqual(['https://example.com/test'])
      expect('content' in result && result.content).toBe('hello world')
    } finally {
      spy.mockRestore()
      clearWebFetchCache()
    }
  })
})
