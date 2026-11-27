// Split view: tasks opened beside the main conversation. The main task holds column 0, row 0; every
// extra pane names a task and a cell. A column holds one pane, or two stacked (row 0 above row 1).

export type PanePos = { col: number; row: 0 | 1 }
export type SplitTask = { cwd: string; id: string }
export type SplitPane = SplitTask & { pos: PanePos }
export type SplitLayout = {
  panes: SplitPane[]
  // Relative column widths, one per column; reset to equal whenever the column count changes.
  weights: number[]
  // The share of a stacked column's height given to its upper pane; one value for every column.
  rowSplit: number
  // 0 for the primary pane, 1..panes.length for extra panes.
  focusedIndex: number
  // Extra panes temporarily hidden while the window is too narrow for split view.
  parkedPanes?: SplitPane[]
  constrained?: boolean
}
// "left" opens the task as the new main task in a new first column; "above" opens it as the main task with
// the current one moved below it. Both need a main task that has been saved.
export type SplitTarget = { kind: "cell"; pos: PanePos } | { kind: "left" } | { kind: "above" }
export type MoveDir = "left" | "right" | "up" | "down"

const STORAGE_KEY = "noa-agent.splitView"
export const ROW_SPLIT = { min: 0.15, max: 0.85, default: 0.5 }
export const COLUMN_MIN_WIDTH = 360
export const SPLIT_CONSTRAINED_WIDTH = COLUMN_MIN_WIDTH * 2
const MAX_COLUMNS = 5

const emptyLayout: SplitLayout = { panes: [], weights: [], rowSplit: ROW_SPLIT.default, focusedIndex: 0 }

function validPanes(raw: unknown): SplitPane[] {
  if (!Array.isArray(raw)) return []
  return (raw as SplitPane[]).filter(
    (pane) =>
      typeof pane?.cwd === "string" &&
      typeof pane.id === "string" &&
      Number.isInteger(pane.pos?.col) &&
      pane.pos.col >= 0 &&
      (pane.pos.row === 0 || pane.pos.row === 1),
  )
}

export function loadSplitLayout(): SplitLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (!saved || !Array.isArray(saved.panes)) return emptyLayout
    const panes = validPanes(saved.panes)
    const layout = withPanes(emptyLayout, panes, 0)
    const weights =
      Array.isArray(saved.weights) &&
      saved.weights.length === layout.weights.length &&
      saved.weights.every((w: unknown) => typeof w === "number" && w > 0)
        ? saved.weights
        : layout.weights
    const rowSplit =
      typeof saved.rowSplit === "number" && layout.panes.some((pane) => pane.pos.row === 1)
        ? clamp(saved.rowSplit, ROW_SPLIT.min, ROW_SPLIT.max)
        : ROW_SPLIT.default
    return { ...layout, weights, rowSplit, focusedIndex: 0 }
  } catch {
    return emptyLayout
  }
}

