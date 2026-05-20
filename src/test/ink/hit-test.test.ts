import { describe, expect, test } from 'bun:test'
import { hitTest } from '../../ink/hit-test.js'
import { nodeCache } from '../../ink/node-cache.js'

function element(style: Record<string, unknown> = {}) {
  return {
    nodeName: 'ink-box',
    attributes: {},
    childNodes: [],
    dirty: false,
    style,
  } as any
}

describe('hitTest', () => {
  test('hits absolute children that paint outside their parent rect', () => {
    const root = element()
    const parent = element()
    const floating = element({ position: 'absolute' })
    root.childNodes = [parent]
    parent.parentNode = root
    parent.childNodes = [floating]
    floating.parentNode = parent

    nodeCache.set(root, { x: 0, y: 0, width: 80, height: 24, top: 0 })
    nodeCache.set(parent, { x: 0, y: 20, width: 80, height: 4, top: 20 })
    nodeCache.set(floating, { x: 2, y: 10, width: 20, height: 3, top: 10 })

    expect(hitTest(root, 5, 11)).toBe(floating)
  })

  test('does not hit normal children outside their parent rect', () => {
    const root = element()
    const parent = element()
    const child = element()
    root.childNodes = [parent]
    parent.parentNode = root
    parent.childNodes = [child]
    child.parentNode = parent

    nodeCache.set(root, { x: 0, y: 0, width: 80, height: 24, top: 0 })
    nodeCache.set(parent, { x: 0, y: 20, width: 80, height: 4, top: 20 })
    nodeCache.set(child, { x: 2, y: 10, width: 20, height: 3, top: 10 })

    expect(hitTest(root, 5, 11)).toBe(root)
  })
})
