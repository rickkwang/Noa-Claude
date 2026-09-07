import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  diffRefForSnapshot,
  fetchDiffHunksForRef,
  fetchDiffSnapshot,
} from '../../utils/diffPanelData.js'
import {
  resetCostState,
  setCwdState,
  setOriginalCwd,
} from '../../bootstrap/state.js'
import { findGitRoot, getIsGit } from '../../utils/git.js'
import { resetGitFileWatcher } from '../../utils/git/gitFilesystem.js'

/**
 * The diff panel's base modes each answer a different question, and getting
 * them confused is silent — the panel just shows the wrong changes. These run
 * against throwaway repos so the answers are checked, not assumed.
 */

const repos: string[] = []

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makeRepo(): string {
  // realpath so findGitRoot's lexical resolution matches on macOS (/tmp symlink)
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'noa-diffpanel-')))
  repos.push(dir)
  git(dir, 'init', '-q', '-b', 'main', '.')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

/**
 * Point every cwd source at the fixture: `process.chdir` for the git
 * subprocesses, and the bootstrap cwd state that `getCwd()` (and therefore
 * `getIsGit`) actually reads. `getIsGit`/`findGitRoot`/the git watcher all
 * memoize per process, so their caches go too — otherwise the second repo in a
 * run inherits the first one's answer.
 */
function useRepo(dir: string): void {
  process.chdir(dir)
  setCwdState(dir)
  setOriginalCwd(dir)
  resetCaches()
}

function resetCaches(): void {
  findGitRoot.cache.clear?.()
  ;(getIsGit as unknown as { cache?: Map<unknown, unknown> }).cache?.clear()
  resetGitFileWatcher()
}

const originalCwd = process.cwd()

