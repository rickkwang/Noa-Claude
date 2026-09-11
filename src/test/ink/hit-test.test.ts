import { describe, expect, test } from 'bun:test'
import {
  dispatchWheel,
  hitTest,
  selectionScopeAt,
} from '../../ink/hit-test.js'
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

describe('dispatchWheel', () => {
  /** root > list > row, with the pointer over `row`. */
  function tree() {
    const root = element()
    const list = element()
    const row = element()
    root.childNodes = [list]
    list.parentNode = root
    list.childNodes = [row]
    row.parentNode = list
    nodeCache.set(root, { x: 0, y: 0, width: 80, height: 24, top: 0 })
    nodeCache.set(list, { x: 0, y: 0, width: 80, height: 8, top: 0 })
    nodeCache.set(row, { x: 0, y: 2, width: 80, height: 1, top: 2 })
    return { root, list, row }
  }

  test('bubbles innermost first and reports the delta', () => {
    const { root, list } = tree()
    const seen: string[] = []
    list._eventHandlers = { onWheel: (e: any) => seen.push(`list:${e.deltaY}`) }
    root._eventHandlers = { onWheel: (e: any) => seen.push(`root:${e.deltaY}`) }

    expect(dispatchWheel(root, 5, 2, 1)).toBe(false)
    expect(seen).toEqual(['list:1', 'root:1'])
  })

  test('stopPropagation keeps the wheel from reaching ancestors', () => {
    const { root, list } = tree()
    const seen: string[] = []
    list._eventHandlers = {
      onWheel: (e: any) => {
        seen.push('list')
        e.stopPropagation()
      },
    }
    root._eventHandlers = { onWheel: () => seen.push('root') }

    dispatchWheel(root, 5, 2, 1)
    expect(seen).toEqual(['list'])
  })

  test('preventDefault marks the wheel consumed', () => {
    const { root } = tree()
    root._eventHandlers = { onWheel: (e: any) => e.preventDefault() }
    expect(dispatchWheel(root, 5, 2, -1)).toBe(true)
  })

  test('is not consumed when nothing under the pointer handles it', () => {
    const { root } = tree()
    root._eventHandlers = {}
    expect(dispatchWheel(root, 5, 2, 1)).toBe(false)
  })

  test('is not consumed outside the root rect', () => {
    const { root } = tree()
    root._eventHandlers = { onWheel: (e: any) => e.preventDefault() }
    expect(dispatchWheel(root, 5, 40, 1)).toBe(false)
  })
})

describe('selectionScopeAt', () => {
  function sidebarTree() {
    const root = element()
    const panel = element({ selectionScope: true })
    const body = element({ overflow: 'hidden' })
    const line = element()
    root.childNodes = [panel]
    panel.parentNode = root
    panel.childNodes = [body]
    body.parentNode = panel
    body.childNodes = [line]
    line.parentNode = body
    nodeCache.set(root, { x: 0, y: 0, width: 100, height: 30, top: 0 })
    nodeCache.set(panel, { x: 60, y: 0, width: 40, height: 30, top: 0 })
    nodeCache.set(body, { x: 60, y: 5, width: 40, height: 25, top: 5 })
    nodeCache.set(line, { x: 61, y: 6, width: 38, height: 1, top: 6 })
    return { root, panel }
  }

  test('scopes a press inside a selectionScope box to its columns', () => {
    const { root, panel } = sidebarTree()
    expect(selectionScopeAt(root, 70, 6)).toEqual({ x1: 60, x2: 100, node: panel })
  })

  test('leaves a press outside any scope unscoped', () => {
    const { root } = sidebarTree()
    expect(selectionScopeAt(root, 10, 6)).toBeUndefined()
  })

  test('a clipping ancestor above the scope narrows it', () => {
    const outer = element({ overflow: 'hidden' })
    const { root, panel } = sidebarTree()
    outer.childNodes = [root]
    root.parentNode = outer
    nodeCache.set(outer, { x: 0, y: 0, width: 80, height: 30, top: 0 })
    expect(selectionScopeAt(outer, 70, 6)).toEqual({ x1: 60, x2: 80, node: panel })
  })
})
