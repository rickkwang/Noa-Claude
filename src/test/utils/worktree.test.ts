import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { getOrCreateWorktree } from '../../utils/worktree.js'

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

describe('worktree creation', () => {
  test('normal worktrees are based on local HEAD, including unpushed commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'noa-worktree-'))
    const repo = join(root, 'repo')
    const remote = join(root, 'remote.git')

    try {
      git(root, ['init', '--bare', remote])
      git(root, ['init', '-b', 'main', repo])
      git(repo, ['config', 'user.email', 'test@example.com'])
      git(repo, ['config', 'user.name', 'Test User'])
      await writeFile(join(repo, 'file.txt'), 'first\n')
      git(repo, ['add', 'file.txt'])
      git(repo, ['commit', '-m', 'first'])
      git(repo, ['remote', 'add', 'origin', remote])
      git(repo, ['push', '-u', 'origin', 'main'])

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
})
