import { afterEach, describe, expect, test } from 'bun:test'

const FAKE_CHANGELOG = `# Release Notes

## 1.0.6

### Bug Fixes

- Fixed release notes panel sometimes not appearing after upgrade.

## 1.0.5

### Bug Fixes

- Fixed an older issue.
`

;(globalThis as { MACRO?: Record<string, unknown> }).MACRO ??= {
  VERSION: '1.0.6',
  DISPLAY_VERSION: '1.0.6',
  BUILD_TIME: '',
  PACKAGE_URL: '',
  VERSION_CHANGELOG: FAKE_CHANGELOG,
}

const {
  _resetChangelogCacheForTesting,
  checkForReleaseNotesSync,
  getStoredChangelogFromMemory,
} = await import('../../utils/releaseNotes.js')

afterEach(() => {
  _resetChangelogCacheForTesting()
})

describe('getStoredChangelogFromMemory', () => {
  test('falls back to bundled changelog when async cache has not been seeded', () => {
    const result = getStoredChangelogFromMemory()
    expect(result).toContain('## 1.0.6')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('checkForReleaseNotesSync', () => {
  test('reports release notes for a fresh user before async cache loads', () => {
    const { hasReleaseNotes, releaseNotes } = checkForReleaseNotesSync(undefined)

    expect(hasReleaseNotes).toBe(true)
    expect(releaseNotes.length).toBeGreaterThan(0)
  })

  test('reports no release notes when the user has already seen the current version', () => {
    const { hasReleaseNotes } = checkForReleaseNotesSync('1.0.6')

    expect(hasReleaseNotes).toBe(false)
  })
})
