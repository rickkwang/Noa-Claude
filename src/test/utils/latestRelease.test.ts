import { afterEach, describe, expect, test } from 'bun:test'
import {
  fetchLatestReleaseTag,
  hasExplicitInstallSource,
  isCurrentVersionAtLeast,
  parseLatestTagName,
  stripTagPrefix,
} from 'src/utils/latestRelease.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, json: async () => payload } as Response
}

describe('parseLatestTagName', () => {
  test('returns the semver max, not the first entry by API order', () => {
    expect(
      parseLatestTagName([
        { tag_name: 'v1.9.2' },
        { tag_name: 'v1.10.0' },
        { tag_name: 'v1.9.1' },
      ]),
    ).toBe('v1.10.0')
  })

  test('skips non-release tags instead of trusting them', () => {
    expect(
      parseLatestTagName([{ tag_name: 'nightly' }, { tag_name: 'v1.10.0' }]),
    ).toBe('v1.10.0')
  })

  test('excludes prerelease-shaped tags even when they sort newer', () => {
    expect(
      parseLatestTagName([
        { tag_name: 'v1.11.0-rc.1' },
        { tag_name: 'v1.10.0' },
      ]),
    ).toBe('v1.10.0')
  })

  test('excludes releases flagged prerelease despite a strict semver tag', () => {
    expect(
      parseLatestTagName([
        { tag_name: 'v1.11.0', prerelease: true },
        { tag_name: 'v1.10.0' },
      ]),
    ).toBe('v1.10.0')
  })

  test('excludes draft releases', () => {
    expect(
      parseLatestTagName([
        { tag_name: 'v1.11.0', draft: true },
        { tag_name: 'v1.10.0' },
      ]),
    ).toBe('v1.10.0')
  })

  test('reads tag_name only, never the release title', () => {
    expect(
      parseLatestTagName([{ name: 'v9.9.9', tag_name: 'v1.10.0' }]),
    ).toBe('v1.10.0')
  })

  test('requires the canonical v prefix and avoids equivalent-tag ambiguity', () => {
    expect(
      parseLatestTagName([
        { tag_name: '1.10.0' },
        { tag_name: 'v1.10.0' },
      ]),
    ).toBe('v1.10.0')
  })

  test('returns null when no entry looks like a release tag', () => {
    expect(
      parseLatestTagName([
        { tag_name: 'nightly' },
        { tag_name: 'v2.0.0-beta' },
        {},
      ]),
    ).toBeNull()
  })

  test('returns null for non-array payloads', () => {
    expect(parseLatestTagName(null)).toBeNull()
    expect(parseLatestTagName({ tag_name: 'v1.10.0' })).toBeNull()
    expect(parseLatestTagName('v1.10.0')).toBeNull()
  })

  test('ignores non-string tag_name fields', () => {
    expect(
      parseLatestTagName([
        { tag_name: 123 },
        { tag_name: null },
        { tag_name: 'v2.0.0' },
      ]),
    ).toBe('v2.0.0')
  })
})

describe('stripTagPrefix', () => {
  test('strips a leading v', () => {
    expect(stripTagPrefix('v1.10.0')).toBe('1.10.0')
  })

  test('leaves bare versions untouched', () => {
    expect(stripTagPrefix('1.10.0')).toBe('1.10.0')
  })
})

describe('hasExplicitInstallSource', () => {
  test('detects every installer source override', () => {
    expect(hasExplicitInstallSource({ NOA_INSTALL_REF: 'v1.9.0' })).toBeTrue()
    expect(
      hasExplicitInstallSource({
        NOA_INSTALL_REPO_TARBALL_URL: 'https://example.com/noa.tar.gz',
      }),
    ).toBeTrue()
    expect(
      hasExplicitInstallSource({ NOA_INSTALL_SOURCE_DIR: '/tmp/noa-source' }),
    ).toBeTrue()
  })

  test('ignores absent and empty overrides', () => {
    expect(hasExplicitInstallSource({})).toBeFalse()
    expect(hasExplicitInstallSource({ NOA_INSTALL_REF: '' })).toBeFalse()
  })
})

describe('isCurrentVersionAtLeast', () => {
  test('compares release and development versions', () => {
    expect(isCurrentVersionAtLeast('1.10.0', 'v1.10.0')).toBeTrue()
    expect(isCurrentVersionAtLeast('1.10.0-dev.1', 'v1.10.0')).toBeFalse()
  })

  test('returns null for a version the comparator rejects', () => {
    expect(isCurrentVersionAtLeast('1.10.0.1', 'v1.10.0')).toBeNull()
  })
})

describe('fetchLatestReleaseTag', () => {
  test('follows pagination before selecting the semver max', async () => {
    const firstPage = Array.from({ length: 100 }, (_, patch) => ({
      tag_name: `v1.0.${patch}`,
    }))
    const urls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input))
      return jsonResponse(urls.length === 1 ? firstPage : [{ tag_name: 'v2.0.0' }])
    }) as unknown as typeof fetch

    expect(await fetchLatestReleaseTag()).toBe('v2.0.0')
    expect(urls).toEqual([
      'https://api.github.com/repos/rickkwang/Noa-Claude/releases?per_page=100&page=1',
      'https://api.github.com/repos/rickkwang/Noa-Claude/releases?per_page=100&page=2',
    ])
  })

  test('returns null instead of trusting a partial result when a later page fails', async () => {
    const firstPage = Array.from({ length: 100 }, () => ({
      tag_name: 'v1.10.0',
    }))
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return calls === 1 ? jsonResponse(firstPage) : jsonResponse(null, false)
    }) as unknown as typeof fetch

    expect(await fetchLatestReleaseTag()).toBeNull()
    expect(calls).toBe(2)
  })
})
