import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveResumedWorktreePath } from '../../tools/AgentTool/resumeAgent.js'

describe('resolveResumedWorktreePath', () => {
  test('returns undefined when no worktreePath was recorded', async () => {
    expect(await resolveResumedWorktreePath(undefined)).toBeUndefined()
  })

  test('returns path when worktree directory exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noa-resume-worktree-'))
    try {
      expect(await resolveResumedWorktreePath(dir)).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('throws when recorded worktree no longer exists', async () => {
    const ghost = join(tmpdir(), 'noa-ghost-worktree-does-not-exist-12345')
    await expect(resolveResumedWorktreePath(ghost)).rejects.toThrow(
      /no longer exists/,
    )
  })

  test('throws when recorded path is a file, not a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noa-resume-worktree-file-'))
    const filePath = join(dir, 'not-a-dir')
    writeFileSync(filePath, '')
    try {
      await expect(resolveResumedWorktreePath(filePath)).rejects.toThrow(
        /no longer exists/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
