import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { AgentState, AgentTask, Block, ToolBlock, Turn } from "../agent/reducer"
import type { ImageBlock, TurnDiff } from "../agent/protocol"
import { Lightbox, type LightboxItem } from "./Lightbox"
import {
  formatElapsed,
  groupActivityBlocks,
  groupActivityRuns,
  toolActivityLabel,
  toolActivitySummary,
  toolElapsedMs,
  type ActivityRun,
  type ThinkingBlock as ThinkingBlockData,
} from "../agent/toolActivity"
import { ArrowDown, AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, Copy, Edit2, Photo, Terminal, Tool } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { ErrorBoundary } from "./ErrorBoundary"
import { copyContent } from "./RichContent"
import { Markdown, OutputContext } from "./Markdown"
import { MessageRail, type MessageRailItem } from "./MessageRail"
import { ToolCard } from "./ToolCard"
import { LiveDiffSummary, TurnDiffCard } from "./TurnDiffCard"

interface MessageListProps {
  turns: Turn[]
  cwd?: string
  onOpenFile?: (path: string, line?: number, endLine?: number) => void
  busy: boolean
  result?: AgentState["result"]
  readingWidth: number
  liveDiff?: TurnDiff
  onTurnDiff?: (diff: TurnDiff, path?: string) => void
  onTurnDiffAction?: (diff: TurnDiff, action: "undo" | "reapply") => void
  diffActionPending?: number
  onRetry?: () => void
  onEdit?: (text: string, images?: ImageBlock[]) => void
  onQuote?: (text: string) => void
  tasks?: AgentTask[]
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
  sessionId?: string
  historyBefore?: number
  historyLoading?: boolean
  onLoadEarlier?: () => void
}

// Follows the bottom while the user is near it; a scroll away releases the pin.
const PIN_THRESHOLD = 24
const JUMP_THRESHOLD = 24
const TURN_GAP = 16
const TURN_OVERSCAN = 2
const ESTIMATED_TURN_HEIGHT = 160
const scrollPositions = new Map<string, { top: number; pinned: boolean; heights: Map<string, number> }>()

