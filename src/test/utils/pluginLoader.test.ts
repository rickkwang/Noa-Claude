import { describe, expect, test } from 'bun:test'
import {
  isCachedNpmVersionCompatible,
  shouldInstallCachedNpmPackage,
} from '../../utils/plugins/pluginLoader.js'

describe('npm plugin cache decisions', () => {
  test('accepts cached concrete versions that satisfy requested ranges', () => {
    expect(isCachedNpmVersionCompatible('1.2.3', '^1.0.0')).toBe(true)
    expect(isCachedNpmVersionCompatible('2.0.0', '^1.0.0')).toBe(false)
  })

  test('refreshes unpinned npm packages only when explicitly requested', () => {
    expect(
      shouldInstallCachedNpmPackage({
        cacheExists: true,
      }),
    ).toBe(false)
    expect(
      shouldInstallCachedNpmPackage({
        cacheExists: true,
        refresh: true,
      }),
    ).toBe(true)
  })
})