afterEach(() => {
  delete process.env.CLAUDE_CODE_BASE_REF
  process.chdir(originalCwd)
  setCwdState(originalCwd)
  setOriginalCwd(originalCwd)
  resetCaches()
  for (const dir of repos.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('fetchDiffSnapshot', () => {
  test('reports uncommitted work against HEAD', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    useRepo(dir)

    const snapshot = await fetchDiffSnapshot('uncommitted')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.source.kind).toBe('working-tree')
    expect(snapshot?.stats.filesCount).toBe(1)
    expect(snapshot?.stats.linesAdded).toBe(1)
    expect(diffRefForSnapshot(snapshot!)).toBe('HEAD')
  })

  test('includes untracked files in the count', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')
    useRepo(dir)

    const snapshot = await fetchDiffSnapshot('uncommitted')
    expect(snapshot?.perFileStats.get('new.txt')?.isUntracked).toBe(true)
    expect(snapshot?.stats.filesCount).toBe(1)
  })

  test('uncommitted mode keeps untracked files that predate the session', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    writeFileSync(join(dir, 'stale.txt'), 'left over from yesterday\n')
    // The file can't be backdated (ctime is not settable, and preSession reads
    // max(mtime, ctime)), so move the session clock forward past it instead.
    // The pause is for timestamp granularity — same-millisecond fails `<`.
    await new Promise(resolve => setTimeout(resolve, 25))
    resetCostState()
    useRepo(dir)

    // "Everything vs HEAD" has to mean everything — an untracked file being
    // old is a reason to sort it last, not to hide it. It must also stay
    // *unflagged* here: the panel folds flagged files away, and "before this
    // session" is not a distinction this base draws.
    const snapshot = await fetchDiffSnapshot('uncommitted')
    expect(snapshot?.perFileStats.get('stale.txt')).toMatchObject({
      isUntracked: true,
    })
    expect(snapshot?.perFileStats.get('stale.txt')?.preSession).toBeUndefined()

    // Session mode does draw it, so there it is flagged rather than dropped.
    const session = await fetchDiffSnapshot('session')
    expect(session?.perFileStats.get('stale.txt')?.preSession).toBe(true)
  })

  test('branch mode diffs against the merge base, not the working tree', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    git(dir, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(dir, 'b.txt'), 'committed on the branch\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'branch work')
    useRepo(dir)
    // getDefaultBranch() reads process-global caches that a chdir can't reset,
    // so name the base explicitly — the same override CI containers use.
    process.env.CLAUDE_CODE_BASE_REF = 'main'

    const snapshot = await fetchDiffSnapshot('branch')
    expect(snapshot?.source.kind).toBe('branch')
    // The file is committed, so an "uncommitted" read would report nothing.
    expect(snapshot?.perFileStats.has('b.txt')).toBe(true)
    expect(diffRefForSnapshot(snapshot!)).not.toBe('HEAD')

    const uncommitted = await fetchDiffSnapshot('uncommitted')
    expect(uncommitted?.stats.filesCount).toBe(0)
  })

  test('branch mode degrades to a HEAD diff when there is no base branch', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    useRepo(dir)
    process.env.CLAUDE_CODE_BASE_REF = 'does-not-exist'

    const snapshot = await fetchDiffSnapshot('branch')
    // Not null: the panel says "no base branch to compare against" and shows
    // the HEAD diff rather than going blank.
    expect(snapshot?.source.kind).toBe('working-tree')
    expect(snapshot?.stats.filesCount).toBe(1)
  })

  test('falls back to staged content in a repo with no commits', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    git(dir, 'add', '.')
    useRepo(dir)

    const snapshot = await fetchDiffSnapshot('session')
    expect(snapshot?.noCommits).toBe(true)
    expect(snapshot?.perFileStats.has('a.txt')).toBe(true)
    expect(diffRefForSnapshot(snapshot!)).toBe('--cached')
  })

  test('returns null outside a git repo', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'noa-nogit-')))
    repos.push(dir)
    useRepo(dir)
    expect(await fetchDiffSnapshot('session')).toBeNull()
  })

  test('paths stay repo-root-relative when the session runs from a subdirectory', async () => {
    const dir = makeRepo()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'root.txt'), 'one\n')
    writeFileSync(join(dir, 'sub', 'inner.txt'), 'two\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    // Session starts in sub/; changes land above it and inside it.
    writeFileSync(join(dir, 'root.txt'), 'one\nchanged\n')
    writeFileSync(join(dir, 'untracked-above.txt'), 'new\n')
    writeFileSync(join(dir, 'sub', 'untracked-here.txt'), 'new\n')
    useRepo(join(dir, 'sub'))

    const snapshot = await fetchDiffSnapshot('uncommitted')
    expect(snapshot).not.toBeNull()
    const paths = [...snapshot!.perFileStats.keys()]
    // Root-relative, never cwd-relative: a `../` path here would miss every
    // rooted permission rule and every root-anchored file read downstream.
    expect(paths.some(p => p.startsWith('..'))).toBe(false)
    expect(paths).toContain('root.txt')
    expect(paths).toContain('sub/untracked-here.txt')
    // The untracked listing runs at the repo root so it is not blind to files
    // above the session cwd.
    expect(paths).toContain('untracked-above.txt')
  })

  test('branch mode falls back to the remote-tracking ref when local base is missing', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    git(dir, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(dir, 'b.txt'), 'branch work\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'branch commit')
    // A fresh clone often has only origin/main, no local main.
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'main')
    git(dir, 'branch', '-q', '-D', 'main')
    useRepo(dir)
    process.env.CLAUDE_CODE_BASE_REF = 'main'

    const snapshot = await fetchDiffSnapshot('branch')
    expect(snapshot?.source.kind).toBe('branch')
    expect(snapshot?.perFileStats.has('b.txt')).toBe(true)
  })

  test('branch mode on a detached HEAD degrades to a HEAD diff', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    git(dir, 'checkout', '-q', '--detach', 'HEAD')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    useRepo(dir)
    process.env.CLAUDE_CODE_BASE_REF = 'main'

    const snapshot = await fetchDiffSnapshot('branch')
    expect(snapshot?.source.kind).toBe('working-tree')
    expect(snapshot?.stats.filesCount).toBe(1)
  })
})

describe('fetchDiffHunksForRef', () => {
  test('parses hunks for the ref the snapshot resolved to', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'first')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    useRepo(dir)

    const parsed = await fetchDiffHunksForRef('HEAD')
    expect(parsed).not.toBeNull()
    expect(parsed?.hunks.get('a.txt')?.[0]?.lines).toContain('+two')
    expect(parsed?.skippedLarge.size).toBe(0)
  })

  test('drops staged hunks that were edited again afterwards', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'staged\n')
    git(dir, 'add', '.')
    writeFileSync(join(dir, 'a.txt'), 'staged then changed\n')
    useRepo(dir)

    // `--cached` alone would render the stale staged patch as if it were
    // current; the unstaged edit must suppress it.
    const parsed = await fetchDiffHunksForRef('--cached')
    expect(parsed?.hunks.has('a.txt')).toBe(false)
  })
})
