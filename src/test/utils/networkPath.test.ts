import { describe, expect, test } from 'bun:test'
import { safeResolvePath } from '../../utils/fsOperations.js'
import { isNetworkPath } from '../../utils/networkPath.js'

describe('isNetworkPath', () => {
  test('flags UNC paths in both separator styles', () => {
    expect(isNetworkPath('\\\\server\\share\\f.txt')).toBe(true)
    expect(isNetworkPath('//server/share/f.txt')).toBe(true)
  })

  test('flags macOS resolution prefixes, case-insensitively', () => {
    for (const p of [
      '/.vol/16777234/2',
      '/.vol',
      '/.nofollow/Volumes/share/f.pdf',
      '/.resolve/1/Volumes/share',
      '/.file/id=6571367.2',
      '/.VOL/1/2',
      '/.NoFollow/x',
    ]) {
      expect(isNetworkPath(p)).toBe(true)
    }
  })

  test('judges the normalized path, so dot segments cannot hide a prefix', () => {
    for (const p of ['/./.vol/1/2', '/tmp/../.vol/1/2', '/a/b/../../.file/x']) {
      expect(isNetworkPath(p)).toBe(true)
    }
    // Decided as soon as the first segment is a redirect prefix: the kernel
    // looks up /.vol itself before it can apply the `..`.
    expect(isNetworkPath('/.vol/../tmp/x')).toBe(true)
    expect(isNetworkPath('/tmp/.vol/../x')).toBe(false)
  })

  test('leaves ordinary paths alone', () => {
    for (const p of [
      '/Users/me/.vol/f',
      '/.volume/f',
      '/.nofollowing',
      '/.resolved/x',
      '/tmp/a.pdf',
      'relative/.vol',
    ]) {
      expect(isNetworkPath(p)).toBe(false)
    }
  })
})

describe('safeResolvePath', () => {
  test('never touches the filesystem for a network path', () => {
    const untouchable = new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(`fs.${String(prop)} called`)
        },
      },
    )
    for (const p of ['/.vol/1/2', '/.nofollow/x', '/.resolve/1/x', '//h/s']) {
      expect(safeResolvePath(untouchable as never, p)).toEqual({
        resolvedPath: p,
        isSymlink: false,
        isCanonical: false,
      })
    }
  })
})
