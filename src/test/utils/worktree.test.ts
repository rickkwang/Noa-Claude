import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { setCwdState } from '../../bootstrap/state.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import {
  createAgentWorktree,
  getOrCreateWorktree,
  removeAgentWorktree,
} from '../../utils/worktree.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../../utils/settings/settingsCache.js'

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.toString()}`,
    )
  }
  return result.stdout.toString().trim()
}

function setTestSettings(settings: Record<string, unknown>): void {
  setSessionSettingsCache({ settings, errors: [] })
}

async function createRepoWithRemote(): Promise<{
  root: string
  repo: string
  remote: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'noa-worktree-'))
  const repo = join(root, 'repo')
  const remote = join(root, 'remote.git')

  git(root, ['init', '--bare', remote])
  git(root, ['init', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  await writeFile(join(repo, 'file.txt'), 'first\n')
  git(repo, ['add', 'file.txt'])
  git(repo, ['commit', '-m', 'first'])
  git(repo, ['remote', 'add', 'origin', remote])
  git(repo, ['push', '-u', 'origin', 'main'])

  return { root, repo, remote }
}

afterEach(() => {
  resetSettingsCache()
})

describe('worktree creation', () => {
  test('default worktrees are based on the remote default branch', async () => {
    const { root, repo } = await createRepoWithRemote()

    try {
      await writeFile(join(repo, 'file.txt'), 'second\n')
      git(repo, ['commit', '-am', 'second'])
      const localHead = git(repo, ['rev-parse', 'HEAD'])
      const remoteHead = git(repo, ['rev-parse', 'origin/main'])

      const created = await getOrCreateWorktree(repo, 'fresh-default-test')
      const worktreeHead = git(created.worktreePath, ['rev-parse', 'HEAD'])

      expect(created.existed).toBe(false)
      expect(created.headCommit).toBe(remoteHead)
      expect(worktreeHead).toBe(remoteHead)
      expect(worktreeHead).not.toBe(localHead)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('head mode preserves the current local HEAD behavior', async () => {
    const { root, repo } = await createRepoWithRemote()
    setTestSettings({ worktree: { baseRef: 'head' } })

    try {
      await writeFile(join(repo, 'file.txt'), 'second\n')
      git(repo, ['commit', '-am', 'second'])
      const localHead = git(repo, ['rev-parse', 'HEAD'])

      const created = await getOrCreateWorktree(repo, 'head-base-test')
      const worktreeHead = git(created.worktreePath, ['rev-parse', 'HEAD'])

      expect(created.existed).toBe(false)
      expect(created.headCommit).toBe(localHead)
      expect(worktreeHead).toBe(localHead)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('PR worktrees still use FETCH_HEAD regardless of baseRef', async () => {
    const { root, repo, remote } = await createRepoWithRemote()
    setTestSettings({ worktree: { baseRef: 'head' } })

    try {
      await writeFile(join(repo, 'file.txt'), 'second\n')
      git(repo, ['checkout', '-b', 'pr-source'])
      git(repo, ['commit', '-am', 'second'])
      const prHead = git(repo, ['rev-parse', 'HEAD'])
      const defaultHead = git(repo, ['rev-parse', 'origin/main'])
      git(repo, ['push', 'origin', 'pr-source'])
      git(remote, ['update-ref', 'refs/pull/123/head', prHead])

      git(repo, ['checkout', 'main'])

      const created = await getOrCreateWorktree(repo, 'pr-base-test', {
        prNumber: 123,
      })
      const worktreeHead = git(created.worktreePath, ['rev-parse', 'HEAD'])

      expect(created.existed).toBe(false)
      expect(created.headCommit).toBe(prHead)
      expect(worktreeHead).toBe(prHead)
      expect(worktreeHead).not.toBe(defaultHead)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('agent worktrees follow the same baseRef policy', async () => {
    const { root, repo } = await createRepoWithRemote()

    try {
      await writeFile(join(repo, 'file.txt'), 'second\n')
      git(repo, ['commit', '-am', 'second'])
      const localHead = git(repo, ['rev-parse', 'HEAD'])
      const remoteHead = git(repo, ['rev-parse', 'origin/main'])
      setCwdState(repo)

      const created = await runWithCwdOverride(repo, () =>
        createAgentWorktree('agent-fresh-test'),
      )
      const worktreeHead = git(created.worktreePath, ['rev-parse', 'HEAD'])

      expect(created.headCommit).toBe(remoteHead)
      expect(worktreeHead).toBe(remoteHead)
      expect(worktreeHead).not.toBe(localHead)

      await removeAgentWorktree(
        created.worktreePath,
        created.worktreeBranch,
        created.gitRoot,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('fresh mode fails clearly when no origin remote exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'noa-worktree-'))
    const repo = join(root, 'repo')

    try {
      git(root, ['init', '-b', 'main', repo])
      git(repo, ['config', 'user.email', 'test@example.com'])
      git(repo, ['config', 'user.name', 'Test User'])
      await writeFile(join(repo, 'file.txt'), 'first\n')
      git(repo, ['add', 'file.txt'])
      git(repo, ['commit', '-m', 'first'])

      await expect(getOrCreateWorktree(repo, 'no-origin-test')).rejects.toThrow(
        'Cannot create a fresh worktree: repository has no remote named "origin".',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
