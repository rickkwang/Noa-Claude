import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCwdState,
  getOriginalCwd,
  setCwdState,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { GlobTool } from '../../../tools/GlobTool/GlobTool.js'
import { checkReadPermissionForTool } from '../../../utils/permissions/filesystem.js'

;(globalThis as { MACRO?: unknown }).MACRO ??= { VERSION: 'test' }

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'net-perm-')))
const prev = { original: getOriginalCwd(), cwd: getCwdState() }

beforeAll(() => {
  writeFileSync(join(dir, 'ok.txt'), 'x')
  symlinkSync('/.vol/16777234/2', join(dir, 'vol-link.txt'))
  symlinkSync('/net/fileserver/export', join(dir, 'nfs'))
  setOriginalCwd(dir)
  setCwdState(dir)
})

afterAll(() => {
  setOriginalCwd(prev.original)
  setCwdState(prev.cwd)
  rmSync(dir, { recursive: true, force: true })
})

const read = { name: 'Read', getPath: (i: { file_path: string }) => i.file_path }
const glob = GlobTool

function decide(tool: object, input: object, ctx = getEmptyToolPermissionContext()) {
  const r = checkReadPermissionForTool(tool as never, input as never, ctx)
  return {
    behavior: r.behavior,
    reason: (r as { decisionReason?: { reason?: string } }).decisionReason
      ?.reason,
  }
}

describe('read permission for network paths inside the working directory', () => {
  test('an ordinary file is still allowed', () => {
    expect(decide(read, { file_path: join(dir, 'ok.txt') }).behavior).toBe(
      'allow',
    )
  })

  test('a symlink into /.vol asks', () => {
    expect(decide(read, { file_path: join(dir, 'vol-link.txt') })).toEqual({
      behavior: 'ask',
      reason:
        'Kernel-resolved path prefix (/.vol etc.) detected (defense-in-depth check)',
    })
  })

  test('a symlink into /net/<host> asks', () => {
    expect(decide(read, { file_path: join(dir, 'nfs', 'f') })).toEqual({
      behavior: 'ask',
      reason: 'Automount -hosts path detected (defense-in-depth check)',
    })
  })
})

describe('deny rules still win over the network-path ask', () => {
  test('a deny on the real location applies through the symlink', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { userSettings: ['Read(//net/fileserver/export/secret/**)'] },
    }
    expect(
      decide(read, { file_path: join(dir, 'nfs', 'secret', 'k') }, ctx as never)
        .behavior,
    ).toBe('deny')
    expect(
      decide(read, { file_path: join(dir, 'nfs', 'public', 'k') }, ctx as never)
        .behavior,
    ).toBe('ask')
  })
})

describe('Glob absolute patterns are checked against their search directory', () => {
  test('outside the working directory asks', () => {
    expect(decide(glob, { pattern: '/etc/host*' }).behavior).toBe('ask')
    expect(decide(glob, { pattern: join(tmpdir(), '*.txt') }).behavior).toBe(
      'ask',
    )
  })

  test('inside the working directory is still allowed', () => {
    expect(decide(glob, { pattern: join(dir, '*.txt') }).behavior).toBe('allow')
    expect(decide(glob, { pattern: join(dir, 'ok.txt') }).behavior).toBe('allow')
  })

  test('an absolute pattern overrides path, as the search does', () => {
    expect(decide(glob, { pattern: '/etc/*', path: dir }).behavior).toBe('ask')
  })
})

describe('Glob pattern network checks', () => {
  test('relative patterns are unaffected', () => {
    expect(decide(glob, { pattern: '**/*.ts' }).behavior).toBe('allow')
  })

  test.each([
    ['/.vol/1/2/*', 'Kernel-resolved path prefix (/.vol etc.) detected (defense-in-depth check)'],
    ['/net/host/**', 'Automount -hosts path detected (defense-in-depth check)'],
    ['/Network/**', 'Automount browse surface detected (defense-in-depth check)'],
    ['//server/share/*', 'UNC glob pattern detected (defense-in-depth check)'],
  ])('%s asks', (pattern, reason) => {
    expect(decide(glob, { pattern })).toEqual({ behavior: 'ask', reason })
  })

  test('an absolute pattern through a symlink to a network path asks', () => {
    expect(decide(glob, { pattern: join(dir, 'nfs', '**', '*.c') })).toEqual({
      behavior: 'ask',
      reason: 'Automount -hosts path detected (defense-in-depth check)',
    })
  })
})
