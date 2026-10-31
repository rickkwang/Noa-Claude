import { flushSync } from "react-dom"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
import { ArrowDown, AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, Copy, Edit2, FileText, Photo, Search, Terminal, Tool } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { ErrorBoundary } from "./ErrorBoundary"
import { copyContent } from "./RichContent"
import { Markdown, OutputContext } from "./Markdown"
import { MessageRail, type MessageRailItem } from "./MessageRail"
import { ToolCard } from "./ToolCard"
import { splitReferences } from "../lib/references"
import { contextCardFor } from "./ContextCard"
import { stripAnsi } from "../lib/contextOutput"
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
const TODO_TOOLS = ["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]
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
  const measureFrame = useRef<number | undefined>(undefined)
  const measureObserver = useRef<ResizeObserver | null>(null)
  const pendingHeights = useRef(new Map<string, number>())
  const pendingAnchor = useRef<{ id: string; top: number; scrollTop: number } | undefined>(undefined)
  const prependAnchor = useRef(false)
  const heightsRef = useRef(new Map(savedScroll?.heights))
  const offsetsRef = useRef(new Map<string, number>())
  const focusedTurn = useRef<string | undefined>(undefined)
  const pendingPrevious = useRef<string | undefined>(undefined)
  const jumpToken = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const [showRail, setShowRail] = useState(false)
  const [selection, setSelection] = useState<{ text: string; left: number; top: number }>()
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number }>()
  const [viewport, setViewport] = useState({ top: savedScroll?.top ?? 0, height: 0 })
  const [measured, setMeasured] = useState(0)

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) return
    const update = () => {
      const bounds = scroll.getBoundingClientRect()
      const scale = scroll.offsetWidth > 0 ? bounds.width / scroll.offsetWidth : 1
      setShowRail((content.getBoundingClientRect().left - bounds.left) / (scale > 0 ? scale : 1) >= 48)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroll)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const previousFirst = firstTurnRef.current
    const offset = layoutRef.current?.offsetTop ?? 0
    if (previousFirst && previousFirst !== turns[0]?.id && offsetsRef.current.has(previousFirst) && !pinnedRef.current) {
      el.scrollTop += offsetsRef.current.get(previousFirst)! + offset - previousLayoutOffset.current
      prependAnchor.current = true
    }
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
      if (measureFrame.current !== undefined) cancelAnimationFrame(measureFrame.current)
      // StrictMode reruns this cleanup without unmounting; a stale frame id would make
      // onScroll and the row measurer skip scheduling forever, freezing turns at estimates.
      scrollFrame.current = undefined
      measureFrame.current = undefined
      measureObserver.current?.disconnect()
      measureObserver.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const anchor = pendingAnchor.current
    pendingAnchor.current = undefined
    if (!el) return
    if (pinnedRef.current) el.scrollTop = el.scrollHeight
    else if (anchor) {
      const row = el.querySelector<HTMLElement>(`[data-virtual-turn-id="${cssEscape(anchor.id)}"]`)
      if (row) el.scrollTop += row.getBoundingClientRect().top - anchor.top + el.scrollTop - anchor.scrollTop
    }
    setViewport({ top: el.scrollTop, height: el.clientHeight })
  }, [measured])

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

  // Rows are memoized, so handlers they receive must keep one identity across renders.
  const handlers = useRef({ onStopTask, onOpenTask, onTurnDiff, onTurnDiffAction, onOpenFile })
  handlers.current = { onStopTask, onOpenTask, onTurnDiff, onTurnDiffAction, onOpenFile }
  const outputContext = useMemo(() => ({
    cwd,
    onOpenFile: (path: string, line?: number, endLine?: number) => handlers.current.onOpenFile?.(path, line, endLine),
    onOpenImages: (items: LightboxItem[], index: number) => setPreview({ items, index }),
  }), [cwd])
  const stableStopTask = useCallback((id: string) => handlers.current.onStopTask?.(id), [])
  const stableOpenTask = useCallback(() => handlers.current.onOpenTask?.(), [])
  const stableTurnDiff = useCallback((diff: TurnDiff, path?: string) => handlers.current.onTurnDiff?.(diff, path), [])
  const stableTurnDiffAction = useCallback((diff: TurnDiff, action: "undo" | "reapply") => handlers.current.onTurnDiffAction?.(diff, action), [])
  const segmentCache = useRef<SegmentCache>(new Map())
  const segments = useMemo(() => groupTurns(turns, segmentCache.current), [turns])
  const layout = useMemo(() => layoutTurns(segments, heightsRef.current), [segments, measured])
  const layoutHeight = layout.length ? layout[layout.length - 1]!.top + layout[layout.length - 1]!.height : 0
  const layoutOffset = layoutRef.current?.offsetTop ?? 32
  const visible = visibleTurnRange(
    layout,
    pinnedRef.current ? Math.max(0, layoutHeight - (viewport.height || 800)) : Math.max(0, viewport.top - layoutOffset),
    viewport.height || 800,
    TURN_OVERSCAN,
  )
  offsetsRef.current = new Map(layout.map((row) => [row.segment.id, row.top]))
  const observeTurn = useCallback((element: HTMLElement) => {
    const commit = () => {
      measureFrame.current = undefined
      const changes = [...pendingHeights.current].filter(([key, height]) => heightsRef.current.get(key) !== height)
      pendingHeights.current.clear()
      if (!changes.length) return
      const el = scrollRef.current
      if (el && !pinnedRef.current) {
        const bounds = el.getBoundingClientRect()
        const rows = [...el.querySelectorAll<HTMLElement>("[data-virtual-turn-id]")]
          .filter((item) => {
            const rect = item.getBoundingClientRect()
            return rect.bottom > bounds.top && rect.top < bounds.bottom
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        const row = (prependAnchor.current && rows.find((item) => item.getBoundingClientRect().top >= bounds.top)) || rows[0]
        prependAnchor.current = false
        if (row?.dataset.virtualTurnId) pendingAnchor.current = { id: row.dataset.virtualTurnId, top: row.getBoundingClientRect().top, scrollTop: el.scrollTop }
      }
      for (const [key, height] of changes) heightsRef.current.set(key, height)
      setMeasured((value) => value + 1)
    }
    const queue = (row: HTMLElement) => {
      const id = row.dataset.virtualTurnId
      if (!id) return
      pendingHeights.current.set(id, row.offsetHeight)
      if (measureFrame.current !== undefined) return
      measureFrame.current = requestAnimationFrame(commit)
    }
    measureObserver.current ??= new ResizeObserver((entries) => {
      for (const entry of entries) queue(entry.target as HTMLElement)
      // While following the bottom, apply growth before paint so the tail never trails the viewport.
      if (pinnedRef.current && measureFrame.current !== undefined) {
        cancelAnimationFrame(measureFrame.current)
        flushSync(commit)
      }
    })
    measureObserver.current.observe(element)
    queue(element)
    return () => {
      measureObserver.current?.unobserve(element)
      if (element.dataset.virtualTurnId) pendingHeights.current.delete(element.dataset.virtualTurnId)
    }
  }, [])
  const visibleRows = layout.slice(visible.start, visible.end)
  const focusedRow = layout.find((row) => row.segment.id === focusedTurn.current)
  if (focusedRow && !visibleRows.some((row) => row.segment.id === focusedRow.segment.id)) {
    visibleRows.push(focusedRow)
    visibleRows.sort((a, b) => a.index - b.index)
  }
  const anchorRow = pendingAnchor.current && layout.find((row) => row.segment.id === pendingAnchor.current?.id)
  if (anchorRow && !visibleRows.some((row) => row.segment.id === anchorRow.segment.id)) {
    visibleRows.push(anchorRow)
    visibleRows.sort((a, b) => a.index - b.index)
  }

  // Between sending and the first token, and between model messages, nothing on screen
  // is live; keep a Thinking row so the turn never looks stalled.
  const tail = segments[segments.length - 1]
  const awaitingModel = busy && !!tail && (tail.role === "user" || (
    !tail.streaming && !tail.blocks.some(block =>
      block.kind === "thinking" ? !block.done
        : block.kind === "tool" ? block.status === "running"
          : block.kind === "compaction" ? block.status === "running"
            : block.kind === "retry" ? !block.done
              : false)))
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && awaitingModel && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [awaitingModel])

  const lastUserIndex = segments.reduce((last, segment, index) => segment.role === "user" ? index : last, -1)

  // The rail previews each prompt with the final answer of the reply that follows it.
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
  // Every user message crossing the viewport is active, marking the whole
  // visible range; when none is visible, the prompt the reader has passed stays lit.
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
      const { text: prose, paths } = splitReferences(segment.text)
      return (
        <div className="group/message flex flex-col items-end gap-1">
          {segment.images?.length ? <MessageImages images={segment.images} onOpen={(items, imageIndex) => setPreview({ items, index: imageIndex })} /> : null}
          {paths.length > 0 && <MessageReferences paths={paths} onOpen={onOpenFile} />}
          {prose && <UserBubble text={prose} />}
          <MessageActions
            text={prose}
            kind="user"
            sentAt={segment.sentAt}
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
        liveDiff={index === segments.length - 1 ? liveDiff : undefined}
        tasks={tasks}
        onStopTask={onStopTask ? stableStopTask : undefined}
        onOpenTask={onOpenTask ? stableOpenTask : undefined}
        onTurnDiff={onTurnDiff ? stableTurnDiff : undefined}
        onTurnDiffAction={onTurnDiffAction ? stableTurnDiffAction : undefined}
        diffActionPending={diffActionPending}
      />
    )
  }

  return (
    <OutputContext value={outputContext}><div className="relative flex min-h-0 flex-1 flex-col">
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
      className="noa-agent-scroll scrollbar-on-scroll noa-scroll-fade relative flex-1 min-h-0 overflow-y-auto overscroll-contain"
    >
      {/* 48px around the transcript column is reserved so the rail lives in the
          gutter and its expanded tick never crosses the text on narrow windows. */}
      <div ref={contentRef} className="mx-auto flex flex-col gap-4 px-5 pt-8" style={{ width: "calc(100% - 48px)", maxWidth: readingWidth, paddingBottom: "calc(var(--composer-overlay, 0px) + 32px)" }}>
        {!!historyBefore && <button type="button" disabled={historyLoading} onClick={onLoadEarlier} className="self-center rounded-lg px-3 py-2 text-caption text-[var(--text-secondary)]">{historyLoading ? "Loading earlier messages…" : "Load earlier messages"}</button>}
        <div ref={layoutRef} className="relative w-full" style={{ height: layoutHeight }}>
          {visibleRows.map((row) => (
            <VirtualTurnRow key={row.segment.id} id={row.segment.id} top={row.top} observe={observeTurn}>
              <ErrorBoundary resetKey={row.segment.id}>
                <div className="noa-turn-item noa-virtual-turn">{renderSegment(row.segment, row.index)}</div>
              </ErrorBoundary>
            </VirtualTurnRow>
          ))}
        </div>

        {awaitingModel && <Working />}

        {!busy && result?.isError && !result.interrupted && onRetry && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[length:var(--text-chat-sm)] text-[var(--sidebar-text-muted,#898781)]">
            {!turns.some(turn => turn.role === "assistant" && turn.error) && <span className="text-[#C24444]">Finished with an error</span>}
            <button
              type="button"
              onClick={onRetry}
              className="noa-press flex h-6 items-center rounded-md px-1.5 text-caption text-[var(--accent-color)] hover:bg-[var(--fill-hover)]"
              title="Send the last message again"
            >
              Retry
            </button>
          </div>
        )}
      </div>

    </div>
      <MessageRail key={sessionId ?? "new"} items={railItems} activeIds={activeRailIds} sessionId={sessionId} onJump={scrollToSegment} visible={showRail} />
      {/* Scroll-to-bottom: a 32px round button that fades rather than mounts. */}
      <button
        type="button"
        aria-label="Scroll to bottom"
        aria-hidden={!showJump}
        tabIndex={showJump ? undefined : -1}
        onClick={jumpToBottom}
        data-show={showJump}
        className="noa-scroll-bottom noa-press"
      >
        {/* While the agent works the button shows working dots; hover swaps back to the arrow. */}
        {busy && <span className="noa-scroll-bottom-dots" aria-hidden="true"><span /><span /><span /></span>}
        <ArrowDown size={14} className={busy ? "noa-scroll-bottom-arrow" : undefined} />
      </button>
      {selection && <button type="button" className="fixed z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-caption shadow-lg" style={{ left: selection.left, top: selection.top }} onMouseDown={event => event.preventDefault()} onClick={() => { onQuote?.(selection.text); window.getSelection()?.removeAllRanges(); setSelection(undefined) }}>Quote selection</button>}
      {preview && <Lightbox items={preview.items} index={preview.index} onIndex={(index) => setPreview({ ...preview, index })} onClose={() => setPreview(undefined)} />}
    </div></OutputContext>
  )
}

