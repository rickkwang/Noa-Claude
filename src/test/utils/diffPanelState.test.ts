import { describe, expect, test } from 'bun:test'
import {
  AUTO_OPEN_MIN_COLUMNS,
  describeDiffBase,
  diffPanelCanMount,
  diffPanelWidth,
  MIN_DIFF_PANEL_COLUMNS,
} from '../../utils/diffPanelState.js'

/**
 * The mount rules are what keep the diff sidebar from wrecking the transcript,
 * and the width formula is the only thing standing between "sidebar" and
 * "two unreadable columns". Both are pure, so they get pinned here.
 */

const MOUNTABLE = {
  fullscreen: true,
  columns: 200,
  isThinClient: false,
  isMainFocused: true,
  hasGitRepo: true,
} as const

describe('diffPanelCanMount', () => {
  test('allows a wide fullscreen git repo in the main view', () => {
    expect(diffPanelCanMount({ ...MOUNTABLE })).toBe(true)
  })

  test.each([
    ['outside fullscreen', { fullscreen: false }],
    ['on a thin client', { isThinClient: true }],
    ['while viewing an agent transcript', { isMainFocused: false }],
    ['outside a git repo', { hasGitRepo: false }],
    ['below the column floor', { columns: MIN_DIFF_PANEL_COLUMNS - 1 }],
  ])('refuses %s', (_label, override) => {
    expect(diffPanelCanMount({ ...MOUNTABLE, ...override })).toBe(false)
  })

  test('accepts exactly the column floor', () => {
    expect(
      diffPanelCanMount({ ...MOUNTABLE, columns: MIN_DIFF_PANEL_COLUMNS }),
    ).toBe(true)
  })
})

describe('diffPanelWidth', () => {
  test('is zero while the transcript tab is active', () => {
    expect(diffPanelWidth('convo', { ...MOUNTABLE })).toBe(0)
  })

  test('is zero when the panel cannot mount', () => {
    expect(diffPanelWidth('diff', { ...MOUNTABLE, hasGitRepo: false })).toBe(0)
  })

  test('always leaves the transcript at least 70 columns', () => {
    for (let columns = MIN_DIFF_PANEL_COLUMNS; columns <= 400; columns++) {
      const width = diffPanelWidth('diff', { ...MOUNTABLE, columns })
      expect(width).toBeGreaterThan(0)
      expect(columns - width).toBeGreaterThanOrEqual(70)
    }
  })

  test('caps at 90 columns however wide the terminal gets', () => {
    expect(diffPanelWidth('diff', { ...MOUNTABLE, columns: 1000 })).toBe(90)
  })

  test('takes 45% on a mid-size terminal', () => {
    expect(diffPanelWidth('diff', { ...MOUNTABLE, columns: 160 })).toBe(72)
  })
})

describe('describeDiffBase', () => {
  const workingTree = { kind: 'working-tree' } as const

  test('names the branch it resolved to', () => {
    expect(
      describeDiffBase(
        'branch',
        { kind: 'branch', baseBranch: 'main' },
        false,
      ),
    ).toBe('branch vs main')
  })

  test('says so when branch mode found no base branch', () => {
    expect(describeDiffBase('branch', workingTree, false)).toBe(
      'vs HEAD (no base branch)',
    )
  })

  test('marks a pending switch with an ellipsis', () => {
    expect(describeDiffBase('uncommitted', workingTree, true)).toBe(
      'uncommitted (vs HEAD)…',
    )
  })
})

describe('auto-open thresholds', () => {
  test('demands more width than a deliberate open', () => {
    expect(AUTO_OPEN_MIN_COLUMNS).toBeGreaterThan(MIN_DIFF_PANEL_COLUMNS)
  })
})