export function MessageList({ turns, cwd, onOpenFile, busy, result, readingWidth, liveDiff, onTurnDiff, onTurnDiffAction, diffActionPending, onRetry, onEdit, onQuote, tasks, onStopTask, onOpenTask, sessionId, historyBefore, historyLoading, onLoadEarlier }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const scrollKey = sessionId ? `${cwd}:${sessionId}` : undefined
  const savedScroll = scrollKey ? scrollPositions.get(scrollKey) : undefined
  const pinnedRef = useRef(savedScroll?.pinned ?? true)
  const restoredRef = useRef(false)
  const firstTurnRef = useRef(turns[0]?.id)
  const previousLayoutOffset = useRef(0)
  const scrollFrame = useRef<number | undefined>(undefined)
  const heightsRef = useRef(new Map(savedScroll?.heights))
  const offsetsRef = useRef(new Map<string, number>())
  const focusedTurn = useRef<string | undefined>(undefined)
  const pendingPrevious = useRef<string | undefined>(undefined)
  const jumpToken = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const [selection, setSelection] = useState<{ text: string; left: number; top: number }>()
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number }>()
  const [viewport, setViewport] = useState({ top: savedScroll?.top ?? 0, height: 0 })
  const [, setMeasured] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const previousFirst = firstTurnRef.current
    const offset = layoutRef.current?.offsetTop ?? 0
    if (previousFirst && previousFirst !== turns[0]?.id && offsetsRef.current.has(previousFirst) && !pinnedRef.current)
      el.scrollTop += offsetsRef.current.get(previousFirst)! + offset - previousLayoutOffset.current
    firstTurnRef.current = turns[0]?.id
    previousLayoutOffset.current = offset
    if (!restoredRef.current && savedScroll && !savedScroll.pinned) el.scrollTop = savedScroll.top
    restoredRef.current = true
    if (pinnedRef.current) el.scrollTop = el.scrollHeight
    setViewport({ top: el.scrollTop, height: el.clientHeight })
  }, [turns])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setViewport({ top: el.scrollTop, height: el.clientHeight })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current)
    }
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    return () => {
      if (!scrollKey || !element) return
      scrollPositions.delete(scrollKey)
      scrollPositions.set(scrollKey, { top: element.scrollTop, pinned: pinnedRef.current, heights: new Map(heightsRef.current) })
      if (scrollPositions.size > 30) scrollPositions.delete(scrollPositions.keys().next().value!)
    }
  }, [scrollKey])

  function captureSelection() {
    const selected = window.getSelection()
    if (!onQuote || !selected || selected.isCollapsed || !selected.rangeCount) { setSelection(undefined); return }
    const node = selected.anchorNode?.parentElement?.closest("[data-response-content]")
    if (!node || !node.contains(selected.focusNode)) { setSelection(undefined); return }
    const text = selected.toString()
    if (!text.trim()) { setSelection(undefined); return }
    const rect = selected.getRangeAt(0).getBoundingClientRect()
    setSelection({ text, left: Math.min(rect.left, window.innerWidth - 160), top: Math.min(rect.bottom + 8, window.innerHeight - 48) })
  }

  function onScroll() {
    setSelection(undefined)
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop < 80 && historyBefore && !historyLoading) onLoadEarlier?.()
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinnedRef.current = distance <= PIN_THRESHOLD
    setShowJump(distance > JUMP_THRESHOLD)
    if (scrollFrame.current === undefined) {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = undefined
        setViewport({ top: el.scrollTop, height: el.clientHeight })
      })
    }
  }

  function jumpToBottom() {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = true
    el.scrollTop = el.scrollHeight
    setViewport({ top: el.scrollTop, height: el.clientHeight })
    setShowJump(false)
  }

  const segments = groupTurns(turns)
  const layout = layoutTurns(segments, heightsRef.current)
  const layoutHeight = layout.length ? layout[layout.length - 1]!.top + layout[layout.length - 1]!.height : 0
  const visible = visibleTurnRange(
    layout,
    pinnedRef.current ? Math.max(0, layoutHeight - (viewport.height || 800)) : viewport.top,
    viewport.height || 800,
    TURN_OVERSCAN,
  )
  offsetsRef.current = new Map(layout.map((row) => [row.segment.id, row.top]))
  const measureTurn = useCallback((id: string, height: number) => {
    const previousHeight = heightsRef.current.get(id)
    if (previousHeight === height) return
    heightsRef.current.set(id, height)
    const el = scrollRef.current
    if (el && !pinnedRef.current) {
      const top = offsetsRef.current.get(id)
      if (top !== undefined && top < el.scrollTop) el.scrollTop += height - (previousHeight ?? ESTIMATED_TURN_HEIGHT)
    }
    setMeasured((value) => value + 1)
    if (pinnedRef.current) requestAnimationFrame(() => {
      const scroller = scrollRef.current
      if (!scroller) return
      scroller.scrollTop = scroller.scrollHeight
      setViewport({ top: scroller.scrollTop, height: scroller.clientHeight })
    })
  }, [])
  const visibleRows = layout.slice(visible.start, visible.end)
  const focusedRow = layout.find((row) => row.segment.id === focusedTurn.current)
  if (focusedRow && !visibleRows.some((row) => row.segment.id === focusedRow.segment.id)) {
    visibleRows.push(focusedRow)
    visibleRows.sort((a, b) => a.index - b.index)
  }

  const lastUserIndex = segments.reduce((last, segment, index) => segment.role === "user" ? index : last, -1)

  // The rail previews each prompt with the final answer of the reply that follows it, as Codex does.
  const railItems: MessageRailItem[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    if (segment.role !== "user") continue
    const reply = segments[index + 1]
    let preview = ""
    if (reply?.role === "assistant") {
      for (let blockIndex = reply.blocks.length - 1; blockIndex >= 0; blockIndex--) {
        const block = reply.blocks[blockIndex]!
        if (block.kind !== "text") continue
        // The card clamps to three lines; copying only the head keeps streaming cheap.
        const start = block.text.search(/\S/)
        if (start === -1) continue
        preview = block.text.slice(start, start + 800).trimEnd()
        break
      }
    }
    railItems.push({
      id: segment.id,
      label: firstLine(segment.text) || "(No content)",
      preview,
    })
  }
  // Every user message crossing the viewport is active, as Codex marks the whole
  // visible range; when none is visible, the prompt the reader has passed stays lit.
  const layoutOffset = layoutRef.current?.offsetTop ?? 32
  const railTop = viewport.top
  const railBottom = viewport.top + (viewport.height || 800)
  const activeRailIds: string[] = []
  for (const row of layout) {
    if (row.segment.role !== "user") continue
    const top = row.top + layoutOffset
    if (top < railBottom && top + row.height > railTop + 16) activeRailIds.push(row.segment.id)
  }
  if (!activeRailIds.length) {
    let passed = railItems[0]?.id
    for (const row of layout) {
      if (row.segment.role === "user" && row.top + layoutOffset <= railTop + 16) passed = row.segment.id
    }
    if (passed) activeRailIds.push(passed)
  }

  function scrollToSegment(id: string, behavior: ScrollBehavior) {
    const scroller = scrollRef.current
    const row = layout.find((candidate) => candidate.segment.id === id)
    if (!scroller || !row) return
    pendingPrevious.current = undefined
    // A newer jump owns the viewport; older align/flash work must stand down.
    const token = ++jumpToken.current
    pinnedRef.current = false
    setShowJump(false)
    scroller.scrollTo({ top: Math.max(0, layoutOffset + row.top), behavior })
    // Offscreen rows are laid out from estimated heights; once the target mounts,
    // snap to its measured top so the prompt lands flush with the viewport edge.
    const align = (attempt = 0) => {
      if (token !== jumpToken.current) return
      const target = scroller.querySelector<HTMLElement>(`[data-virtual-turn-id="${cssEscape(id)}"]`)
      if (!target) {
        if (attempt < 40) requestAnimationFrame(() => align(attempt + 1))
        return
      }
      const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      if (Math.abs(delta) > 1) {
        scroller.scrollTop += delta
        if (attempt < 4) requestAnimationFrame(() => align(attempt + 1))
      }
    }
    if (behavior === "smooth") {
      const onEnd = () => align()
      scroller.addEventListener("scrollend", onEnd, { once: true })
      window.setTimeout(() => scroller.removeEventListener("scrollend", onEnd), 1200)
    } else {
      requestAnimationFrame(() => align())
    }
    const reduced = document.documentElement.dataset.reduceMotion === "true"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const deadline = performance.now() + 1500
    const flash = () => {
      if (token !== jumpToken.current) return
      const bubble = scrollRef.current?.querySelector<HTMLElement>(
        `[data-virtual-turn-id="${cssEscape(id)}"] [data-user-message-bubble]`,
      )
      if (bubble) {
        bubble.animate([
          { backgroundColor: "color-mix(in srgb, var(--accent-color) 26%, transparent)" },
          { backgroundColor: "color-mix(in srgb, var(--accent-color) 26%, transparent)", offset: 0.35 },
          { backgroundColor: "color-mix(in srgb, var(--accent-color) 8%, transparent)" },
        ], { duration: reduced ? 0 : 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" })
        return
      }
      if (performance.now() < deadline) requestAnimationFrame(flash)
    }
    requestAnimationFrame(flash)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented || !["ArrowUp", "ArrowDown"].includes(event.key)) return
      const target = event.target instanceof Element ? event.target : null
      const composer = target?.matches('textarea[aria-label="Task instruction"]')
      if (target?.closest("[role=dialog], [role=menu], .noa-code-view") || document.querySelector("dialog[open]")) return
      if (!composer && target?.closest("input, textarea, select, [contenteditable]")) return
      if (target && target !== document.body && !composer && !target.closest(".noa-agent-scroll, .noa-message-rail")) return
      const current = railItems.findIndex(item => item.id === activeRailIds[0])
      const next = current + (event.key === "ArrowUp" ? -1 : 1)
      if (next < 0 && historyBefore && onLoadEarlier) {
        event.preventDefault(); pendingPrevious.current = railItems[0]?.id; onLoadEarlier(); return
      }
      const item = railItems[next]
      if (!item) return
      event.preventDefault()
      scrollToSegment(item.id, "auto")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [railItems, activeRailIds, historyBefore, onLoadEarlier])

  useLayoutEffect(() => {
    const id = pendingPrevious.current
    if (!id) return
    const index = railItems.findIndex(item => item.id === id)
    if (index > 0) { pendingPrevious.current = undefined; scrollToSegment(railItems[index - 1]!.id, "auto") }
  }, [turns])

  function renderSegment(segment: Segment, index: number) {
    if (segment.role === "user") {
      return (
        <div className="group/message flex flex-col items-end gap-1">
          {segment.images?.length ? <MessageImages images={segment.images} onOpen={(items, imageIndex) => setPreview({ items, index: imageIndex })} /> : null}
          {segment.text && <UserBubble text={segment.text} />}
          <MessageActions
            text={segment.text}
            kind="user"
            onEdit={onEdit && index === lastUserIndex ? () => onEdit(segment.text, segment.images) : undefined}
          />
        </div>
      )
    }
    return (
      <AssistantSegment
        segment={segment}
        busy={busy && index === segments.length - 1}
        durationMs={segment.durationMs ?? (index === segments.length - 1 && !busy ? result?.durationMs : undefined)}
        interrupted={segment.interrupted ?? (index === segments.length - 1 && !busy ? result?.interrupted : undefined)}
        liveDiff={liveDiff}
        tasks={tasks}
        onStopTask={onStopTask}
        onOpenTask={onOpenTask}
        onTurnDiff={onTurnDiff}
        onTurnDiffAction={onTurnDiffAction}
        diffActionPending={diffActionPending}
      />
    )
  }

  return (
    <OutputContext value={{ cwd, onOpenFile, onOpenImages: (items, index) => setPreview({ items, index }) }}><div className="relative flex min-h-0 flex-1 flex-col">
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onWheel={() => { pendingPrevious.current = undefined }}
      onPointerDownCapture={() => { pendingPrevious.current = undefined }}
      onMouseUp={captureSelection}
      onKeyUp={captureSelection}
      onFocusCapture={(event) => {
        const turn = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-virtual-turn-id]") : null
        if (turn?.dataset.virtualTurnId) focusedTurn.current = turn.dataset.virtualTurnId
      }}
      className="noa-agent-scroll noa-scroll-fade relative flex-1 min-h-0 overflow-y-auto overscroll-contain"
    >
      {/* Codex reserves 48px around the transcript column so the rail lives in the
          gutter and its expanded tick never crosses the text on narrow windows. */}
      <div ref={contentRef} className="mx-auto flex flex-col gap-4 px-5 pt-8" style={{ width: "calc(100% - 48px)", maxWidth: readingWidth, paddingBottom: "calc(var(--composer-overlay, 0px) + 32px)" }}>
        {!!historyBefore && <button type="button" disabled={historyLoading} onClick={onLoadEarlier} className="self-center rounded-lg px-3 py-2 text-caption text-[var(--text-secondary)]">{historyLoading ? "Loading earlier messages…" : "Load earlier messages"}</button>}
        <div ref={layoutRef} className="relative w-full" style={{ height: layoutHeight }}>
          {visibleRows.map((row) => (
            <VirtualTurnRow key={row.segment.id} id={row.segment.id} top={row.top} onHeight={measureTurn}>
              <ErrorBoundary resetKey={row.segment.id}>
                <div className="noa-turn-item noa-virtual-turn">{renderSegment(row.segment, row.index)}</div>
              </ErrorBoundary>
            </VirtualTurnRow>
          ))}
        </div>

        {!busy && result?.isError && !result.interrupted && onRetry && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[length:var(--text-chat-sm)] text-[var(--sidebar-text-muted,#898781)]">
            {!turns.some(turn => turn.role === "assistant" && turn.error) && <span className="text-[#C24444]">Finished with an error</span>}
            <button
              type="button"
              onClick={onRetry}
              className="noa-press flex h-6 items-center rounded-md px-1.5 text-caption text-[var(--accent-color)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7.5%,transparent)]"
              title="Send the last message again"
            >
              Retry
            </button>
          </div>
        )}
      </div>

    </div>
      <MessageRail key={sessionId ?? "new"} items={railItems} activeIds={activeRailIds} sessionId={sessionId} onJump={scrollToSegment} />
      {/* Codex's scroll-to-bottom: a 32px round button that fades rather than mounts. */}
      <button
        type="button"
        aria-label="Scroll to bottom"
        aria-hidden={!showJump}
        tabIndex={showJump ? undefined : -1}
        onClick={jumpToBottom}
        data-show={showJump}
        className="noa-scroll-bottom noa-press"
      >
        {/* While the agent works the button shows Codex's working dots; hover swaps back to the arrow. */}
        {busy && <span className="noa-scroll-bottom-dots" aria-hidden="true"><span /><span /><span /></span>}
        <ArrowDown size={14} className={busy ? "noa-scroll-bottom-arrow" : undefined} />
      </button>
      {selection && <button type="button" className="fixed z-50 rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-card)] px-3 py-2 text-caption shadow-lg" style={{ left: selection.left, top: selection.top }} onMouseDown={event => event.preventDefault()} onClick={() => { onQuote?.(selection.text); window.getSelection()?.removeAllRanges(); setSelection(undefined) }}>Quote selection</button>}
      {preview && <Lightbox items={preview.items} index={preview.index} onIndex={(index) => setPreview({ ...preview, index })} onClose={() => setPreview(undefined)} />}
    </div></OutputContext>
  )
}

