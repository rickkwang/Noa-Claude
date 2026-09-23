import { describe, expect, test } from 'bun:test'
import OptionMap from '../../../components/CustomSelect/option-map.js'
import { reducer } from '../../../components/CustomSelect/use-select-navigation.js'

function state(focused: number, from: number, count = 3, size = 8) {
  const options = Array.from({ length: size }, (_, i) => ({
    label: `o${i}`,
    value: i,
  }))
  return {
    optionMap: new OptionMap(options),
    visibleOptionCount: count,
    focusedValue: focused,
    visibleFromIndex: from,
    visibleToIndex: from + count,
  }
}

describe('scroll-viewport', () => {
  test('moves the window without moving focus that stays in view', () => {
    const next = reducer(state(2, 0), { type: 'scroll-viewport', delta: 1 })
    expect(next.visibleFromIndex).toBe(1)
    expect(next.visibleToIndex).toBe(4)
    expect(next.focusedValue).toBe(2)
  })

  test('drags focus along when it would scroll out of view', () => {
    expect(
      reducer(state(0, 0), { type: 'scroll-viewport', delta: 1 }).focusedValue,
    ).toBe(1)
    expect(
      reducer(state(7, 5), { type: 'scroll-viewport', delta: -1 })
        .focusedValue,
    ).toBe(6)
  })

  test('is a no-op at either end', () => {
    const top = state(0, 0)
    expect(reducer(top, { type: 'scroll-viewport', delta: -1 })).toBe(top)
    const bottom = state(7, 5)
    expect(reducer(bottom, { type: 'scroll-viewport', delta: 1 })).toBe(bottom)
  })
})
