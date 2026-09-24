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
import { checkReadPermissionForTool } from '../../../utils/permissions/filesystem.js'

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
const glob = {
  name: 'Glob',
  getPath: (i: { path?: string }) => i.path ?? getCwdState(),
}

function decide(tool: object, input: object) {
  const r = checkReadPermissionForTool(
    tool as never,
    input as never,
    getEmptyToolPermissionContext(),
  )
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

describe('Glob pattern network checks', () => {
  test('relative patterns are unaffected', () => {
    expect(decide(glob, { pattern: '**/*.ts' }).behavior).toBe('allow')
  })

  test.each([
    ['/.vol/1/2/*', 'Kernel-resolved path prefix (/.vol etc.) glob pattern detected (defense-in-depth check)'],
    ['/net/host/**', 'Automount -hosts glob pattern detected (defense-in-depth check)'],
    ['/Network/**', 'Automount browse surface glob pattern detected (defense-in-depth check)'],
    ['//server/share/*', 'UNC glob pattern detected (defense-in-depth check)'],
  ])('%s asks', (pattern, reason) => {
    expect(decide(glob, { pattern })).toEqual({ behavior: 'ask', reason })
  })

  test('an absolute pattern through a symlink to a network path asks', () => {
    expect(decide(glob, { pattern: join(dir, 'nfs', '**', '*.c') })).toEqual({
      behavior: 'ask',
      reason: 'Glob pattern links to a network path (defense-in-depth check)',
    })
  })
})