export function saveSplitLayout(layout: SplitLayout) {
  try {
    // While the window is narrow, save the layout it would restore to: the parked panes plus any opened since.
    const { panes } = layout.constrained ? setSplitConstrained(layout, false, undefined, MAX_COLUMNS) : layout
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ panes, weights: layout.weights, rowSplit: layout.rowSplit }),
    )
  } catch {
    /* Storage unavailable. */
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function maxColumnsFor(width: number) {
  return clamp(Math.floor(width / COLUMN_MIN_WIDTH) || 1, 1, MAX_COLUMNS)
}

export function columnCount(panes: SplitPane[]) {
  return panes.reduce((count, pane) => Math.max(count, pane.pos.col + 1), 1)
}

export function sameTask(a: SplitTask, b: SplitTask) {
  return a.cwd === b.cwd && a.id === b.id
}

export function samePos(a: PanePos, b: PanePos) {
  return a.col === b.col && a.row === b.row
}

export function paneAt(panes: SplitPane[], pos: PanePos) {
  return panes.findIndex((pane) => pane.pos.col === pos.col && pane.pos.row === pos.row)
}

export function isColStacked(panes: SplitPane[], col: number) {
  return panes.some((pane) => pane.pos.col === col && pane.pos.row === 1)
}

export function sortedPanes(panes: SplitPane[]) {
  return panes
    .map((pane, index) => ({ pane, paneIndex: index + 1 }))
    .sort((a, b) => a.pane.pos.col - b.pane.pos.col || a.pane.pos.row - b.pane.pos.row)
}

export function paneIndexOf(panes: SplitPane[], task: SplitTask, primary?: SplitTask): number | undefined {
  if (primary && sameTask(task, primary)) return 0
  const idx = panes.findIndex((pane) => sameTask(pane, task))
  return idx === -1 ? undefined : idx + 1
}

export function posOfPane(panes: SplitPane[], paneIndex: number): PanePos | undefined {
  if (paneIndex === 0) return { col: 0, row: 0 }
  return panes[paneIndex - 1]?.pos
}

// Closes the gaps a removal leaves: columns renumber from 0 with none empty, and a column's lone pane sits on
// row 0 (column 0 excepted, whose row 0 is the main task).
function normalize(panes: SplitPane[]): SplitPane[] {
  const cleaned: SplitPane[] = []
  for (const pane of panes) {
    if (pane.pos.col === 0 && pane.pos.row === 0) {
      if (!isColStacked(panes, 0) && !isColStacked(cleaned, 0)) {
        cleaned.push({ ...pane, pos: { col: 0, row: 1 } })
      }
    } else {
      cleaned.push(pane)
    }
  }
  const cols = [...new Set([0, ...cleaned.map((pane) => pane.pos.col)])].sort((a, b) => a - b)
  const renumbered = cleaned.map((pane) => ({ ...pane, pos: { col: cols.indexOf(pane.pos.col), row: pane.pos.row } }))
  return renumbered.map((pane) =>
    pane.pos.col > 0 && pane.pos.row === 1 && paneAt(renumbered, { col: pane.pos.col, row: 0 }) === -1
      ? { ...pane, pos: { col: pane.pos.col, row: 0 as const } }
      : pane,
  )
}

function withPanes(layout: SplitLayout, panes: SplitPane[], focusedIndex = layout.focusedIndex): SplitLayout {
  const next = normalize(panes)
  const count = columnCount(next)
  const weights = count === layout.weights.length ? layout.weights : Array.from({ length: count }, () => 1)
  // With no stacked pane left the rows reset, so the next stack starts even.
  const rowSplit = next.some((pane) => pane.pos.row === 1) ? layout.rowSplit : ROW_SPLIT.default
  return {
    ...layout,
    panes: next,
    weights,
    rowSplit,
    focusedIndex: clamp(focusedIndex, 0, next.length),
  }
}

export function setFocusedPane(layout: SplitLayout, paneIndex: number): SplitLayout {
  const next = clamp(paneIndex, 0, layout.panes.length)
  return next === layout.focusedIndex ? layout : { ...layout, focusedIndex: next }
}

export function removePane(layout: SplitLayout, task: SplitTask): SplitLayout {
  const idx = layout.panes.findIndex((pane) => sameTask(pane, task))
  if (idx === -1) return layout
  const removedPaneIndex = idx + 1
  const nextFocus =
    removedPaneIndex < layout.focusedIndex
      ? layout.focusedIndex - 1
      : Math.min(layout.focusedIndex, layout.panes.length - 1)
  return withPanes(
    layout,
    layout.panes.filter((_, i) => i !== idx),
    nextFocus,
  )
}

// Closes the primary pane by promoting the first extra pane in reading order to become the new primary.
export function closePrimaryPane(layout: SplitLayout): { layout: SplitLayout; promoted: SplitTask } | undefined {
  const ordered = sortedPanes(layout.panes)
  const first = ordered[0]
  if (!first) return undefined
  const idx = first.paneIndex - 1
  const pos = first.pane.pos
  // If the promoted pane sat at row 0 of a stacked column and col 0 has no row 1, pull its lower neighbor to (0, 1).
  let nextPanes = layout.panes.slice()
  if (pos.row === 0 && !isColStacked(nextPanes, 0)) {
    const belowIdx = paneAt(nextPanes, { col: pos.col, row: 1 })
    if (belowIdx !== -1) nextPanes[belowIdx] = { ...nextPanes[belowIdx]!, pos: { col: 0, row: 1 } }
  }
  nextPanes = nextPanes.filter((_, i) => i !== idx)
  return {
    layout: withPanes(layout, nextPanes, 0),
    promoted: { cwd: first.pane.cwd, id: first.pane.id },
  }
}

export function nextAvailableSlot(panes: SplitPane[], maxColumns: number): PanePos | undefined {
  const count = columnCount(panes)
  if (count < maxColumns) return { col: count, row: 0 }
  for (let col = 0; col < count; col++) {
    if (!isColStacked(panes, col)) return { col, row: 1 }
  }
  return undefined
}

// Opens a task in split view (used by Alt+Click and the sidebar context menu). Focuses it if already open.
export function openTaskInSplit(
  layout: SplitLayout,
  task: SplitTask,
  primary: SplitTask | undefined,
  maxColumns: number,
): SplitLayout {
  const existing = paneIndexOf(layout.panes, task, primary)
  if (existing !== undefined) return setFocusedPane(layout, existing)
  const slot = nextAvailableSlot(layout.panes, maxColumns)
  if (slot) {
    const next = withPanes(layout, [...layout.panes, { ...task, pos: slot }])
    const newIndex = next.panes.findIndex((pane) => sameTask(pane, task))
    return setFocusedPane(next, newIndex === -1 ? 0 : newIndex + 1)
  }
  // When full, replace the last pane in reading order.
  const last = sortedPanes(layout.panes).at(-1)
  if (!last) return layout
  const next = withPanes(
    layout,
    layout.panes.map((pane, i) => (i === last.paneIndex - 1 ? { ...task, pos: pane.pos } : pane)),
    last.paneIndex,
  )
  return next
}

// Opens `task` at `target`. Returns the new layout and, for "left" and "above", the task that becomes the main
// one; the current main task then moves into a pane. Undefined when the task is already open or the drop cannot apply.
export function placeTask(
  layout: SplitLayout,
  task: SplitTask,
  target: SplitTarget,
  primary: SplitTask | undefined,
  maxColumns: number,
): { layout: SplitLayout; primary?: SplitTask } | undefined {
  const panes = layout.panes
  if ((primary && sameTask(task, primary)) || panes.some((pane) => sameTask(pane, task))) return undefined
  const count = columnCount(panes)
  if (target.kind === "cell") {
    let pos = target.pos
    if (pos.col >= count) {
      pos =
        count < maxColumns
          ? { col: count, row: 0 }
          : { col: count - 1, row: paneAt(panes, { col: count - 1, row: 1 }) === -1 ? 1 : 0 }
    }
    if (pos.col > 0 && pos.row === 1 && paneAt(panes, { col: pos.col, row: 0 }) === -1) pos = { col: pos.col, row: 0 }
    if (pos.col === 0 && pos.row === 0) pos = { col: 0, row: 1 }
    const occupied = paneAt(panes, pos)
    const nextPanes = [...panes.filter((_, index) => index !== occupied), { ...task, pos }]
    const next = withPanes(layout, nextPanes)
    const newIdx = next.panes.findIndex((pane) => sameTask(pane, task))
    return { layout: setFocusedPane(next, newIdx === -1 ? 0 : newIdx + 1) }
  }
  if (!primary) return undefined
  if (target.kind === "left") {
    if (count >= maxColumns) return undefined
    const shifted = panes.map((pane) => ({ ...pane, pos: { col: pane.pos.col + 1, row: pane.pos.row } }))
    return { layout: withPanes(layout, [...shifted, { ...primary, pos: { col: 1, row: 0 } }], 0), primary: task }
  }
  if (paneAt(panes, { col: 0, row: 1 }) !== -1) return undefined
  return { layout: withPanes(layout, [...panes, { ...primary, pos: { col: 0, row: 1 } }], 0), primary: task }
}

// Makes a pane's task the main one; the main task takes the pane's cell (leaving any pane that held it aside), or
// the pane closes when the main task has not been saved yet.
export function promotePane(layout: SplitLayout, task: SplitTask, primary: SplitTask | undefined): SplitLayout {
  const panes = primary ? layout.panes.filter((pane) => !sameTask(pane, primary)) : layout.panes
  return withPanes(
    layout,
    panes.flatMap((pane) => (!sameTask(pane, task) ? [pane] : primary ? [{ ...primary, pos: pane.pos }] : [])),
    0,
  )
}

// Moves or swaps an already-open pane (primary or extra) to `target`.
export function moveOrSwapPane(
  layout: SplitLayout,
  sourcePaneIndex: number,
  target: PanePos,
  primary: SplitTask | undefined,
  maxColumns: number,
): { layout: SplitLayout; promoted?: SplitTask } | undefined {
  const panes = layout.panes
  const count = columnCount(panes)
  const sourcePos = posOfPane(panes, sourcePaneIndex)
  if (!sourcePos || samePos(sourcePos, target)) return undefined

  // Moving primary pane (0, 0) to another cell or new column.
  if (sourcePaneIndex === 0) {
    if (!primary) return undefined
    const targetIdx = paneAt(panes, target)
    if (targetIdx !== -1) {
      // Swap primary with the pane at target.
      const promoted = panes[targetIdx]!
      const nextPanes = panes.map((pane, i) => (i === targetIdx ? { ...primary, pos: target } : pane))
      const next = withPanes(layout, nextPanes)
      const movedIdx = next.panes.findIndex((pane) => sameTask(pane, primary))
      return {
        layout: setFocusedPane(next, movedIdx === -1 ? 0 : movedIdx + 1),
        promoted: { cwd: promoted.cwd, id: promoted.id },
      }
    }
    // Move primary to an empty cell: promote the first extra pane into (0, 0).
    const first = sortedPanes(panes)[0]
    if (!first) return undefined
    if (target.col >= count && count >= maxColumns) return undefined
    const promoteIdx = first.paneIndex - 1
    const nextPanes = panes.map((pane, i) => (i === promoteIdx ? { ...primary, pos: target } : pane))
    const next = withPanes(layout, nextPanes)
    const movedIdx = next.panes.findIndex((pane) => sameTask(pane, primary))
    return {
      layout: setFocusedPane(next, movedIdx === -1 ? 0 : movedIdx + 1),
      promoted: { cwd: first.pane.cwd, id: first.pane.id },
    }
  }

  // Moving an extra pane.
  const srcIdx = sourcePaneIndex - 1
  const srcPane = panes[srcIdx]
  if (!srcPane) return undefined

  // Dropping an extra pane onto primary (0, 0): swap with primary.
  if (target.col === 0 && target.row === 0) {
    if (!primary) {
      return { layout: removePane(layout, srcPane), promoted: { cwd: srcPane.cwd, id: srcPane.id } }
    }
    const nextPanes = panes.map((pane, i) => (i === srcIdx ? { ...primary, pos: srcPane.pos } : pane))
    return {
      layout: withPanes(layout, nextPanes, 0),
      promoted: { cwd: srcPane.cwd, id: srcPane.id },
    }
  }

  const targetIdx = paneAt(panes, target)
  if (targetIdx !== -1) {
    // Swap two extra panes.
    const nextPanes = panes.map((pane, i) =>
      i === srcIdx ? { ...pane, pos: target } : i === targetIdx ? { ...pane, pos: srcPane.pos } : pane,
    )
    const next = withPanes(layout, nextPanes)
    const movedIdx = next.panes.findIndex((pane) => sameTask(pane, srcPane))
    return { layout: setFocusedPane(next, movedIdx === -1 ? 0 : movedIdx + 1) }
  }

  // Move to an empty slot or new column.
  const aloneInCol = srcPane.pos.col > 0 && panes.every((pane, i) => i === srcIdx || pane.pos.col !== srcPane.pos.col)
  if (target.col >= count && count >= maxColumns && !aloneInCol) return undefined
  const nextPanes = panes.map((pane, i) => (i === srcIdx ? { ...pane, pos: target } : pane))
  const next = withPanes(layout, nextPanes)
  const movedIdx = next.panes.findIndex((pane) => sameTask(pane, srcPane))
  return { layout: setFocusedPane(next, movedIdx === -1 ? 0 : movedIdx + 1) }
}

// Available directional moves for a pane (for the context menu's Move submenu).
export function moveTargetsForPane(
  panes: SplitPane[],
  paneIndex: number,
  maxColumns: number,
  primarySaved: boolean,
): { dir: MoveDir; label: string; target: PanePos }[] {
  const pos = posOfPane(panes, paneIndex)
  if (!pos || panes.length === 0) return []
  if (paneIndex === 0 && !primarySaved) return []
  const count = columnCount(panes)
  const out: { dir: MoveDir; label: string; target: PanePos }[] = []
  if (pos.col > 0) {
    out.push({ dir: "left", label: "Move left", target: { col: pos.col - 1, row: pos.row } })
  }
  if (pos.col < count - 1) {
    out.push({ dir: "right", label: "Move right", target: { col: pos.col + 1, row: pos.row } })
  } else if (count < maxColumns && (pos.col === 0 ? isColStacked(panes, 0) : isColStacked(panes, pos.col))) {
    out.push({ dir: "right", label: "Move right", target: { col: count, row: 0 } })
  }
  if (pos.row === 1) {
    out.push({ dir: "up", label: "Move up", target: { col: pos.col, row: 0 } })
  }
  if (pos.row === 0 && (isColStacked(panes, pos.col) || count > 1)) {
    out.push({ dir: "down", label: "Move down", target: { col: pos.col, row: 1 } })
  }
  return out
}

// Spatial focus navigation between panes (the focusPane* shortcuts).
export function adjacentPaneIndex(
  panes: SplitPane[],
  focusedIndex: number,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): number | undefined {
  if (panes.length === 0) return undefined
  const current = posOfPane(panes, clamp(focusedIndex, 0, panes.length))
  if (!current) return undefined
  const count = columnCount(panes)
  let target: PanePos | undefined
  if (key === "ArrowLeft" && current.col > 0) target = { col: current.col - 1, row: current.row }
  else if (key === "ArrowRight" && current.col < count - 1) target = { col: current.col + 1, row: current.row }
  else if (key === "ArrowUp" && current.row === 1) target = { col: current.col, row: 0 }
  else if (key === "ArrowDown" && current.row === 0) target = { col: current.col, row: 1 }
  if (!target) return undefined
  const lookup = (pos: PanePos) => {
    if (pos.col === 0 && pos.row === 0) return 0
    const idx = paneAt(panes, pos)
    return idx === -1 ? undefined : idx + 1
  }
  return lookup(target) ?? (target.row === 1 ? lookup({ col: target.col, row: 0 }) : undefined)
}

export function cyclePaneIndex(panes: SplitPane[], focusedIndex: number, delta: 1 | -1): number {
  if (panes.length === 0) return 0
  const order = [0, ...sortedPanes(panes).map((item) => item.paneIndex)]
  const cur = order.indexOf(clamp(focusedIndex, 0, panes.length))
  const next = ((cur === -1 ? 0 : cur) + delta + order.length) % order.length
  return order[next]!
}

// Parks extra panes while the viewport is too narrow for split view, restoring them when widened again. Tasks
// opened in split while narrow join the restored panes.
export function setSplitConstrained(
  layout: SplitLayout,
  constrained: boolean,
  primary: SplitTask | undefined,
  maxColumns: number,
): SplitLayout {
  if (!!layout.constrained === constrained) return layout
  if (constrained) {
    if (layout.panes.length === 0) return { ...layout, constrained: true, focusedIndex: 0 }
    return { ...layout, constrained: true, parkedPanes: layout.panes, panes: [], focusedIndex: 0 }
  }
  const parked = layout.parkedPanes
  if (!parked?.length) return { ...layout, constrained: false, parkedPanes: undefined }
  const filtered = primary ? parked.filter((pane) => !sameTask(pane, primary)) : parked
  const opened = layout.panes.filter((pane) => !filtered.some((parkedPane) => sameTask(parkedPane, pane)))
  return opened.reduce(
    (restored, pane) => openTaskInSplit(restored, pane, primary, maxColumns),
    withPanes({ ...layout, constrained: false, parkedPanes: undefined }, filtered, 0),
  )
}

// The share a row may take: each pane keeps at least 320px, and below 640px the rows stay even.
export function rowSplitFor(rowSplit: number, height: number) {
  const min = Math.max(ROW_SPLIT.min, 320 / Math.max(1, height))
  return min < 0.5 ? clamp(rowSplit, min, 1 - min) : 0.5
}

export type SplitHover = { target: SplitTarget; label: string; rect: { left: number; top: number; width: number; height: number } }
export type PaneDragHover = { target: PanePos; label: "Swap" | "Move here"; rect: { left: number; top: number; width: number; height: number } }

// Where a task dragged from the sidebar would open, read from the pane columns under the pointer, and the area
// the drop overlay highlights (relative to the pane host).
export function findSplitTarget(x: number, y: number, layout: SplitLayout, primarySaved: boolean): SplitHover | undefined {
  const host = document.querySelector<HTMLElement>("[data-pane-host]")
  if (!host) return undefined
  const box = host.getBoundingClientRect()
  if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return undefined
  const cols = [...host.querySelectorAll<HTMLElement>(":scope > [data-pane-col]")].map((col) => col.getBoundingClientRect())
  const n = cols.length
  if (!n) return undefined
  let f = cols.findIndex((rect) => x >= rect.left && x < rect.right)
  if (f === -1) f = x < cols[0]!.left ? 0 : n - 1
  const col = cols[f]!
  // Just past the sidebar edge the drag is still leaving the sidebar.
  if (f === 0 && x < col.left + 16) return undefined
  const canAdd = n < maxColumnsFor(box.width)
  const split = layout.rowSplit
  const localX = (x - col.left) / col.width
  const localY = y - col.top
  const boundary = col.height * split
  const lowerHalf = localY >= boundary
  const stacked = f === 0 || paneAt(layout.panes, { col: f, row: 1 }) !== -1
  const rel = (top: number, height: number) => ({ left: col.left - box.left, top: top - box.top, width: col.width, height })
  const strip = (side: "left" | "right") => {
    const width = box.width / (n + 1)
    return { left: side === "left" ? 0 : box.width - width, top: 0, width, height: box.height }
  }
  const cell = (row: 0 | 1): SplitHover => ({
    target: { kind: "cell", pos: { col: f, row } },
    label: paneAt(layout.panes, { col: f, row }) !== -1 ? "Open here" : "Split view",
    rect: row === 1 ? rel(col.top + boundary, col.height - boundary) : rel(col.top, stacked ? boundary : col.height),
  })
  const zones: { score: number; hover: SplitHover }[] = []
  if (f === 0 && canAdd && primarySaved) zones.push({ score: localX, hover: { target: { kind: "left" }, label: "Split view", rect: strip("left") } })
  if (f === n - 1 && canAdd) zones.push({ score: 1 - localX, hover: { target: { kind: "cell", pos: { col: n, row: 0 } }, label: "Split view", rect: strip("right") } })
  if (!lowerHalf) {
    const score = localY / boundary / 2
    if (f > 0) zones.push({ score, hover: cell(0) })
    else if (primarySaved && paneAt(layout.panes, { col: 0, row: 1 }) === -1) {
      zones.push({ score, hover: { target: { kind: "above" }, label: "Split view", rect: rel(col.top, boundary) } })
    }
  } else {
    zones.push({ score: (col.height - localY) / (col.height - boundary) / 2, hover: cell(1) })
  }
  return zones.sort((a, b) => a.score - b.score)[0]?.hover
}

// Drop target when dragging an already-open pane to move or swap it.
export function findPaneDragTarget(
  x: number,
  y: number,
  layout: SplitLayout,
  sourcePaneIndex: number,
): PaneDragHover | undefined {
  const host = document.querySelector<HTMLElement>("[data-pane-host]")
  if (!host) return undefined
  const box = host.getBoundingClientRect()
  if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return undefined
  const cols = [...host.querySelectorAll<HTMLElement>(":scope > [data-pane-col]")].map((col) => col.getBoundingClientRect())
  const n = cols.length
  if (!n) return undefined
  let f = cols.findIndex((rect) => x >= rect.left && x < rect.right)
  if (f === -1) f = x < cols[0]!.left ? 0 : n - 1
  const col = cols[f]!
  const sourcePos = posOfPane(layout.panes, sourcePaneIndex)
  if (!sourcePos) return undefined
  const canAdd = n < maxColumnsFor(box.width)
  const localX = (x - col.left) / col.width
  const localY = y - col.top
  const boundary = col.height * layout.rowSplit
  const row: 0 | 1 = localY >= boundary ? 1 : 0

  // Near the right edge of the last column: open as a new rightmost column if room allows.
  if (f === n - 1 && canAdd && localX > 0.78 && !(sourcePos.col === n - 1 && !isColStacked(layout.panes, n - 1))) {
    const width = box.width / (n + 1)
    return {
      target: { col: n, row: 0 },
      label: "Move here",
      rect: { left: box.width - width, top: 0, width, height: box.height },
    }
  }

  const target: PanePos = { col: f, row }
  if (samePos(sourcePos, target)) return undefined
  const occupied = (target.col === 0 && target.row === 0) || paneAt(layout.panes, target) !== -1
  const stacked = isColStacked(layout.panes, f) || target.row === 1
  return {
    target,
    label: occupied ? "Swap" : "Move here",
    rect: {
      left: col.left - box.left,
      top: target.row === 1 ? boundary : 0,
      width: col.width,
      height: target.row === 1 ? col.height - boundary : stacked ? boundary : col.height,
    },
  }
}
