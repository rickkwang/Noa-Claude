import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchGitDiffHunks, fetchSingleFileGitDiff } from '../../utils/gitDiff.js'

/**
 * Diff output we parse ourselves must come from the raw git blobs, never from
 * a workspace-configured diff driver or textconv filter. Upstream Claude Code
 * 2.1.222 passes --no-ext-diff --no-textconv on these paths; these tests pin
 * that behaviour by configuring both in a throwaway repo.
 *
 * Without --no-textconv the hunks would read "SECOND LINE"/"CHANGED LINE"
 * (the filter's uppercased rendering) instead of what is on disk; without
 * --no-ext-diff git replaces the whole unified diff with the external
 * program's stdout, which parses to zero hunks.
 */

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makeRepo(): { dir: string; file: string } {
  // realpath so findGitRoot's lexical resolution matches on macOS (/tmp symlink)
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'noa-rawdiff-')))
  git(dir, 'init', '-q', '.')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'commit.gpgsign', 'false')

  const file = join(dir, 'a.txt')
  writeFileSync(file, 'hello world\nsecond line\n')
  writeFileSync(join(dir, '.gitattributes'), '*.txt diff=upper\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'init')

  // A textconv filter that uppercases the blob before diffing.
  git(dir, 'config', 'diff.upper.textconv', 'tr a-z A-Z <')

  writeFileSync(file, 'hello world\nCHANGED line\n')
  return { dir, file }
}

/**
 * fetchGitDiffHunks() shells out without an explicit cwd, so it resolves
 * against process.cwd() — chdir is the only way to point it at the fixture.
 */
async function hunkLinesIn(dir: string): Promise<string[]> {
  const previous = process.cwd()
  process.chdir(dir)
  try {
    const hunks = await fetchGitDiffHunks()
    return [...hunks.values()].flatMap(fileHunks =>
      fileHunks.flatMap(hunk => hunk.lines),
    )
  } finally {
    process.chdir(previous)
  }
}

describe('git diff paths use raw blob contents', () => {
  test('fetchGitDiffHunks ignores a configured textconv filter', async () => {
    const { dir } = makeRepo()
    try {
      const lines = await hunkLinesIn(dir)
      expect(lines).toContain('+CHANGED line')
      expect(lines).toContain('-second line')
      expect(lines).not.toContain('+CHANGED LINE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('fetchGitDiffHunks ignores an external diff driver', async () => {
    const { dir } = makeRepo()
    try {
      git(dir, 'config', 'diff.external', 'sh -c "echo NOT-A-UNIFIED-DIFF" --')
      const lines = await hunkLinesIn(dir)
      expect(lines).toContain('+CHANGED line')
      expect(lines.join('\n')).not.toContain('NOT-A-UNIFIED-DIFF')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('fetchSingleFileGitDiff ignores a configured textconv filter', async () => {
    const { dir, file } = makeRepo()
    try {
      const diff = await fetchSingleFileGitDiff(file)
      expect(diff).not.toBeNull()
      expect(diff?.patch).toContain('+CHANGED line')
      expect(diff?.patch).toContain('-second line')
      expect(diff?.patch).not.toContain('+CHANGED LINE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('fetchSingleFileGitDiff ignores an external diff driver', async () => {
    const { dir, file } = makeRepo()
    try {
      git(dir, 'config', 'diff.external', 'sh -c "echo NOT-A-UNIFIED-DIFF" --')
      const diff = await fetchSingleFileGitDiff(file)
      expect(diff).not.toBeNull()
      expect(diff?.patch).toContain('+CHANGED line')
      expect(diff?.patch).not.toContain('NOT-A-UNIFIED-DIFF')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