function MessageReferences({ paths, onOpen }: { paths: string[]; onOpen?: (path: string) => void }) {
  return (
    <div className="flex max-w-[70%] flex-wrap justify-end gap-1.5" aria-label="Referenced files">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          title={path}
          disabled={!onOpen}
          onClick={() => onOpen?.(path)}
          className="noa-press flex max-w-full items-center gap-1 rounded-md bg-[var(--fill-hover)] px-2 py-1 text-caption text-[var(--text-secondary)] enabled:hover:text-[var(--text-primary)]"
        >
          <FileText size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{path}</span>
        </button>
      ))}
    </div>
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
          className="cursor-zoom-in overflow-hidden rounded-xl border border-[var(--border-default)] noa-press"
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

function VirtualTurnRow({ id, top, observe, children }: {
  id: string
  top: number
  observe: (element: HTMLElement) => () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    return observe(element)
  }, [id, observe])
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
  let low = 0, high = layout.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (layout[mid]!.top + layout[mid]!.height < top) low = mid + 1
    else high = mid
  }
  const start = low
  high = layout.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (layout[mid]!.top < bottom) low = mid + 1
    else high = mid
  }
  const end = low
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

// Consecutive assistant turns after one user message form one reply. A segment
// whose source turns are all unchanged is reused, so memoized rows skip rendering.
type SegmentCache = Map<string, { sources: Turn[]; segment: AssistantSegmentData }>

