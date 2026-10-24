import { useEffect, useRef, useState } from "react"
import type { AgentState, Block, Turn } from "../agent/reducer"
import { Check, ChevronRight, Copy } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { Markdown } from "./Markdown"
import { ToolCard } from "./ToolCard"

interface MessageListProps {
  turns: Turn[]
  busy: boolean
  result?: AgentState["result"]
  readingWidth: number
}

// Follows the bottom while the user is near it; a scroll away releases the pin.
const PIN_THRESHOLD = 40
const JUMP_THRESHOLD = 120

export function MessageList({ turns, busy, result, readingWidth }: MessageListProps) {
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
    <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex flex-col gap-6 px-8 py-8" style={{ maxWidth: readingWidth }}>
        {segments.map((segment, index) =>
          segment.role === "user" ? (
            // The user's message is a right-aligned bubble, as in Codex: chat-size text, relaxed leading.
            <div key={segment.id} className="group flex flex-col items-end gap-1">
              <UserBubble text={segment.text} />
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

        {showResult && (
          <div
            className={`font-mono text-caption ${result.isError ? "text-[#C24444]" : "text-[var(--sidebar-text-muted,#898781)]"}`}
          >
            {result.interrupted
              ? "Task stopped"
              : result.isError
                ? "Finished with an error"
                : `Done in ${(result.durationMs / 1000).toFixed(1)}s`}
            {result.costUsd !== undefined && ` · $${result.costUsd.toFixed(4)}`}
          </div>
        )}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="sticky bottom-2 mx-auto block h-6 rounded-full bg-[var(--bg-card,#FFFFFF)] px-3 text-[length:var(--text-chat-sm)] shadow-[var(--shadow-floating)] noa-press"
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}

type AssistantSegmentData = { role: "assistant"; id: string; blocks: Block[]; streaming: boolean }
type Segment = { role: "user"; id: string; text: string } | AssistantSegmentData

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
        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-left text-[length:var(--font-text-md-size)] leading-5 text-[var(--sidebar-text-muted,#898781)] select-none hover:text-[var(--text-primary,#2D2D2B)]"
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
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] px-4 py-2.5 text-[length:var(--font-text-md-size)] leading-[var(--font-text-md-line-height)] ${
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
    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-caption text-[var(--sidebar-text-muted,#898781)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] noa-press"
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
