import { describe, expect, test } from 'bun:test'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeTextContent } from '../../utils/file.js'

// writeTextContent verifies the on-disk byte count after writing and throws if
// it disagrees. Every file write in the product goes through it, so a wrong
// expected-size computation for any encoding would fail every write of that
// kind. These cases pin the byte accounting.
describe('writeTextContent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'write-text-content-'))

  test.each([
    ['utf8 LF', 'utf8' as const, 'LF' as const, 'hello\nworld\n', 12],
    ['utf8 CRLF', 'utf8' as const, 'CRLF' as const, 'hello\nworld\n', 14],
    ['utf8 multibyte', 'utf8' as const, 'LF' as const, 'héllo ✓ 中文\n', 18],
    ['utf16le with BOM', 'utf16le' as const, 'LF' as const, '\uFEFFhi\n', 8],
  ])('%s', (name, encoding, endings, content, expectedBytes) => {
    const file = join(dir, `${name.replaceAll(' ', '-')}.txt`)
    const mtime = writeTextContent(file, content, encoding, endings)

    expect(statSync(file).size).toBe(expectedBytes)
    expect(mtime).toBe(Math.floor(statSync(file).mtimeMs))
  })

  test('follows a symlink without replacing it', () => {
    const target = join(dir, 'target.txt')
    const link = join(dir, 'link.txt')
    writeFileSync(target, 'old\n')
    symlinkSync(target, link)

    writeTextContent(link, 'new content\n', 'utf8', 'LF')

    expect(readFileSync(target, 'utf8')).toBe('new content\n')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })
})
