import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { clearResolveGitDirCache } from '../../utils/git/gitFilesystem.js'
import { SettingsSchema } from '../../utils/settings/types.js'
import {
  buildStatusLineRateLimits,
  getLinkedWorktreeName,
  getStatusLineRefreshMs,
  getStatusLineRepo,
  getStatusLineWakeAt,
  getStatusLineWakeDelayMs,
  MAX_TIMER_DELAY_MS,
  splitStatusLineText,
  toStatusLineVimMode,
} from '../../utils/statusLine.js'

describe('getStatusLineRefreshMs', () => {
  test('refreshInterval is seconds with a 1s floor', () => {
    expect(getStatusLineRefreshMs({ refreshInterval: 5 })).toBe(5000)
    expect(getStatusLineRefreshMs({ refreshInterval: 0.2 })).toBe(1000)
  })

  test('legacy refreshIntervalMs applies only without refreshInterval', () => {
    expect(getStatusLineRefreshMs({ refreshIntervalMs: 2500 })).toBe(2500)
    expect(getStatusLineRefreshMs({ refreshIntervalMs: 10 })).toBe(1000)
    expect(
      getStatusLineRefreshMs({ refreshInterval: 3, refreshIntervalMs: 2500 }),
    ).toBe(3000)
  })

  test('clamps to the timer maximum and returns null when unset', () => {
    expect(getStatusLineRefreshMs({ refreshInterval: 1e12 })).toBe(
      MAX_TIMER_DELAY_MS,
    )
    expect(getStatusLineRefreshMs({})).toBeNull()
    expect(getStatusLineRefreshMs(undefined)).toBeNull()
  })
})

describe('statusLine settings schema', () => {
  const parse = (statusLine: unknown) =>
    SettingsSchema().safeParse({ statusLine })

  test('accepts refreshInterval and hideVimModeIndicator', () => {
    const r = parse({
      type: 'command',
      command: 'x',
      refreshInterval: 10,
      hideVimModeIndicator: true,
    })
    expect(r.success).toBe(true)
    expect(r.data?.statusLine).toMatchObject({
      refreshInterval: 10,
      hideVimModeIndicator: true,
    })
  })

  test('an invalid interval is dropped instead of rejecting the file', () => {
    const r = parse({ type: 'command', command: 'x', refreshInterval: 0 })
    expect(r.success).toBe(true)
    expect(r.data?.statusLine?.refreshInterval).toBeUndefined()
    expect(r.data?.statusLine?.command).toBe('x')
  })
})

describe('rate limit wake-ups', () => {
  const now = 1_000_000_000_000

  test('drops windows whose reset already passed', () => {
    const future = now / 1000 + 60
    expect(
      buildStatusLineRateLimits(
        {
          five_hour: { utilization: 0.5, resets_at: now / 1000 - 1 },
          seven_day: { utilization: 0.25, resets_at: future },
        },
        now,
      ),
    ).toEqual({ seven_day: { used_percentage: 25, resets_at: future } })
    expect(
      buildStatusLineRateLimits(
        { five_hour: { utilization: 1, resets_at: now / 1000 } },
        now,
      ),
    ).toBeUndefined()
  })

  test('wakes at the earliest reset plus a grace second', () => {
    const wakeAt = getStatusLineWakeAt({
      rate_limits: {
        five_hour: { used_percentage: 1, resets_at: 200 },
        seven_day: { used_percentage: 1, resets_at: 100 },
      },
    })
    expect(wakeAt).toBe(100_000)
    expect(getStatusLineWakeAt({})).toBeNull()
    expect(getStatusLineWakeDelayMs(100_000, 99_000)).toBe(2000)
    expect(getStatusLineWakeDelayMs(100_000, 500_000)).toBe(0)
  })
})

describe('splitStatusLineText', () => {
  test('single line is untouched', () => {
    expect(splitStatusLineText('\x1b[31mred')).toEqual(['\x1b[31mred'])
  })

  test('carries SGR and OSC 8 sequences from earlier lines', () => {
    const link = '\x1b]8;;https://x.test\x07'
    expect(splitStatusLineText(`\x1b[31ma\n${link}b\nc`)).toEqual([
      '\x1b[31ma',
      '\x1b[31m' + link + 'b',
      '\x1b[31m' + link + 'c',
    ])
  })
})

test('vim mode uses the space-separated VISUAL LINE spelling', () => {
  expect(toStatusLineVimMode('VISUAL_LINE')).toBe('VISUAL LINE')
  expect(toStatusLineVimMode('NORMAL')).toBe('NORMAL')
  expect(toStatusLineVimMode(undefined)).toBe('INSERT')
})

describe('workspace git identity', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
    clearResolveGitDirCache()
  })

  function makeRepo(): { main: string; common: string } {
    dir = mkdtempSync(join(tmpdir(), 'noa-statusline-'))
    const main = join(dir, 'main')
    const common = join(main, '.git')
    mkdirSync(join(common, 'worktrees', 'feat-x'), { recursive: true })
    writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/master\n')
    writeFileSync(
      join(common, 'config'),
      '[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n',
    )
    return { main, common }
  }

  test('main checkout: repo parsed, no linked worktree', async () => {
    const { main } = makeRepo()
    expect(await getLinkedWorktreeName(main)).toBeUndefined()
    expect(await getStatusLineRepo(main)).toEqual({
      host: 'github.com',
      owner: 'acme',
      name: 'widgets',
    })
  })

  test('linked worktree: name from its gitdir, repo from the common dir', async () => {
    const { common } = makeRepo()
    const wtGitDir = join(common, 'worktrees', 'feat-x')
    writeFileSync(join(wtGitDir, 'HEAD'), 'ref: refs/heads/feat-x\n')
    writeFileSync(join(wtGitDir, 'commondir'), '../..\n')
    const wt = join(dir!, 'wt')
    mkdirSync(wt)
    writeFileSync(join(wt, '.git'), `gitdir: ${wtGitDir}\n`)
    expect(await getLinkedWorktreeName(wt)).toBe('feat-x')
    expect((await getStatusLineRepo(wt))?.name).toBe('widgets')
  })

  test('outside a repository', async () => {
    dir = mkdtempSync(join(tmpdir(), 'noa-statusline-norepo-'))
    expect(await getLinkedWorktreeName(dir)).toBeUndefined()
    expect(await getStatusLineRepo(dir)).toBeUndefined()
  })
})