function groupTurns(turns: Turn[], cache: SegmentCache): Segment[] {
  const groups: (Turn | Extract<Turn, { role: "assistant" }>[])[] = []
  for (const turn of turns) {
    if (turn.role === "user") { groups.push(turn); continue }
    const last = groups[groups.length - 1]
    if (Array.isArray(last)) last.push(turn)
    else groups.push([turn])
  }
  const next: SegmentCache = new Map()
  const segments = groups.map((group): Segment => {
    if (!Array.isArray(group)) return group as Segment
    const id = group[0]!.id
    const cached = cache.get(id)
    if (cached && cached.sources.length === group.length && cached.sources.every((source, i) => source === group[i])) {
      next.set(id, cached)
      return cached.segment
    }
    const segment = mergeAssistantTurns(group)
    next.set(id, { sources: group, segment })
    return segment
  })
  cache.clear()
  for (const [key, value] of next) cache.set(key, value)
  return segments
}

function mergeAssistantTurns(group: Extract<Turn, { role: "assistant" }>[]): AssistantSegmentData {
  let segment: AssistantSegmentData | undefined
  for (const turn of group) {
    segment = segment
      ? {
          ...segment,
          blocks: [...segment.blocks, ...turn.blocks],
          streaming: segment.streaming || turn.streaming,
          startedAt: earliest(segment.startedAt, turn.startedAt),
          durationMs: turn.durationMs ?? segment.durationMs,
          interrupted: turn.interrupted ?? segment.interrupted,
          error: turn.error ?? segment.error,
          incomplete: turn.incomplete ?? segment.incomplete,
          diff: turn.diff ?? segment.diff,
        }
      : {
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
        }
  }
  return segment!
}

