import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir, userInfo } from 'os'
import { join } from 'path'
import { parseSingleFileGrepCommand } from '../../tools/BashTool/grepReadParser.js'
import { maybeRegisterGrepRead } from '../../tools/BashTool/grepReadRegistration.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'

async function withTempDir(
  fn: (dir: string) => void | Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'grep-read-'))
  try {
    await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('parseSingleFileGrepCommand', () => {
  test('recognizes plain single-file grep', () => {
    expect(parseSingleFileGrepCommand('grep foo src/app.ts')).toBe('src/app.ts')
  })

  test('recognizes egrep and fgrep', () => {
    expect(parseSingleFileGrepCommand('egrep foo a.txt')).toBe('a.txt')
    expect(parseSingleFileGrepCommand('fgrep foo a.txt')).toBe('a.txt')
  })

  test('allows boolean short flags and clusters', () => {
    expect(parseSingleFileGrepCommand('grep -i foo a.txt')).toBe('a.txt')
    expect(parseSingleFileGrepCommand('grep -in foo a.txt')).toBe('a.txt')
    expect(parseSingleFileGrepCommand('grep -n -v foo a.txt')).toBe('a.txt')
  })

  test('allows safe long flags', () => {
    expect(parseSingleFileGrepCommand('grep --ignore-case foo a.txt')).toBe(
      'a.txt',
    )
  })

  test('handles quoted pattern with spaces', () => {
    expect(parseSingleFileGrepCommand('grep "foo bar" a.txt')).toBe('a.txt')
  })

  test('honors -- terminator', () => {
    expect(parseSingleFileGrepCommand('grep -- -foo a.txt')).toBe('a.txt')
  })

  test('rejects stdin (no file operand)', () => {
    expect(parseSingleFileGrepCommand('grep foo')).toBeNull()
    expect(parseSingleFileGrepCommand('grep foo -')).toBeNull()
  })

  test('rejects multiple files', () => {
    expect(parseSingleFileGrepCommand('grep foo a.txt b.txt')).toBeNull()
  })

  test('rejects recursive grep', () => {
    expect(parseSingleFileGrepCommand('grep -r foo src')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -rn foo src')).toBeNull()
  })

  test('rejects content-suppressing flags (no editable lines shown)', () => {
    expect(parseSingleFileGrepCommand('grep -l foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -L foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -c foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -q foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -o foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -V foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -nl foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep --count foo a.txt')).toBeNull()
    expect(
      parseSingleFileGrepCommand('grep --only-matching foo a.txt'),
    ).toBeNull()
  })

  test('rejects value-taking flags', () => {
    expect(parseSingleFileGrepCommand('grep -e foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -A 3 foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep -m 5 foo a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep --include=*.ts foo a.txt')).toBeNull()
  })

  test('rejects pipes and redirects', () => {
    expect(parseSingleFileGrepCommand('grep foo a.txt | head')).toBeNull()
    expect(parseSingleFileGrepCommand('grep foo a.txt > out.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('grep foo a.txt && echo done')).toBeNull()
  })

  test('rejects non-grep commands', () => {
    expect(parseSingleFileGrepCommand('cat a.txt')).toBeNull()
    expect(parseSingleFileGrepCommand('rg foo a.txt')).toBeNull()
  })
})

describe('maybeRegisterGrepRead', () => {
  test('stores content in the same normalized form as Read/Edit', async () => {
    await withTempDir(async dir => {
      const file = join(dir, 'crlf.txt')
      writeFileSync(file, 'alpha\r\nbeta\r\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await maybeRegisterGrepRead(`grep alpha ${file}`, 'alpha', readFileState)

      const state = readFileState.get(file)
      expect(state?.content).toBe('alpha\nbeta\n')
      expect(state?.timestamp).toBe(Math.floor(statSync(file).mtimeMs))
      expect(state?.offset).toBeUndefined()
      expect(state?.limit).toBeUndefined()
    })
  })

  test('does not register grep stdin even if a dash-named file exists', async () => {
    await withTempDir(async dir => {
      writeFileSync(join(dir, '-'), 'not stdin\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await maybeRegisterGrepRead('grep needle -', 'needle', readFileState)

      expect(readFileState.size).toBe(0)
    })
  })

  test('does not register a different path after whitespace trimming', async () => {
    await withTempDir(async dir => {
      const grepFile = join(dir, ' target.txt ')
      const trimmedFile = join(dir, ' target.txt')
      writeFileSync(grepFile, 'needle in grep file\n')
      writeFileSync(trimmedFile, 'wrong file\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await maybeRegisterGrepRead(
        `grep needle ${JSON.stringify(grepFile)}`,
        'needle in grep file',
        readFileState,
      )

      expect(readFileState.size).toBe(0)
    })
  })

  test('does not register tilde paths without shell quote context', async () => {
    await withTempDir(async dir => {
      const username = userInfo().username.replace(/[^A-Za-z0-9._-]/g, '_')
      const localTildeDir = join(dir, `~${username}`)
      mkdirSync(localTildeDir)
      writeFileSync(join(localTildeDir, 'target.txt'), 'wrong file\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await runWithCwdOverride(dir, () =>
        maybeRegisterGrepRead(
          `grep needle ~${username}/target.txt`,
          'needle',
          readFileState,
        ),
      )

      expect(readFileState.size).toBe(0)
    })
  })

  test('does not register paths rejected by normal Read binary extension checks', async () => {
    await withTempDir(async dir => {
      const file = join(dir, 'Example.class')
      writeFileSync(file, 'needle\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await maybeRegisterGrepRead(`grep needle ${file}`, 'needle', readFileState)

      expect(readFileState.size).toBe(0)
    })
  })

  test('does not register rendered binary formats that Read does not cache as text', async () => {
    await withTempDir(async dir => {
      const file = join(dir, 'document.pdf')
      writeFileSync(file, 'needle\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await maybeRegisterGrepRead(`grep -a needle ${file}`, 'needle', readFileState)

      expect(readFileState.size).toBe(0)
    })
  })

  test('does not register binary grep summary output', async () => {
    await withTempDir(async dir => {
      const file = join(dir, 'binary.txt')
      writeFileSync(file, 'needle\0rest\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await maybeRegisterGrepRead(
        `grep needle ${file}`,
        `Binary file ${file} matches`,
        readFileState,
      )

      expect(readFileState.size).toBe(0)
    })
  })

  test('does not register when grep output has no visible text', async () => {
    await withTempDir(async dir => {
      const file = join(dir, 'hidden.txt')
      writeFileSync(file, 'needle\n')
      const readFileState = createFileStateCacheWithSizeLimit(10)

      await maybeRegisterGrepRead(`grep needle ${file}`, '\n', readFileState)

      expect(readFileState.size).toBe(0)
    })
  })
})
