import { afterAll, describe, expect, test } from 'bun:test'
import * as nodeFs from 'fs'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  findNetworkPathViaSymlinks,
  getPathsForPermissionCheck,
  NodeFsOperations,
  reachesNetworkPath,
  safeResolvePath,
} from '../../utils/fsOperations.js'

// realpath so the fixture's own ancestors (/var -> /private/var) are real.
const root = nodeFs.realpathSync(mkdtempSync(join(tmpdir(), 'netlink-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

mkdirSync(join(root, 'real'))
writeFileSync(join(root, 'real', 'f.txt'), 'x')
symlinkSync('/.vol/16777234/2', join(root, 'vol-file'))
symlinkSync('/.vol/16777234', join(root, 'vol-dir'))
symlinkSync('vol-file', join(root, 'hop'))
symlinkSync('../real', join(root, 'real', 'up'))
symlinkSync('//server/share', join(root, 'unc'))
symlinkSync('real', join(root, 'local'))

// Only lstat and readlink are allowed: anything that follows a link fails.
const noFollowFs = new Proxy(NodeFsOperations, {
  get(target, prop, receiver) {
    if (prop === 'lstatSync' || prop === 'readlinkSync') {
      return Reflect.get(target, prop, receiver)
    }
    throw new Error(`fs.${String(prop)} called`)
  },
})

describe('findNetworkPathViaSymlinks', () => {
  test('finds a file link, a directory link and a relative hop into /.vol', () => {
    expect(findNetworkPathViaSymlinks(noFollowFs, join(root, 'vol-file'))).toBe(
      '/.vol/16777234/2',
    )
    expect(
      findNetworkPathViaSymlinks(noFollowFs, join(root, 'vol-dir', 'x', 'y')),
    ).toBe('/.vol/16777234')
    expect(findNetworkPathViaSymlinks(noFollowFs, join(root, 'hop'))).toBe(
      '/.vol/16777234/2',
    )
  })

  test('finds a link to a UNC path', () => {
    expect(findNetworkPathViaSymlinks(noFollowFs, join(root, 'unc', 'f'))).toBe(
      '//server/share',
    )
  })

  test('leaves local links and missing paths alone', () => {
    for (const p of [
      join(root, 'local', 'f.txt'),
      join(root, 'real', 'up', 'f.txt'),
      join(root, 'missing', 'x'),
    ]) {
      expect(findNetworkPathViaSymlinks(noFollowFs, p)).toBeUndefined()
    }
  })
})

describe('permission-path resolution never follows a link into /.vol', () => {
  test('safeResolvePath reports the network target without realpath', () => {
    expect(safeResolvePath(noFollowFs, join(root, 'vol-dir', 'f'))).toEqual({
      resolvedPath: '/.vol/16777234',
      isSymlink: true,
      isCanonical: false,
    })
  })

  test('getPathsForPermissionCheck includes the network target', () => {
    const p = join(root, 'hop')
    expect(getPathsForPermissionCheck(p)).toEqual([p, '/.vol/16777234/2'])
  })

  test('reachesNetworkPath', () => {
    expect(reachesNetworkPath(join(root, 'vol-file'))).toBe(true)
    expect(reachesNetworkPath(join(root, 'local', 'f.txt'))).toBe(false)
  })
})

describe('automount paths through links', () => {
  test('a link into /net/<host> is found without looking the host up', () => {
    const link = join(root, 'nfs')
    symlinkSync('/net/fileserver/export', link)
    expect(findNetworkPathViaSymlinks(noFollowFs, join(link, 'f'))).toBe(
      '/net/fileserver/export',
    )
  })
})
