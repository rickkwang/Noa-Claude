import { afterEach, describe, expect, test } from 'bun:test'
import {
  countPorcelain,
  isGitStatusMetaEnabled,
  isUncommittedWorkDestructive,
} from '../../utils/permissions/autoModeGitStatus.js'

const BASH = 'Bash'
const POWERSHELL = 'PowerShell'

describe('countPorcelain', () => {
  test('reports a clean tree as all zeroes', () => {
    expect(countPorcelain('')).toEqual({
      staged: 0,
      modified: 0,
      untracked: 0,
    })
  })

  test('counts index column as staged and worktree column as modified', () => {
    // 'M ' = staged only, ' M' = modified only, 'MM' = both.
    const out = ['M  a.ts', ' M b.ts', 'MM c.ts'].join('\n')
    expect(countPorcelain(out)).toEqual({
      staged: 2,
      modified: 2,
      untracked: 0,
    })
  })

  test('counts ?? as one untracked entry, not staged+modified', () => {
    expect(countPorcelain('?? new.ts')).toEqual({
      staged: 0,
      modified: 0,
      untracked: 1,
    })
  })

  test('ignores short/blank lines', () => {
    expect(countPorcelain('\n\nM  a.ts\n')).toEqual({
      staged: 1,
      modified: 0,
      untracked: 0,
    })
  })
})

describe('isUncommittedWorkDestructive', () => {
  const destructive = [
    'git reset --hard',
    'git reset --hard HEAD~1',
    'git checkout .',
    'git checkout -- .',
    'git restore .',
    'git clean -fd',
    'git clean -fdx',
    'git clean --force',
    'rm -rf build',
    'rm -fr build',
    'rm -r dir',
    'rm -f file',
    'rm --recursive dir',
    'cd src && rm -rf generated',
  ]
  for (const command of destructive) {
    test(`fires on: ${command}`, () => {
      expect(isUncommittedWorkDestructive(BASH, command)).toBe(true)
    })
  }

  // Under-matching is safe (no line, prompt falls back); false positives cost a
  // needless `git status` on hot paths, so the common benign shapes are pinned.
  const benign = [
    'ls -la',
    'npm run build',
    'bun run typecheck',
    'git status',
    'git commit -m "wip"',
    'git checkout main',
    'git checkout -b feature',
    'git clean -n',
    'rm -i scratch.txt',
    'grep -r pattern src',
    'cat --format=json out.json',
  ]
  for (const command of benign) {
    test(`stays quiet on: ${command}`, () => {
      expect(isUncommittedWorkDestructive(BASH, command)).toBe(false)
    })
  }

  test('matches PowerShell removal forms', () => {
    expect(
      isUncommittedWorkDestructive(POWERSHELL, 'Remove-Item -Recurse -Force x'),
    ).toBe(true)
    expect(isUncommittedWorkDestructive(POWERSHELL, 'Get-ChildItem')).toBe(
      false,
    )
  })

  test('does not apply Bash patterns to a PowerShell command', () => {
    // rm is a PowerShell alias but upstream keys these off the tool's own set.
    expect(isUncommittedWorkDestructive(POWERSHELL, 'ls -la')).toBe(false)
  })

  test('bounds the scan so a huge paste cannot drive the regex', () => {
    const padded = `${'x'.repeat(20_000)} rm -rf /tmp/late`
    expect(isUncommittedWorkDestructive(BASH, padded)).toBe(false)
  })
})

describe('isGitStatusMetaEnabled', () => {
  const original = process.env.NOA_CLAUDE_AUTO_MODE_GIT_STATUS

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NOA_CLAUDE_AUTO_MODE_GIT_STATUS
    } else {
      process.env.NOA_CLAUDE_AUTO_MODE_GIT_STATUS = original
    }
  })

  test('defaults on, matching the upstream site default', () => {
    delete process.env.NOA_CLAUDE_AUTO_MODE_GIT_STATUS
    expect(isGitStatusMetaEnabled()).toBe(true)
  })

  test('env var can force it off without a rebuild', () => {
    process.env.NOA_CLAUDE_AUTO_MODE_GIT_STATUS = '0'
    expect(isGitStatusMetaEnabled()).toBe(false)
  })

  test('env var can force it on', () => {
    process.env.NOA_CLAUDE_AUTO_MODE_GIT_STATUS = '1'
    expect(isGitStatusMetaEnabled()).toBe(true)
  })
})
