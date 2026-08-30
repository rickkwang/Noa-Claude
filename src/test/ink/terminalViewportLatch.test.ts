import { describe, expect, test } from 'bun:test'
import { nextViewportVisibility } from '../../ink/hooks/use-terminal-viewport.js'

describe('nextViewportVisibility', () => {
  test('publishes a genuine transition and counts it', () => {
    expect(nextViewportVisibility(true, false, 0)).toEqual({
      visible: false,
      flips: 1,
    })
  })

  test('resets the flip count once the layout agrees', () => {
    expect(nextViewportVisibility(false, false, 3)).toEqual({
      visible: false,
      flips: 0,
    })
  })

  test('latches on visible once the flips exceed the budget', () => {
    // 5 flips already recorded — the next disagreement is over budget.
    expect(nextViewportVisibility(true, false, 5)).toEqual({
      visible: true,
      flips: 6,
    })
  })

  // The crash shape: an element whose own subtree grows when it is visible
  // pushes itself into scrollback, shrinks, and becomes visible again. The
  // calculation has no fixed point, so without the latch every commit
  // schedules another setState from a layout effect and React aborts the app
  // with "Maximum update depth exceeded".
  test('a layout with no fixed point stops flipping instead of running forever', () => {
    const rows = 10
    // Element is 2 rows tall at the top; the content below it is live (40
    // rows) while visible and collapsed (0 rows) while frozen.
    const measure = (published: boolean): boolean => {
      const screenHeight = 2 + (published ? 40 : 0)
      const cursorRestoreScroll = screenHeight > rows ? 1 : 0
      const viewportY = Math.max(0, screenHeight - rows) + cursorRestoreScroll
      return 2 > viewportY && 0 < viewportY + rows
    }

    // Sanity: this layout really is an oscillator, both states disagree with
    // themselves. Without it the test below would pass vacuously.
    expect(measure(true)).toBe(false)
    expect(measure(false)).toBe(true)

    let published = true
    let flips = 0
    const transitions: boolean[] = []
    for (let commit = 0; commit < 50; commit++) {
      const next = nextViewportVisibility(published, measure(published), flips)
      flips = next.flips
      if (next.visible !== published) {
        published = next.visible
        transitions.push(published)
      }
    }

    // Bounded: a handful of transitions, then quiet. React's own nested-update
    // limit is 50, so anything at or near 50 here is the crash.
    expect(transitions.length).toBeLessThanOrEqual(6)
    expect(published).toBe(true)
  })
})
