import { useEffect, useRef, useState } from "react"
import type { AgentState, Block, Turn } from "../agent/reducer"
import { ArrowDown, Check, ChevronRight, Copy } from "../lib/icons"
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
}

// Follows the bottom while the user is near it; a scroll away releases the pin.
const PIN_THRESHOLD = 40
const JUMP_THRESHOLD = 120

export function MessageList({ turns, busy, result, readingWidth, changes, onChanges }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [turns])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinnedRef.current = distance <= PIN_THRESHOLD
    setShowJump(distance > JUMP_THRESHOLD)
  }

  function jumpToBottom() {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = true
    el.scrollTop = el.scrollHeight
    setShowJump(false)
  }

  const segments = groupTurns(turns)
  const showResult = result && !busy

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scrollRef} onScroll={onScroll} className="noa-scroll-fade relative flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex flex-col gap-4 px-5 pt-8" style={{ maxWidth: readingWidth, paddingBottom: "calc(var(--composer-overlay, 0px) + 32px)" }}>
        {segments.map((segment, index) =>
          segment.role === "user" ? (
            // The user's message is a right-aligned bubble, as in Codex: chat-size text, relaxed leading.
            <div key={segment.id} className="group flex flex-col items-end gap-1">
              {segment.images?.length ? <div className="flex flex-wrap justify-end gap-2">{segment.images.map((image, i) => <a key={i} href={`data:${image.source.media_type};base64,${image.source.data}`} target="_blank" rel="noreferrer"><img src={`data:${image.source.media_type};base64,${image.source.data}`} alt={`Attached image ${i + 1}`} className="max-h-56 max-w-64 rounded-xl border border-[var(--divider-subtle)] object-contain" /></a>)}</div> : null}
              {segment.text && <UserBubble text={segment.text} />}
              <MessageActions text={segment.text} />
            </div>
          ) : (
            <AssistantSegment
              key={segment.id}
              segment={segment}
              durationMs={index === segments.length - 1 && !busy ? result?.durationMs : undefined}
            />
          ),
        )}

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
    </div>
  )
}

type AssistantSegmentData = { role: "assistant"; id: string; blocks: Block[]; streaming: boolean }
type Segment = Extract<Turn, { role: "user" }> | AssistantSegmentData

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
      }
    } else segments.push({ role: "assistant", id: turn.id, blocks: turn.blocks, streaming: turn.streaming })
  }
  return segments
}

// Tool calls and reasoning fold into one "Worked for" row; the final answer stays visible.
function AssistantSegment({ segment, durationMs }: { segment: AssistantSegmentData; durationMs?: number }) {
  const lastWork = segment.blocks.map((b) => b.kind !== "text").lastIndexOf(true)
  const work = segment.blocks.slice(0, lastWork + 1)
  const answer = segment.blocks.slice(lastWork + 1)
  const answerText = answer
    .filter((b) => b.kind === "text")
    .map((b) => b.text)
    .join("\n\n")
  return (
    <div className="group flex flex-col gap-3">
      {work.length > 0 && <WorkGroup blocks={work} live={segment.streaming} durationMs={durationMs} />}
      {segment.streaming && segment.blocks.length === 0 && <Working />}
      {answer.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
      {!segment.streaming && answerText && <MessageActions text={answerText} />}
    </div>
  )
}

function WorkGroup({ blocks, live, durationMs }: { blocks: Block[]; live: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="not-prose">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-left text-[length:var(--text-chat-sm)] font-medium leading-5 text-[var(--text-tertiary,#8F8F8F)] select-none hover:text-[var(--text-primary,#2D2D2B)]"
      >
        {live ? (
          <span className="noa-shimmer">Working…</span>
        ) : (
          <span>{durationMs === undefined ? "Worked" : `Worked for ${formatDuration(durationMs)}`}</span>
        )}
        <ChevronRight size={14} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      <Collapsible open={open}>
        <div className="mt-2 flex flex-col gap-2 border-l border-[var(--divider-subtle)] pl-3">
          {blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </div>
      </Collapsible>
    </div>
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
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] px-4 py-2.5 text-[length:var(--font-text-md-size)] leading-[var(--font-text-md-line-height)] ${
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
  return <div className="noa-shimmer py-1 text-[length:var(--font-text-md-size)] leading-5">Working…</div>
}

function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <div className="mx-0.5 mb-1 flex gap-2 leading-4 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-caption text-[var(--text-secondary,#5D5D5D)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] noa-press"
        aria-label="Copy task output"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
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
  useEffect(() => {
    if (block.done) setOpen(false)
  }, [block.done])
  return (
    <div className="text-[length:var(--text-chat-sm)] leading-5 text-[var(--sidebar-text-muted,#898781)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-left select-none hover:text-[var(--text-primary,#2D2D2B)]"
      >
        {block.done ? (
          <span>Thought process</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="noa-quiet-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="noa-shimmer">Thinking…</span>
          </span>
        )}
        <ChevronRight size={14} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      <Collapsible open={open}>
        <div className="mt-1.5 whitespace-pre-wrap border-l border-[var(--divider-subtle)] pl-3 font-mono">{block.text}</div>
      </Collapsible>
    </div>
  )
}
