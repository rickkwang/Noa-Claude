import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTipsFile } from '../../../services/tips/tipsFileLoader.js'

const tempDirs: string[] = []

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noa-tips-file-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('loadTipsFile', () => {
  test('rejects a relative path', () => {
    expect(loadTipsFile('tips.json')).toBeNull()
    expect(loadTipsFile('./tips.json')).toBeNull()
  })

  test('rejects UNC/network paths before touching the filesystem', () => {
    expect(loadTipsFile('//server/share/tips.json')).toBeNull()
    expect(loadTipsFile('  //server/share/tips.json')).toBeNull()
    expect(loadTipsFile('\\\\server\\share\\tips.json')).toBeNull()
  })

  test('rejects a file over 256KB', () => {
    const dir = freshDir()
    const path = join(dir, 'big.json')
    // Valid JSON start, just oversized: 300KB of spaces inside an array.
    writeFileSync(path, `[${' '.repeat(300 * 1024)}]`)
    expect(loadTipsFile(path)).toBeNull()
  })

  test('caps entries at 200', () => {
    const dir = freshDir()
    const path = join(dir, 'many.json')
    const tips = Array.from({ length: 250 }, (_, i) => `tip-${i}`)
    writeFileSync(path, JSON.stringify(tips))
    const loaded = loadTipsFile(path)
    expect(loaded).toHaveLength(200)
    expect(loaded?.[0]).toBe('tip-0')
    expect(loaded?.[199]).toBe('tip-199')
  })

  test('serves a cached parse until the file changes on disk', () => {
    const dir = freshDir()
    const path = join(dir, 'cached.json')
    writeFileSync(path, '["v1"]')
    expect(loadTipsFile(path)).toEqual(['v1'])

    // Same size, forced new mtime → cache miss, re-read.
    writeFileSync(path, '["v2"]')
    const future = new Date(Date.now() + 60_000)
    utimesSync(path, future, future)
    expect(loadTipsFile(path)).toEqual(['v2'])
  })
})
