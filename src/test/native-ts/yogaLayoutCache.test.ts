import { expect, test } from 'bun:test'
import Yoga, {
  Direction,
  Edge,
  FlexDirection,
  Overflow,
} from '../../native-ts/yoga-layout/index.js'

type LayoutNode = ReturnType<typeof Yoga.Node.create>

/** A column box with Ink's `flexShrink: 1` default. */
function box(): LayoutNode {
  const node = Yoga.Node.create()
  node.setFlexDirection(FlexDirection.Column)
  node.setFlexShrink(1)
  return node
}

/** A text-like leaf whose measured height can change, marking it dirty. */
function text(height: number, width = 40) {
  const node = Yoga.Node.create()
  let h = height
  node.setMeasureFunc(() => ({ width, height: h }))
  return {
    node,
    setHeight(next: number) {
      h = next
      node.markDirty()
    },
  }
}

/**
 * The fullscreen REPL with the diff sidebar open: a row holding the transcript
 * and the sidebar above a full-width bottom slot. The sidebar's header rows
 * re-render above a body that hands its remaining height to a scroll box with
 * far taller content.
 */
function sidebar() {
  const root = box()
  root.setWidth(200)
  root.setHeight(50)
  const row = box()
  row.setFlexDirection(FlexDirection.Row)
  row.setFlexGrow(1)
  row.setOverflow(Overflow.Hidden)
  root.insertChild(row, 0)
  const bottom = box()
  bottom.setFlexShrink(0)
  bottom.insertChild(text(6).node, 0)
  root.insertChild(bottom, 1)

  const transcript = box()
  transcript.setWidth(110)
  transcript.setFlexShrink(0)
  row.insertChild(transcript, 0)
  const column = box()
  column.setWidth(90)
  column.setFlexShrink(0)
  column.setOverflow(Overflow.Hidden)
  row.insertChild(column, 1)

  const panel = box()
  panel.setWidth(90)
  panel.setHeightPercent(100)
  panel.setFlexShrink(0)
  column.insertChild(panel, 0)
  const header = box()
  header.setPadding(Edge.All, 1)
  header.setFlexShrink(0)
  panel.insertChild(header, 0)
  const list = box()
  list.setMargin(Edge.Top, 1)
  header.insertChild(list, 0)
  const rows = Array.from({ length: 10 }, () => text(1))
  rows.forEach((item, i) => {
    const line = box()
    line.setFlexDirection(FlexDirection.Row)
    line.insertChild(item.node, 0)
    list.insertChild(line, i)
  })

  const body = box()
  body.setFlexGrow(1)
  body.setOverflow(Overflow.Hidden)
  panel.insertChild(body, 1)
  const scroll = box()
  scroll.setFlexGrow(1)
  scroll.setOverflow(Overflow.Scroll)
  scroll.setPadding(Edge.Horizontal, 1)
  body.insertChild(scroll, 0)
  const content = box()
  content.setFlexGrow(1)
  content.setFlexShrink(0)
  content.setWidthPercent(100)
  scroll.insertChild(content, 0)
  for (let i = 0; i < 40; i++) content.insertChild(text(100, 80).node, i)

  const layout = () => root.calculateLayout(200, 50, Direction.LTR)
  return { list, rows, body, scroll, content, layout }
}

test('a scroll box keeps its viewport height when only the header above it re-renders', () => {
  const { list, rows, body, scroll, content, layout } = sidebar()
  layout()
  expect(scroll.getComputedHeight()).toBe(body.getComputedHeight())

  const extra = box()
  extra.insertChild(text(1).node, 0)
  list.insertChild(extra, 0)
  layout()

  for (let pass = 0; pass < 3; pass++) {
    for (const row of rows) row.setHeight(1)
    layout()
    expect(scroll.getComputedHeight()).toBe(body.getComputedHeight())
    expect(body.getComputedHeight()).toBeLessThan(50)
    expect(content.getComputedHeight()).toBe(4000)
  }
})