// Tool calls and reasoning fold into one "Worked for" row; the final answer stays visible.
const AssistantSegment = memo(AssistantSegmentView)
function AssistantSegmentView({ segment, busy, durationMs, interrupted, liveDiff, tasks, onStopTask, onOpenTask, onTurnDiff, onTurnDiffAction, diffActionPending }: {
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
  // Everything that happened before the final answer collapses into one disclosure. Noa's
  // protocol has no final-channel flag, so the last text run is the final answer.
  const finalIndex = runs.map((run) => run.kind).lastIndexOf("text")
  // Trailing tool calls after the final answer still fold into the turn; it
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

  // Only the newest todo list stays expanded; earlier snapshots stay folded.
  const latestTodo = segment.blocks.findLast((block): block is ToolBlock => block.kind === "tool" && TODO_TOOLS.includes(block.name))

  function renderStandalone(block: ToolBlock, index: number) {
    return <ToolCard key={`standalone-${index}`} block={block} active={busy} defaultOpen={!!block.images?.length || block.name === "Agent" || block.name === "Task" || block.name === "Hook" || block.name === "ExitPlanMode" || block.name === "AskUserQuestion" || block === latestTodo} tasks={tasks} task={tasks?.find(task => task.id === block.id || task.toolUseId === block.id)} onStopTask={onStopTask} onOpenTask={onOpenTask} />
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
        {runs.map((run, i) => run.kind === "status" ? <StatusBlock key={`status-${i}`} block={run.block} /> : run.kind === "standalone" && (run.block.name === "ExitPlanMode" || tasks?.some(task => task.status === "running" && (task.id === run.block.id || task.toolUseId === run.block.id))) ? renderStandalone(run.block, i) : null)}
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

// One collapsible summary per run of reasoning and tool calls, an
// agent-activity group. The body stays folded unless the user opens it.
function ActivityGroup({ blocks, tasks, onStopTask, onOpenTask }: {
  blocks: (ToolBlock | ThinkingBlockData)[]
  tasks?: AgentTask[]
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
  const summary = toolActivitySummary(tools)
  const failedCount = tools.filter(tool => tool.status === "error" || tool.status === "stopped").length
  const uncertainCount = tools.filter(tool => tool.status === "unknown").length
  const completedLabel = [summary?.label, tools.some(tool => tool.status === "error") ? `${failedCount} failed` : uncertainCount ? "connection lost" : null]
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
            : summary?.kind === "web" ? Search
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
        <div ref={activityRef} onScroll={(event) => { const e = event.currentTarget; following.current = e.scrollHeight - e.clientHeight - e.scrollTop <= 24 }} className="noa-activity-scroll scrollbar-on-scroll mt-2 flex max-h-56 flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-contain focus-visible:outline-auto" role="region" aria-label="Tool activity" tabIndex={open ? 0 : -1}>
          {tools.map((block, i) => (
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

// Long user messages fold after 20 lines under a fade.
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
        className={`noa-selectable max-w-[70%] whitespace-pre-wrap break-words rounded-[22px] bg-[color-mix(in_oklab,var(--text-primary)_5%,transparent)] px-4 py-2.5 text-[length:var(--font-text-md-size)] leading-[var(--font-text-md-line-height)] ${
          expanded
            ? ""
            : `relative max-h-[20lh] overflow-hidden ${folded ? "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)] after:pointer-events-none after:absolute after:bottom-1 after:right-3 after:content-['…'] after:text-[var(--sidebar-text-muted,#898781)]" : ""}`
        }`}
      >
        <Markdown text={text} preserveUserText />
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
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
  // Sits outside the turn items, so it carries the conversation typeface itself to match the rows above.
  return <div className="noa-shimmer text-[length:var(--font-text-md-size)] leading-5" style={{ fontFamily: "var(--font-content, var(--font-ui))" }}>Thinking</div>
}

// Today shows the time, the past week the weekday and time, anything older the date and time.
function formatSentAt(sentAt: number, now = new Date()): string {
  const date = new Date(sentAt)
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 864e5)
  if (days >= 0) return date.toLocaleString(undefined, time)
  if (days < 0 && days > -7) return date.toLocaleString(undefined, { ...time, weekday: "long" })
  return date.toLocaleString(undefined, { ...time, month: "short", day: "numeric" })
}

function MessageActions({ text, kind = "assistant", onEdit, complete = true, sentAt }: {
  text: string
  kind?: "user" | "assistant"
  onEdit?: () => void
  complete?: boolean
  sentAt?: number
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  if (!text || !complete) return null
  const copyLabel = kind === "user" ? "Copy message" : "Copy response"
  return (
    <div className={`${kind === "assistant" ? "-ml-1 mt-0.5 min-h-5 gap-0.5" : "mx-1 items-center gap-2"} flex leading-4 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100`}>
      {kind === "user" && sentAt !== undefined && <time dateTime={new Date(sentAt).toISOString()} className="text-xs text-[var(--text-tertiary)]">{formatSentAt(sentAt)}</time>}
      <div className={kind === "user" ? "flex items-center" : "contents"}>
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
        className={`${kind === "assistant" ? "size-5" : "size-7"} flex items-center justify-center rounded-md text-[var(--text-secondary,#5D5D5D)] hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary,#2D2D2B)] noa-press`}
        aria-label={copied ? "Copied" : copyLabel}
        title={copied ? "Copied" : copyLabel}
      >
        {copied ? <Check size={kind === "assistant" ? 16 : 14} /> : <Copy size={kind === "assistant" ? 16 : 14} />}
      </button>
      {copyError && <span role="status" className="self-center text-caption text-[#C24444]">Could not copy. Try again.</span>}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="flex size-7 items-center justify-center rounded-md text-[var(--text-secondary,#5D5D5D)] hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary,#2D2D2B)] noa-press"
          aria-label="Edit message"
          title="Edit message"
        >
          <Edit2 size={14} />
        </button>
      )}
      </div>
    </div>
  )
}

// Some models deliver a whole answer in one burst. Reveal it in word-sized steps whose
// pace follows the backlog (about 0.55s behind the stream), and keep draining after the
// stream ends.
const REVEAL_STEP_CHARS = 22
const REVEAL_TARGET_LAG_MS = 550
const REVEAL_MIN_STEP_MS = 25
const REVEAL_MAX_STEP_MS = 150
const REVEAL_CATCH_UP_WINDOW_MS = 75
// A row that remounts later (virtual list) must not replay an answer it already revealed.
const FRESH_TEXT_MS = 15_000
const revealedTexts = new Set<string>()

// End a step on a word boundary when one is close, so words are never split mid-reveal.
function stepEnd(text: string, from: number, chars: number): number {
  const target = Math.min(text.length, from + chars)
  if (target >= text.length) return text.length
  for (let i = target; i < Math.min(text.length, target + 12); i++) if (/\s/.test(text[i]!)) return i + 1
  const code = text.charCodeAt(target - 1)
  return code >= 0xd800 && code <= 0xdbff ? target + 1 : target
}

function PacedMarkdown({ text, streaming, fresh, streamKey }: { text: string; streaming?: boolean; fresh: boolean; streamKey?: string }) {
  const reduceMotion = typeof document !== "undefined" && (document.documentElement.dataset.reduceMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  const replay = fresh && !(streamKey && revealedTexts.has(streamKey))
  const [shown, setShown] = useState(streaming || replay ? 0 : text.length)
  const shownRef = useRef(shown)
  const textRef = useRef(text)
  textRef.current = text
  // Survives effect restarts, so a steady trickle of deltas cannot keep postponing the next step.
  const lastStep = useRef(0)
  useEffect(() => {
    if (reduceMotion || (shownRef.current > text.length)) { shownRef.current = text.length; setShown(text.length); return }
    if (shownRef.current >= text.length) return
    // Text that was never streamed here (history, replay of finished messages) appears at once.
    if (!streaming && !replay && shownRef.current === 0) { shownRef.current = text.length; setShown(text.length); return }
    let timer: ReturnType<typeof setTimeout> | undefined
    const step = () => {
      const target = textRef.current
      if (document.hidden) { shownRef.current = target.length; setShown(target.length); return }
      const backlog = target.length - shownRef.current
      if (backlog <= 0) return
      const now = performance.now()
      const interval = Math.min(REVEAL_MAX_STEP_MS, Math.max(REVEAL_MIN_STEP_MS, REVEAL_TARGET_LAG_MS * REVEAL_STEP_CHARS / backlog))
      const elapsed = now - lastStep.current
      if (elapsed < interval) { timer = setTimeout(step, interval - elapsed); return }
      lastStep.current = now
      // A large backlog takes bigger steps so the lag stays near the target.
      const extra = Math.max(0, backlog - REVEAL_TARGET_LAG_MS * REVEAL_STEP_CHARS / REVEAL_MIN_STEP_MS)
      const next = stepEnd(target, shownRef.current, REVEAL_STEP_CHARS + Math.ceil(extra * Math.min(1, elapsed / REVEAL_CATCH_UP_WINDOW_MS)))
      shownRef.current = next
      setShown(next)
      if (next < target.length) timer = setTimeout(step, REVEAL_MIN_STEP_MS)
    }
    timer = setTimeout(step, 0)
    return () => clearTimeout(timer)
  }, [text, streaming, replay, reduceMotion])
  const caughtUp = shown >= text.length
  useEffect(() => {
    if (!caughtUp || streaming || !streamKey) return
    revealedTexts.add(streamKey)
    if (revealedTexts.size > 2000) revealedTexts.delete(revealedTexts.values().next().value!)
  }, [caughtUp, streaming, streamKey])
  return <Markdown text={caughtUp ? text : text.slice(0, shown)} streaming={streaming || !caughtUp} streamKey={streamKey} />
}

function BlockView({ block, streaming, streamKey }: { block: Block; streaming?: boolean; streamKey?: string }) {
  switch (block.kind) {
    case "compaction":
    case "retry":
      return <StatusBlock block={block} />
    case "text":
      return contextCardFor(block.text) ?? <PacedMarkdown text={stripAnsi(block.text)} streaming={streaming} fresh={block.startedAt !== undefined && Date.now() - block.startedAt < FRESH_TEXT_MS} streamKey={streamKey} />
    case "thinking":
      return null
    case "tool":
      return <ToolCard block={block} />
  }
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
