import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { AgentState, AgentTask, Block, Turn } from "../agent/reducer"
import type { ImageBlock } from "../agent/protocol"
import { Lightbox, type LightboxItem } from "./Lightbox"
import { groupActivityBlocks, toolActivitySummary } from "../agent/toolActivity"
import { ArrowDown, BookOpen, Check, ChevronRight, Copy, Edit2, Photo, Terminal, Tool } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { Markdown } from "./Markdown"
import { ToolCard } from "./ToolCard"

interface MessageListProps {
  turns: Turn[]
  busy: boolean
  result?: AgentState["result"]
  readingWidth: number
  changes?: { count: number; additions: number; deletions: number; files?: { path: string; additions: number; deletions: number; binary: boolean }[] }
  onChanges: (path?: string) => void
  onRetry?: () => void
  onEdit?: (text: string, images?: ImageBlock[]) => void
  tasks?: AgentTask[]
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
}

// Follows the bottom while the user is near it; a scroll away releases the pin.
const PIN_THRESHOLD = 40
const JUMP_THRESHOLD = 120
const TURN_GAP = 16
const TURN_OVERSCAN = 2
const ESTIMATED_TURN_HEIGHT = 160

export function MessageList({ turns, busy, result, readingWidth, changes, onChanges, onRetry, onEdit, tasks, onStopTask, onOpenTask }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const scrollFrame = useRef<number | undefined>(undefined)
  const heightsRef = useRef(new Map<string, number>())
  const offsetsRef = useRef(new Map<string, number>())
  const focusedTurn = useRef<string | undefined>(undefined)
  const [showJump, setShowJump] = useState(false)
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number }>()
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const [, setMeasured] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
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

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
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
    if (el && previousHeight !== undefined && !pinnedRef.current) {
      const top = offsetsRef.current.get(id)
      if (top !== undefined && top < el.scrollTop) el.scrollTop += height - previousHeight
    }
    setMeasured((value) => value + 1)
    if (pinnedRef.current) requestAnimationFrame(() => {
      const scroller = scrollRef.current
      if (!scroller) return
      scroller.scrollTop = scroller.scrollHeight
      setViewport({ top: scroller.scrollTop, height: scroller.clientHeight })
    })
  }, [])
  const showResult = result && !busy
  const visibleRows = layout.slice(visible.start, visible.end)
  const focusedRow = layout.find((row) => row.segment.id === focusedTurn.current)
  if (focusedRow && !visibleRows.some((row) => row.segment.id === focusedRow.segment.id)) {
    visibleRows.push(focusedRow)
    visibleRows.sort((a, b) => a.index - b.index)
  }

  function renderSegment(segment: Segment, index: number) {
    if (segment.role === "user") {
      return (
        <div className="group/message flex flex-col items-end gap-1">
          {segment.images?.length ? <MessageImages images={segment.images} onOpen={(items, imageIndex) => setPreview({ items, index: imageIndex })} /> : null}
          {segment.text && <UserBubble text={segment.text} />}
          <MessageActions text={segment.text} kind="user" onEdit={onEdit ? () => onEdit(segment.text, segment.images) : undefined} />
        </div>
      )
    }
    return (
      <AssistantSegment
        segment={segment}
        durationMs={segment.durationMs ?? (index === segments.length - 1 && !busy ? result?.durationMs : undefined)}
        interrupted={segment.interrupted ?? (index === segments.length - 1 && !busy ? result?.interrupted : undefined)}
        tasks={tasks}
        onStopTask={onStopTask}
        onOpenTask={onOpenTask}
      />
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onFocusCapture={(event) => {
        const turn = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-virtual-turn-id]") : null
        if (turn?.dataset.virtualTurnId) focusedTurn.current = turn.dataset.virtualTurnId
      }}
      className="noa-agent-scroll noa-scroll-fade relative flex-1 min-h-0 overflow-y-auto overscroll-contain"
    >
      <div ref={contentRef} className="mx-auto flex flex-col gap-4 px-5 pt-8" style={{ maxWidth: readingWidth, paddingBottom: "calc(var(--composer-overlay, 0px) + 32px)" }}>
        <div className="relative w-full" style={{ height: layoutHeight }}>
          {visibleRows.map((row) => (
            <VirtualTurnRow key={row.segment.id} id={row.segment.id} top={row.top} onHeight={measureTurn}>
              <div className="noa-turn-item noa-virtual-turn">{renderSegment(row.segment, row.index)}</div>
            </VirtualTurnRow>
          ))}
        </div>

        {/* Turn footer, as Codex's TurnDiffContent: status, then "· N files changed +a -d" as quiet inline text. */}
        {!busy && (showResult || !!changes?.count) && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[length:var(--text-chat-sm)] text-[var(--sidebar-text-muted,#898781)]">
            {showResult && (
              <span className={result.isError ? "text-[#C24444]" : undefined}>
                {result.interrupted
                  ? "Task stopped"
                  : result.isError
                    ? "Finished with an error"
                    : `Done in ${(result.durationMs / 1000).toFixed(1)}s`}
                {result.costUsd !== undefined && ` · $${result.costUsd.toFixed(4)}`}
              </span>
            )}
            {result?.isError && !result.interrupted && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="noa-press flex h-6 items-center rounded-md px-1.5 text-caption text-[var(--accent-color)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7.5%,transparent)]"
                title="Send the last message again"
              >
                Retry
              </button>
            )}
            {!!changes?.count && (
              <>
                {showResult && <span aria-hidden="true">·</span>}
                {/* Hover or focus reveals the per-file list, as Codex's TurnDiffContent tooltip does. */}
                <span className="noa-turn-diff-wrap">
                  <button type="button" onClick={() => onChanges()} className="noa-turn-diff">
                    <span className="truncate">{changes.count} {changes.count === 1 ? "file" : "files"} changed</span>
                    {changes.additions > 0 && <span className="is-added">+{changes.additions}</span>}
                    {changes.deletions > 0 && <span className="is-removed">-{changes.deletions}</span>}
                  </button>
                  {!!changes.files?.length && (
                    <ul className="noa-turn-diff-files noa-floating-panel">
                      {changes.files.map((file) => (
                        <li key={file.path}>
                          <button type="button" onClick={() => onChanges(file.path)} title={file.path}>
                            <span className="noa-middle-path">{file.path.includes("/") && <span className="noa-middle-path-dir">{file.path.slice(0, file.path.lastIndexOf("/") + 1)}</span>}<span className="noa-middle-path-base">{file.path.split("/").pop()}</span></span>
                            <span className="noa-turn-diff-stats">
                              {file.binary ? "Binary" : <>{file.additions > 0 && <span className="is-added">+{file.additions}</span>}{file.deletions > 0 && <span className="is-removed">-{file.deletions}</span>}</>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </span>
              </>
            )}
          </div>
        )}
      </div>

    </div>
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
      {preview && <Lightbox items={preview.items} index={preview.index} onIndex={(index) => setPreview({ ...preview, index })} onClose={() => setPreview(undefined)} />}
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
  durationMs?: number
  interrupted?: boolean
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
        durationMs: turn.durationMs ?? last.durationMs,
        interrupted: turn.interrupted ?? last.interrupted,
      }
    } else segments.push({
      role: "assistant",
      id: turn.id,
      blocks: turn.blocks,
      streaming: turn.streaming,
      durationMs: turn.durationMs,
      interrupted: turn.interrupted,
    })
  }
  return segments
}

// Tool calls and reasoning fold into one "Worked for" row; the final answer stays visible.
function AssistantSegment({ segment, durationMs, interrupted, tasks, onStopTask, onOpenTask }: {
  segment: AssistantSegmentData
  durationMs?: number
  interrupted?: boolean
  tasks?: AgentTask[]
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
}) {
  const units = groupActivityBlocks(segment.blocks)
  const [activityCollapsed, setActivityCollapsed] = useState(durationMs !== undefined && !segment.streaming)
  const activityToggled = useRef(false)
  const lastToolUnit = units.map((unit) => unit.kind === "tools").lastIndexOf(true)
  const workedForBefore = lastToolUnit === -1
    ? -1
    : units.findIndex((unit, index) => index > lastToolUnit && unit.kind === "text")
  useEffect(() => {
    if (!activityToggled.current && !segment.streaming && durationMs !== undefined) setActivityCollapsed(true)
  }, [durationMs, segment.streaming])
  function toggleActivity() {
    activityToggled.current = true
    setActivityCollapsed((collapsed) => !collapsed)
  }
  return (
    <div className="group flex flex-col gap-3">
      {units.map((unit, index) => {
        const workedFor = index === workedForBefore && durationMs !== undefined
          ? <WorkedFor durationMs={durationMs} interrupted={interrupted} collapsed={activityCollapsed} onToggle={toggleActivity} />
          : null
        if (unit.kind === "thinking") return <ThinkingBlock key={index} block={unit.block} />
        if (unit.kind === "text") {
          return (
            <div key={index} className="group/message flex flex-col gap-1">
              {workedFor}
              <BlockView block={unit.block} />
              <MessageActions text={unit.block.text} complete={unit.block.done ?? !segment.streaming} />
            </div>
          )
        }
        if (activityCollapsed) return null
        const block = unit.blocks.length === 1 ? unit.blocks[0] : undefined
        if (block) {
          const task = tasks?.find((candidate) => candidate.id === block.id || candidate.toolUseId === block.id)
          return <ToolCard key={index} block={block} task={task} defaultOpen={block.status === "running"} onStopTask={onStopTask} onOpenTask={onOpenTask} />
        }
        return (
          <WorkGroup
            key={index}
            blocks={unit.blocks}
            live={unit.blocks.some((block) => block.status === "running")}
            tasks={tasks}
            onStopTask={onStopTask}
            onOpenTask={onOpenTask}
          />
        )
      })}
      {durationMs !== undefined && workedForBefore === -1 && (
        <WorkedFor
          durationMs={durationMs}
          interrupted={interrupted}
          collapsed={activityCollapsed}
          onToggle={lastToolUnit === -1 ? undefined : toggleActivity}
        />
      )}
      {segment.streaming && segment.blocks.length === 0 && <Working />}
    </div>
  )
}

function WorkGroup({ blocks, live, tasks, onStopTask, onOpenTask }: {
  blocks: Extract<Block, { kind: "tool" }>[]
  live: boolean
  tasks?: AgentTask[]
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
}) {
  const [open, setOpen] = useState(live)
  const userToggled = useRef(false)
  const startedAt = useRef(live ? Date.now() : undefined)
  const [, setClock] = useState(0)

  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => setClock((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [live])

  useEffect(() => {
    if (!userToggled.current) setOpen(live)
  }, [live])

  const elapsedMs = live && startedAt.current !== undefined ? Date.now() - startedAt.current : undefined
  const workingLabel = elapsedMs !== undefined && elapsedMs >= 1000 ? `Working for ${formatDuration(elapsedMs)}` : "Working"
  const completedLabel = "Worked"
  const summary = toolActivitySummary(blocks)
  const SummaryIcon =
    summary?.kind === "edits" ? Edit2
      : summary?.kind === "images" ? Photo
        : summary?.kind === "commands" ? Terminal
          : summary?.kind === "reads" ? BookOpen
            : Tool

  function toggle() {
    userToggled.current = true
    setOpen((value) => !value)
  }

  return (
    <div className="not-prose" data-work-activity={live ? "live" : "done"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="group/activity inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-left text-[length:var(--text-chat-sm)] font-medium leading-5 text-[var(--text-tertiary,#8F8F8F)] select-none hover:text-[var(--text-primary,#2D2D2B)]"
      >
        <SummaryIcon size={14} aria-hidden="true" />
        <span className={live ? "noa-shimmer" : undefined}>
          {live ? workingLabel : summary?.label ?? completedLabel}
        </span>
        <ChevronRight size={14} className={`opacity-0 transition-[transform,opacity] duration-300 group-hover/activity:opacity-100 group-focus-visible/activity:opacity-100 ${open ? "rotate-90" : ""}`} />
      </button>
      <Collapsible open={open}>
        <div className="mt-2 flex flex-col gap-1">
          {blocks.map((block, i) => (
            <ToolCard
              key={i}
              block={block}
              task={tasks?.find((candidate) => candidate.id === block.id || candidate.toolUseId === block.id)}
              onStopTask={onStopTask}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      </Collapsible>
    </div>
  )
}

function WorkedFor({ durationMs, interrupted, collapsed, onToggle }: {
  durationMs: number
  interrupted?: boolean
  collapsed: boolean
  onToggle?: () => void
}) {
  const label = interrupted ? `You stopped after ${formatDuration(durationMs)}` : `Worked for ${formatDuration(durationMs)}`
  if (!onToggle) {
    return (
      <div className="flex w-full flex-col items-start gap-1 px-1 py-0.5 text-[length:var(--text-chat-sm)] text-[var(--sidebar-text-muted)]">
        <span className="whitespace-nowrap">{label}</span>
        <span className="h-px w-full bg-[var(--divider-subtle)]" aria-hidden="true" />
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="group/worked flex w-full flex-col items-start gap-1 rounded-md px-1 py-0.5 text-left text-[length:var(--text-chat-sm)] text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"
    >
      <span className="flex items-center gap-1 whitespace-nowrap">
        {label}
        <ChevronRight size={12} className={`opacity-0 transition-[transform,opacity] duration-150 group-hover/worked:opacity-100 group-focus-visible/worked:opacity-100 ${collapsed ? "" : "rotate-90"}`} />
      </span>
      <span className="h-px w-full bg-[var(--divider-subtle)]" aria-hidden="true" />
    </button>
  )
}

// Long user messages fold under a fade, as in Claude's chat bubbles; measured with ResizeObserver so width changes re-check.
const USER_COLLAPSE_HEIGHT = 300

function UserBubble({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setLong(el.scrollHeight > USER_COLLAPSE_HEIGHT)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const folded = long && !expanded
  return (
    <>
      <div
        ref={ref}
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] bg-[color-mix(in_srgb,var(--accent-color)_8%,transparent)] px-4 py-2.5 text-[length:var(--font-text-md-size)] leading-[var(--font-text-md-line-height)] ${
          folded ? "max-h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]" : ""
        }`}
      >
        {text}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-caption text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)]"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  )
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
  if (!text || !complete) return null
  const copyLabel = kind === "user" ? "Copy message" : "Copy response"
  return (
    <div className="mx-0.5 mb-1 flex gap-2 leading-4 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="flex size-6 items-center justify-center rounded-md text-[var(--text-secondary,#5D5D5D)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] noa-press"
        aria-label={copied ? "Copied" : copyLabel}
        title={copied ? "Copied" : copyLabel}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
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

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "text":
      return <Markdown text={block.text} />
    case "thinking":
      return (
        <ThinkingBlock block={block} />
      )
    case "tool":
      return <ToolCard block={block} />
  }
}

// Collapsed once the reasoning is done, as in Codex; open while it streams.
function ThinkingBlock({ block }: { block: Extract<Block, { kind: "thinking" }> }) {
  const [open, setOpen] = useState(!block.done)
  // The block mounts with its first token, so this is close to the reasoning's start.
  const startedAt = useRef<number | undefined>(block.done ? undefined : Date.now())
  const [elapsed, setElapsed] = useState<number>()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!block.done) return
    if (startedAt.current !== undefined) setElapsed((value) => value ?? Date.now() - startedAt.current!)
    setOpen(false)
  }, [block.done])
  const label = elapsed === undefined ? "Thought" : elapsed < 1000 ? "Thought for <1s" : `Thought for ${formatDuration(elapsed)}`
  async function copyQuote() {
    await navigator.clipboard.writeText(block.text.split("\n").map((line) => `> ${line}`).join("\n"))
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
      <Collapsible open={open}>
        <div className="noa-thinking-output mt-1.5">
          <pre className="m-0 px-1 font-mono text-[length:var(--code-font-size)] leading-5 whitespace-pre-wrap">{block.text}</pre>
        </div>
      </Collapsible>
    </div>
  )
}