function MessageImages({ images, onOpen }: {
  images: ImageBlock[]
  onOpen: (items: LightboxItem[], index: number) => void
}) {
  const items = images.map((image, i) => ({
    src: `data:${image.source.media_type};base64,${image.source.data}`,
    alt: `Attached image ${i + 1}`,
  }))
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          aria-label={`Open ${item.alt}`}
          onClick={() => onOpen(items, index)}
          className="cursor-zoom-in overflow-hidden rounded-xl border border-[var(--divider-subtle)] noa-press"
        >
          <img src={item.src} alt={item.alt} className="max-h-56 max-w-64 object-contain" />
        </button>
      ))}
    </div>
  )
}

type AssistantSegmentData = {
  role: "assistant"
  id: string
  blocks: Block[]
  streaming: boolean
  startedAt?: number
  durationMs?: number
  interrupted?: boolean
  error?: string
  incomplete?: boolean
  diff?: TurnDiff
}
type Segment = Extract<Turn, { role: "user" }> | AssistantSegmentData

type TurnLayoutRow = {
  segment: Segment
  index: number
  top: number
  height: number
}

function VirtualTurnRow({ id, top, onHeight, children }: {
  id: string
  top: number
  onHeight: (id: string, height: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const report = () => onHeight(id, element.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [id, onHeight])
  return (
    <div ref={ref} data-virtual-turn-id={id} className="absolute inset-x-0" style={{ top }}>
      {children}
    </div>
  )
}

function layoutTurns(segments: Segment[], heights: Map<string, number>): TurnLayoutRow[] {
  let top = 0
  return segments.map((segment, index) => {
    const height = heights.get(segment.id) ?? ESTIMATED_TURN_HEIGHT
    const row = { segment, index, top, height }
    top += height + TURN_GAP
    return row
  })
}

function visibleTurnRange(
  layout: TurnLayoutRow[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } {
  if (!layout.length) return { start: 0, end: 0 }
  const top = Math.max(0, scrollTop)
  const bottom = top + Math.max(0, viewportHeight)
  let start = 0
  while (start < layout.length && layout[start]!.top + layout[start]!.height < top) start++
  let end = start
  while (end < layout.length && layout[end]!.top < bottom) end++
  return {
    start: Math.max(0, start - overscan),
    end: Math.min(layout.length, Math.max(start + 1, end) + overscan),
  }
}

function earliest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

// Consecutive assistant turns after one user message form one reply, as in Codex.
function groupTurns(turns: Turn[]): Segment[] {
  const segments: Segment[] = []
  for (const turn of turns) {
    if (turn.role === "user") {
      segments.push(turn)
      continue
    }
    const last = segments[segments.length - 1]
    if (last?.role === "assistant") {
      segments[segments.length - 1] = {
        ...last,
        blocks: [...last.blocks, ...turn.blocks],
        streaming: last.streaming || turn.streaming,
        startedAt: earliest(last.startedAt, turn.startedAt),
        durationMs: turn.durationMs ?? last.durationMs,
        interrupted: turn.interrupted ?? last.interrupted,
        error: turn.error ?? last.error,
        incomplete: turn.incomplete ?? last.incomplete,
        diff: turn.diff ?? last.diff,
      }
    } else segments.push({
      role: "assistant",
      id: turn.id,
      blocks: turn.blocks,
      streaming: turn.streaming,
      startedAt: turn.startedAt,
      durationMs: turn.durationMs,
      interrupted: turn.interrupted,
      error: turn.error,
      incomplete: turn.incomplete,
      diff: turn.diff,
    })
  }
  return segments
}

// Tool calls and reasoning fold into one "Worked for" row; the final answer stays visible.
function AssistantSegment({ segment, busy, durationMs, interrupted, liveDiff, tasks, onStopTask, onOpenTask, onTurnDiff, onTurnDiffAction, diffActionPending }: {
  segment: AssistantSegmentData
  busy: boolean
  durationMs?: number
  interrupted?: boolean
  liveDiff?: TurnDiff
  tasks?: AgentTask[]
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
  onTurnDiff?: (diff: TurnDiff, path?: string) => void
  onTurnDiffAction?: (diff: TurnDiff, action: "undo" | "reapply") => void
  diffActionPending?: number
}) {
  const units = groupActivityBlocks(segment.blocks)
  const runs = groupActivityRuns(units)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!segment.streaming) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [segment.streaming])
  const hasActivity = runs.some((run) => run.kind === "activity" || run.kind === "standalone")
  const finalTextIndex = runs.map((run) => run.kind).lastIndexOf("text")
  const lastActivityIndex = runs.map((run) => run.kind === "standalone" ? "activity" : run.kind).lastIndexOf("activity")
  const finalRun = finalTextIndex > lastActivityIndex ? runs[finalTextIndex] : undefined
  const finalTextStarted = finalRun?.kind === "text" && finalRun.block.text.trim().length > 0
  const [finalStartedAt, setFinalStartedAt] = useState<number>()
  useEffect(() => {
    if (!segment.streaming || !finalTextStarted || finalStartedAt !== undefined) return
    setFinalStartedAt(Date.now())
  }, [segment.streaming, finalTextStarted, finalStartedAt])
  const liveDuration = segment.streaming && hasActivity && finalStartedAt === undefined && segment.startedAt !== undefined
    ? Math.max(0, now - segment.startedAt)
    : undefined
  // Codex collapses everything that happened before the final answer into one disclosure. Noa's
  // protocol has no final-channel flag, so the last text run is the final answer.
  const finalIndex = runs.map((run) => run.kind).lastIndexOf("text")
  // Trailing tool calls after the final answer still fold into the turn; Codex
  // collapses as soon as the final assistant message has started.
  const canCollapse = !busy && !segment.streaming && !interrupted && !segment.error && !segment.incomplete && finalIndex > 0 && runs.slice(0, finalIndex).some(run => run.kind !== "status")
  const collapsedCount = finalIndex > 0
    ? runs.reduce(
        (count, run, index) => index === finalIndex
          ? count
          : count + (run.kind === "activity" ? run.blocks.length : run.kind === "text" || run.kind === "standalone" ? 1 : 0),
        0,
      )
    : 0
  const [activityCollapsed, setActivityCollapsed] = useState(canCollapse)
  const activityToggled = useRef(false)
  useEffect(() => {
    if (!activityToggled.current) setActivityCollapsed(canCollapse)
  }, [canCollapse])
  function toggleActivity() {
    activityToggled.current = true
    setActivityCollapsed((collapsed) => !collapsed)
  }
  // A turn that cannot fold (stopped, or no final answer yet) keeps the inline worked-for divider.
  const lastActivity = lastActivityIndex
  const workedForBefore = lastActivity === -1
    ? -1
    : runs.findIndex((run, index) => index > lastActivity && run.kind === "text")
  const displayDuration = durationMs ?? (
    finalStartedAt !== undefined && segment.startedAt !== undefined
      ? Math.max(0, finalStartedAt - segment.startedAt)
      : undefined
  )

  const blockIndexes = new Map<Block, number>()
  segment.blocks.forEach((block, index) => blockIndexes.set(block, index))

  function streamKeyFor(block: Block) {
    return `${segment.id}:${blockIndexes.get(block) ?? -1}`
  }

  function renderText(run: Extract<ActivityRun, { kind: "text" }>, index: number, workedFor?: ReactNode) {
    return (
      <div key={index} data-response className="group/message flex flex-col gap-1">
        {workedFor}
        <div data-response-content><BlockView
          block={run.block}
          streaming={segment.streaming && run.block === segment.blocks[segment.blocks.length - 1]}
          streamKey={streamKeyFor(run.block)}
        /></div>
        {!busy && !segment.streaming && !interrupted && !segment.error && !segment.incomplete && index === finalTextIndex && (
          <MessageActions text={run.block.text} complete={run.block.done ?? true} />
        )}
      </div>
    )
  }

  function renderStandalone(block: ToolBlock, index: number) {
    return <ToolCard key={`standalone-${index}`} block={block} active={busy} defaultOpen={!!block.images?.length || (block.name === "Agent" || block.name === "Task" || block.name === "Hook" || ["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"].includes(block.name))} tasks={tasks} task={tasks?.find(task => task.id === block.id || task.toolUseId === block.id)} onStopTask={onStopTask} onOpenTask={onOpenTask} />
  }

  const turnDiff = segment.diff && onTurnDiff
    ? (
        <TurnDiffCard
          diff={segment.diff}
          onOpen={(path) => onTurnDiff(segment.diff!, path)}
          onAction={onTurnDiffAction ? (action) => onTurnDiffAction(segment.diff!, action) : undefined}
          pending={diffActionPending !== undefined && diffActionPending === segment.diff.turnIndex}
        />
      )
    : null

  if (canCollapse && activityCollapsed) {
    return (
      <div className="group flex flex-col gap-3">
        {runs.map((run, i) => run.kind === "status" ? <StatusBlock key={`status-${i}`} block={run.block} /> : run.kind === "standalone" && tasks?.some(task => task.status === "running" && (task.id === run.block.id || task.toolUseId === run.block.id)) ? renderStandalone(run.block, i) : null)}
        <WorkedFor
          durationMs={durationMs}
          count={durationMs === undefined ? collapsedCount : undefined}
          collapsed
          onToggle={toggleActivity}
        />
        {renderText(runs[finalIndex] as Extract<ActivityRun, { kind: "text" }>, finalIndex)}
        {turnDiff}
      </div>
    )
  }

  return (
    <div className="group flex flex-col gap-3">
      {canCollapse && (
        <WorkedFor
          durationMs={durationMs}
          count={durationMs === undefined ? collapsedCount : undefined}
          collapsed={false}
          onToggle={toggleActivity}
        />
      )}
      {liveDuration !== undefined && <WorkedFor durationMs={liveDuration} live collapsed={false} />}
      {runs.map((run, index) => {
        const workedFor = !canCollapse && index === workedForBefore && displayDuration !== undefined
          ? <WorkedFor durationMs={displayDuration} interrupted={interrupted} collapsed={false} />
          : null
        if (run.kind === "text") return renderText(run, index, workedFor)
        if (run.kind === "status") return <StatusBlock key={index} block={run.block} />
        if (run.kind === "standalone") return renderStandalone(run.block, index)
        return (
          <ActivityGroup
            key={index}
            blocks={run.blocks}
            tasks={tasks}
            streamKeyFor={streamKeyFor}
            onStopTask={onStopTask}
            onOpenTask={onOpenTask}
          />
        )
      })}
      {!canCollapse && durationMs !== undefined && workedForBefore === -1 && lastActivity !== -1 && (
        <WorkedFor durationMs={durationMs} interrupted={interrupted} collapsed={false} />
      )}
      {busy && liveDiff && !segment.diff && (
        <LiveDiffSummary diff={liveDiff} onOpen={() => onTurnDiff?.(liveDiff)} />
      )}
      {turnDiff}
      {interrupted && !hasActivity && <WorkedFor durationMs={durationMs} interrupted collapsed={false} />}
      {segment.error && <div role="alert" className="flex items-start gap-2 text-[length:var(--text-chat-sm)] text-[#C24444]"><AlertTriangle size={16} className="shrink-0" /><span className="whitespace-pre-wrap break-words">{segment.error}</span></div>}
      {segment.streaming && segment.blocks.length === 0 && <Working />}
    </div>
  )
}

// One collapsible summary per run of reasoning and tool calls, as Codex's
// agent-activity group. The body stays folded unless the user opens it.
function ActivityGroup({ blocks, tasks, streamKeyFor, onStopTask, onOpenTask }: {
  blocks: (ToolBlock | ThinkingBlockData)[]
  tasks?: AgentTask[]
  streamKeyFor?: (block: Block) => string
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
}) {
  const [open, setOpen] = useState(false)
  const activityRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useLayoutEffect(() => {
    const element = activityRef.current
    if (open && following.current && element) element.scrollTop = element.scrollHeight
  }, [open, blocks.length])
  const liveBlock = [...blocks].reverse().find(
    (block) => block.kind === "thinking" ? !block.done : block.status === "running",
  )
  const live = liveBlock !== undefined
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [live])
  const tools = blocks.filter((block): block is ToolBlock => block.kind === "tool")
  const thoughtCount = blocks.length - tools.length
  const summary = toolActivitySummary(tools)
  const failedCount = tools.filter(tool => tool.status === "error" || tool.status === "stopped").length
  const uncertainCount = tools.filter(tool => tool.status === "unknown").length
  const completedLabel = [thoughtCount ? "Thought" : null, summary?.label, tools.some(tool => tool.status === "error") ? `${failedCount} failed` : uncertainCount ? "connection lost" : null]
    .filter(Boolean)
    .join(", ") || "Worked"
  const liveLabel = liveBlock?.kind === "thinking"
    ? "Thinking"
    : liveBlock?.kind === "tool"
      ? labelForTool(liveBlock, now)
      : completedLabel
  const SummaryIcon =
    failedCount || uncertainCount ? AlertTriangle : summary?.kind === "edits" ? Edit2
      : summary?.kind === "images" ? Photo
        : summary?.kind === "commands" ? Terminal
          : summary?.kind === "reads" ? BookOpen
            : Tool

  return (
    <div className="not-prose" data-work-activity={live ? "live" : "done"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group/activity relative inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 p-0 text-left text-[length:var(--font-text-md-size)] font-normal leading-5 text-[color-mix(in_srgb,var(--text-primary)_60%,transparent)] select-none hover:text-[var(--text-primary,#2D2D2B)]"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <SummaryIcon size={16} className="shrink-0" aria-hidden="true" />
          <span className={`min-w-0 truncate ${live ? "noa-shimmer" : ""}`}>{live ? liveLabel : completedLabel}</span>
        </span>
        <ChevronRight size={14} className={`shrink-0 opacity-0 transition-[transform,opacity] duration-300 group-hover/activity:opacity-100 group-focus-visible/activity:opacity-100 ${open ? "rotate-90" : ""}`} />
      </button>
      <Collapsible open={open}>
        <div ref={activityRef} onScroll={(event) => { const e = event.currentTarget; following.current = e.scrollHeight - e.clientHeight - e.scrollTop <= 24 }} className="noa-activity-scroll mt-2 flex max-h-56 flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-contain focus-visible:outline-auto" role="region" aria-label="Tool activity" tabIndex={open ? 0 : -1}>
          {blocks.map((block, i) => block.kind === "thinking"
            ? <ThinkingBlock key={`thought-${i}`} block={block} streamKey={streamKeyFor?.(block)} />
            : (
              <ToolCard
                key={`tool-${block.id}-${i}`}
                block={block}
                tasks={tasks}
                task={tasks?.find((candidate) => candidate.id === block.id || candidate.toolUseId === block.id)}
                defaultOpen={false}
                onStopTask={onStopTask}
                onOpenTask={onOpenTask}
              />
            ))}
        </div>
      </Collapsible>
    </div>
  )
}

function labelForTool(block: ToolBlock, now = Date.now()): string {
  const label = toolActivityLabel(block)
  const base = label.detail ? `${label.action} ${label.detail}` : label.action
  const elapsed = block.name === "Bash" && block.status === "running" ? toolElapsedMs(block, now) : undefined
  return elapsed === undefined ? base : `${base} for ${formatElapsed(elapsed)}`
}

function WorkedFor({ durationMs, count, interrupted, collapsed, live, onToggle }: {
  durationMs?: number
  count?: number
  interrupted?: boolean
  collapsed: boolean
  live?: boolean
  onToggle?: () => void
}) {
  const label = live
    ? durationMs === undefined || durationMs < 1000 ? "Working" : `Working for ${formatDuration(durationMs)}`
    : durationMs !== undefined
      ? interrupted ? `You stopped after ${formatDuration(durationMs)}` : `Worked for ${formatDuration(durationMs)}`
      : count !== undefined ? `${count} previous ${count === 1 ? "message" : "messages"}` : "Activity"
  if (!onToggle) {
    return (
      <div className="flex w-full min-h-0 flex-col items-start gap-2 text-[length:var(--font-text-md-size)] tabular-nums text-[var(--sidebar-text-muted)]">
        <span className="whitespace-nowrap">{label}</span>
        <span className="w-full border-t border-[var(--divider-subtle)]" aria-hidden="true" />
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="group/worked flex w-full min-h-0 flex-col items-start gap-2 rounded-md p-0 text-left text-[length:var(--font-text-md-size)] tabular-nums text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"
    >
      <span className="flex items-center gap-1 whitespace-nowrap">
        {label}
        <ChevronRight size={12} className={`opacity-0 transition-[transform,opacity] duration-150 group-hover/worked:opacity-100 group-focus-visible/worked:opacity-100 ${collapsed ? "" : "rotate-90"}`} />
      </span>
      <span className="w-full border-t border-[var(--divider-subtle)]" aria-hidden="true" />
    </button>
  )
}

// Long user messages fold after 20 lines under a fade, as in Codex.
function UserBubble({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // Measure while folded: an expanded bubble has no max-height to compare against.
      if (!expanded) setLong(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [expanded])
  const folded = long && !expanded
  return (
    <>
      <div
        ref={ref}
        data-user-message-bubble=""
        className={`noa-selectable max-w-[70%] whitespace-pre-wrap break-words rounded-[22px] bg-[color-mix(in_srgb,var(--accent-color)_8%,transparent)] px-4 py-2.5 text-[length:var(--font-text-md-size)] leading-[var(--font-text-md-line-height)] ${
          expanded
            ? ""
            : `relative max-h-[20lh] overflow-hidden ${folded ? "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)] after:pointer-events-none after:absolute after:bottom-1 after:right-3 after:content-['…'] after:text-[var(--sidebar-text-muted,#898781)]" : ""}`
        }`}
      >
        {text}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-1 self-start text-caption text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)]"
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDown size={12} className={expanded ? "rotate-180" : undefined} />
        </button>
      )}
    </>
  )
}

function firstLine(text: string): string {
  const start = text.search(/\S/)
  if (start === -1) return ""
  const head = text.slice(start, start + 400)
  const newline = head.indexOf("\n")
  return (newline === -1 ? head : head.slice(0, newline)).trimEnd()
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"')
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function Working() {
  return <div className="noa-shimmer py-1 text-[length:var(--font-text-md-size)] leading-5">Thinking</div>
}

function MessageActions({ text, kind = "assistant", onEdit, complete = true }: {
  text: string
  kind?: "user" | "assistant"
  onEdit?: () => void
  complete?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  if (!text || !complete) return null
  const copyLabel = kind === "user" ? "Copy message" : "Copy response"
  return (
    <div className={`${kind === "assistant" ? "-ml-1 mt-0.5 min-h-5 gap-0.5" : "mx-0.5 mb-1 gap-2"} flex leading-4 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100`}>
      <button
        type="button"
        onClick={async event => {
          try {
            if (kind === "assistant") await copyContent(event.currentTarget.closest("[data-response]")?.querySelector<HTMLElement>("[data-response-content]") ?? null, text)
            else await navigator.clipboard.writeText(text)
          } catch { setCopyError(true); return }
          setCopyError(false)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className={`${kind === "assistant" ? "size-5" : "size-6"} flex items-center justify-center rounded-md text-[var(--text-secondary,#5D5D5D)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] noa-press`}
        aria-label={copied ? "Copied" : copyLabel}
        title={copied ? "Copied" : copyLabel}
      >
        {copied ? <Check size={kind === "assistant" ? 16 : 12} /> : <Copy size={kind === "assistant" ? 16 : 12} />}
      </button>
      {copyError && <span role="status" className="self-center text-caption text-[#C24444]">Could not copy. Try again.</span>}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="flex size-6 items-center justify-center rounded-md text-[var(--text-secondary,#5D5D5D)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] noa-press"
          aria-label="Edit message"
          title="Edit and resend"
        >
          <Edit2 size={12} />
        </button>
      )}
    </div>
  )
}

function BlockView({ block, streaming, streamKey }: { block: Block; streaming?: boolean; streamKey?: string }) {
  switch (block.kind) {
    case "compaction":
    case "retry":
      return <StatusBlock block={block} />
    case "text":
      return <Markdown text={block.text} streaming={streaming} streamKey={streamKey} />
    case "thinking":
      return (
        <ThinkingBlock block={block} />
      )
    case "tool":
      return <ToolCard block={block} />
  }
}

// Collapsed once the reasoning is done, as in Codex; open while it streams.
function ThinkingBlock({ block, streamKey }: { block: Extract<Block, { kind: "thinking" }>; streamKey?: string }) {
  const [open, setOpen] = useState(!block.done)
  // The block mounts with its first token, so this is close to the reasoning's start.
  const startedAt = useRef<number | undefined>(block.startedAt ?? (block.done ? undefined : Date.now()))
  const [elapsed, setElapsed] = useState<number>()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  useEffect(() => {
    if (!block.done) return
    if (startedAt.current !== undefined) setElapsed((value) => value ?? Date.now() - startedAt.current!)
    setOpen(false)
  }, [block.done])
  const label = elapsed === undefined ? "Thought" : elapsed < 1000 ? "Thought for <1s" : `Thought for ${formatDuration(elapsed)}`
  async function copyQuote() {
    try { await navigator.clipboard.writeText(block.text.split("\n").map((line) => `> ${line}`).join("\n")) } catch { setCopyError(true); return }
    setCopyError(false)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="group/thinking flex flex-col text-[length:var(--text-chat-sm)] leading-5 text-[var(--sidebar-text-muted,#898781)]">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-left select-none hover:text-[var(--text-primary,#2D2D2B)]"
        >
          {block.done ? (
            <span>{label}</span>
          ) : (
            <span className="noa-shimmer">Thinking</span>
          )}
          <ChevronRight size={14} className={`opacity-0 transition-[transform,opacity] duration-300 group-hover/thinking:opacity-100 group-focus-within/thinking:opacity-100 ${open ? "rotate-90" : ""}`} />
        </button>
        {block.done && block.text.trim() !== "" && (
          <button
            type="button"
            onClick={copyQuote}
            aria-label="Copy thought as quote"
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-caption text-[var(--text-secondary,#5D5D5D)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] focus-visible:opacity-100 group-hover/thinking:opacity-100 noa-press"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy as quote"}
          </button>
        )}
      </div>
      {copyError && <span role="status">Could not copy. Try again.</span>}
      <Collapsible open={open}>
        <div className="mt-1.5 px-1">
          <Markdown text={block.text} tone="muted" streaming={!block.done} streamKey={streamKey} />
        </div>
      </Collapsible>
    </div>
  )
}

function StatusBlock({ block }: { block: Extract<Block, { kind: "compaction" | "retry" }> }) {
  const [delayed, setDelayed] = useState(false)
  useEffect(() => {
    if (block.kind !== "compaction" || block.status !== "running" || !block.startedAt) return
    const timer = setTimeout(() => setDelayed(true), Math.max(0, block.startedAt + 10000 - Date.now()))
    return () => clearTimeout(timer)
  }, [block])
  if (block.kind === "retry" && block.done) return null
  const live = block.kind === "retry" || block.status === "running"
  const label = block.kind === "retry" ? `Retrying ${block.attempt}/${block.maxRetries} · ${block.errorStatus ? `HTTP ${block.errorStatus} · ` : ""}${Math.ceil(block.delayMs / 1000)}s delay`
    : block.status === "running" ? `Compacting context${delayed ? " · This can take a few minutes" : ""}`
      : block.status === "unknown" ? "Compaction connection lost" : block.status === "stopped" ? "Compaction interrupted" : block.trigger === "auto" ? "Context automatically compacted" : "Context compacted"
  return <div role="status" className="flex items-center gap-1.5 text-[length:var(--font-text-md-size)] leading-5 text-[color-mix(in_srgb,var(--text-primary)_60%,transparent)]"><span aria-hidden="true">{block.kind === "compaction" ? <ListCollapseIcon /> : <AlertTriangle size={16} />}</span><span className={live ? "noa-shimmer" : undefined}>{label}</span></div>
}

function ListCollapseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2M9 8h6M9 12h6M9 16h3" /></svg>
}
