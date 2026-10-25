import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { createPortal } from "react-dom"
import type { AgentTask, Block, ToolBlock, Turn } from "../agent/reducer"
import { formatElapsed, toolActivityLabel, toolDiffStats, toolElapsedMs } from "../agent/toolActivity"
import { BookOpen, Check, ChevronRight, ChevronUp, Copy, Edit2, List, Photo, Search, Stop, Terminal, Tool, Users, X } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { Lightbox, type LightboxItem } from "./Lightbox"
import { CodeBlock, Markdown } from "./Markdown"

// A tool call as a quiet activity line; body details stay collapsed until requested.
export function ToolCard({ block, defaultOpen = false, task, onStopTask, onOpenTask }: {
  block: ToolBlock
  defaultOpen?: boolean
  task?: AgentTask
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
}) {
  const baseLabel = toolActivityLabel(block)
  const label = task
    ? {
        action: task.status === "unknown" ? "Subagent disconnected:" : task.status === "running" ? "Subagent working:" : task.status === "failed" ? "Subagent failed:" : task.status === "stopped" ? "Subagent stopped:" : "Subagent finished:",
        detail: task.description,
      }
    : baseLabel
  const [open, setOpen] = useState(defaultOpen)
  const userToggled = useRef(false)
  const [preview, setPreview] = useState<number>()
  const [rawOpen, setRawOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const Icon = toolIcon(block)
  const diffStats = toolDiffStats(block)
  const elapsed = toolElapsedMs(block, now)
  const elapsedLabel = block.name === "Bash" && elapsed !== undefined
    ? block.status === "running"
      ? `for ${formatElapsed(elapsed)}`
      : block.status === "stopped"
        ? `after ${formatElapsed(elapsed)}`
        : block.status === "done" ? `in ${formatElapsed(elapsed)}` : undefined
    : undefined

  useEffect(() => {
    if (!userToggled.current) setOpen(defaultOpen)
  }, [defaultOpen])
  useEffect(() => {
    if (block.status !== "running") return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [block.status])

  return (
    <div className="group/tool not-prose text-body" data-tool-activity={block.id}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${label.action}${label.detail ? ` ${label.detail}` : ""}`}
        onClick={() => {
          userToggled.current = true
          setOpen((value) => !value)
        }}
        className="flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm px-3 py-1.5 text-left text-[length:var(--text-chat-sm)] leading-5 select-none text-[color-mix(in_srgb,var(--text-primary)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary,#2D2D2B)]">
        <Icon size={14} className="shrink-0" aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate ${block.status === "running" ? "noa-shimmer" : ""}`}>
          <span>{label.action}</span>
          {label.detail && <span> {label.detail}</span>}
        </span>
        {elapsedLabel && <span className="shrink-0 tabular-nums opacity-80">{elapsedLabel}</span>}
        {diffStats && (
          <span className="shrink-0 text-caption tabular-nums">
            {diffStats.additions > 0 && <span className="text-[#168447]">+{diffStats.additions}</span>}
            {diffStats.deletions > 0 && <span className="ms-1 text-[#C24444]">-{diffStats.deletions}</span>}
          </span>
        )}
        <ChevronRight size={12} className={`shrink-0 opacity-0 transition-[transform,opacity] duration-300 group-hover/tool:opacity-100 group-focus-visible/tool:opacity-100 ${open ? "rotate-90" : ""}`} />
      </button>
      <Collapsible open={open}>
        <div className="mt-1 mb-2 flex flex-col gap-2 ps-1">
          {task ? <TaskDetail task={task} onStopTask={onStopTask} onOpenTask={onOpenTask} /> : renderBody(block, () => setRawOpen(true), () => setOpen(false))}
          {!!block.images?.length && (
            <ToolImages
              images={block.images}
              onOpen={(items, index) => setPreview(index)}
              preview={preview}
              onPreview={setPreview}
            />
          )}
        </div>
      </Collapsible>
      {rawOpen && block.output && (
        <RawOutputDialog title={label.action} language={block.name.startsWith("mcp__") ? "json" : "output"} code={block.output} onClose={() => setRawOpen(false)} />
      )}
    </div>
  )
}

function TaskDetail({ task, onStopTask, onOpenTask }: {
  task: AgentTask
  onStopTask?: (id: string) => void
  onOpenTask?: () => void
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-secondary)] px-2.5 py-2 text-caption">
      <div className="flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${task.status === "failed" ? "bg-[#C24444]" : task.status === "running" ? "bg-[var(--accent-color)] noa-status-running" : task.status === "completed" ? "bg-[#168447]" : "bg-[var(--sidebar-text-muted)]"}`} />
        <span className="font-medium capitalize text-[var(--text-secondary)]">{task.status}</span>
        {task.lastTool && <span className="min-w-0 truncate text-[var(--sidebar-text-muted)]">· {task.lastTool}</span>}
      </div>
      {task.summary && <p className="m-0 whitespace-pre-wrap break-words text-[var(--text-secondary)]">{task.summary}</p>}
      {task.usage && (
        <span className="tabular-nums text-[var(--sidebar-text-muted)]">
          {task.usage.tool_uses} tools · {(task.usage.duration_ms / 1000).toFixed(1)}s · {task.usage.total_tokens.toLocaleString()} tokens
        </span>
      )}
      {task.turns.length > 0 && <TaskTranscript turns={task.turns} />}
      {(onOpenTask || (onStopTask && task.status === "running" && task.id !== task.toolUseId)) && (
        <div className="mt-1 flex gap-2 border-t border-[var(--divider-subtle)] pt-2">
          {onOpenTask && (
            <button type="button" onClick={onOpenTask} className="rounded-md border border-[var(--divider-subtle)] px-2 py-1 text-caption">
              Open in Activity
            </button>
          )}
          {onStopTask && task.status === "running" && task.id !== task.toolUseId && (
            <button type="button" onClick={() => onStopTask(task.id)} className="rounded-md border border-[var(--divider-subtle)] px-2 py-1 text-caption text-[#C24444]">
              Stop task
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function TaskTranscript({ turns }: { turns: Turn[] }) {
  return (
    <div className="noa-task-transcript mt-1 flex max-h-80 flex-col gap-2 overflow-y-auto border-t border-[var(--divider-subtle)] pt-2">
      {turns.map((turn) => turn.role === "assistant" ? (
        turn.blocks.map((block, index) => <TaskBlock key={`${turn.id}:${index}`} block={block} />)
      ) : null)}
    </div>
  )
}

function TaskBlock({ block }: { block: Block }) {
  if (block.kind === "text") return <Markdown text={block.text} />
  if (block.kind === "tool") return <ToolCard block={block} />
  return null
}

function toolIcon(block: ToolBlock) {
  const file = str(block.input.file_path)
  if (block.status === "stopped" && block.name === "Bash") return Stop
  if (block.name === "Bash") return Terminal
  if (block.name === "Grep" || block.name === "Glob") return Search
  if (block.name === "Task") return Users
  if (/\.(?:avif|gif|jpe?g|png|webp)$/i.test(file)) return Photo
  if (block.name === "Edit" || block.name === "MultiEdit" || block.name === "Write") return Edit2
  if (block.name === "Read") return BookOpen
  if (block.name === "List") return List
  return Tool
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

function renderBody(block: ToolBlock, onRaw: () => void, onCollapse: () => void) {
  const i = block.input
  const output = block.output?.trim() ? <CodeBlock lang="output" code={block.output} /> : null
  const image = /\.(?:avif|gif|jpe?g|png|webp)$/i.test(str(i.file_path))
  if (block.name === "ViewImage" || (block.name === "Read" && (image || block.images?.length))) return block.status === "error" || !block.images?.length ? output : null

  switch (block.name) {
    case "Bash":
      return <ShellOutput block={block} onCollapse={onCollapse} />
    case "Read":
    case "Grep":
    case "Glob":
    case "List":
    case "Task":
      return output ?? <EmptyToolBody label={block.status === "running" ? "Waiting for result…" : "No output"} />
    case "Edit":
      return (
        <>
          <DiffView oldText={str(i.old_string)} newText={str(i.new_string)} />
          {output}
        </>
      )
    case "MultiEdit": {
      const edits = Array.isArray(i.edits)
        ? i.edits.filter((edit): edit is Record<string, unknown> => typeof edit === "object" && edit !== null)
        : []
      return (
        <>
          {edits.map((edit, index) => (
            <DiffView key={index} oldText={str(edit.old_string)} newText={str(edit.new_string)} />
          ))}
          {output}
        </>
      )
    }
    case "Write":
      return (
        <>
          <CodeBlock lang={basename(str(i.file_path))} code={str(i.content)} />
          {output}
        </>
      )
    default:
      return output ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="max-h-48 overflow-auto">{output}</div>
          <button type="button" onClick={onRaw} className="self-start rounded-md px-2 py-1 text-caption text-[var(--accent-color)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
            Raw output
          </button>
        </div>
      ) : <EmptyToolBody label={block.status === "running" ? "Waiting for result…" : "No details available"} />
  }
}

function RawOutputDialog({ title, language, code, onClose }: {
  title: string
  language: string
  code: string
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = overflow
      restoreFocus.current?.focus?.()
    }
  }, [])

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-6 backdrop-blur-[2px]" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} raw output`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="noa-confirm-dialog flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-panel bg-[var(--bg-card)] shadow-[var(--shadow-dialog)]"
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--divider-subtle)] px-3 text-body">
          <span className="truncate">{title}</span>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close raw output" className="rounded p-1 text-[var(--sidebar-text-muted)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 overflow-auto p-3">
          <CodeBlock lang={language} code={code} />
        </div>
      </section>
    </div>,
    document.body,
  )
}

function EmptyToolBody({ label }: { label: string }) {
  return <p className="m-0 px-1 py-1 text-caption text-[var(--sidebar-text-muted)]">{label}</p>
}

function ToolImages({ images, onOpen, preview, onPreview }: {
  images: NonNullable<ToolBlock["images"]>
  onOpen: (items: LightboxItem[], index: number) => void
  preview?: number
  onPreview: (index: number | undefined) => void
}) {
  const items = images.map((image, index) => ({
    src: `data:${image.source.media_type};base64,${image.source.data}`,
    alt: `Tool result image ${index + 1}`,
  }))
  return (
    <>
      <div className="hide-scrollbar flex max-w-full gap-2 overflow-x-auto pb-1">
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Open ${item.alt}`}
            onClick={() => onOpen(items, index)}
            className="noa-press size-32 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-secondary)]"
          >
            <img src={item.src} alt={item.alt} className="size-full object-cover" />
          </button>
        ))}
      </div>
      {preview !== undefined && (
        <Lightbox items={items} index={preview} onIndex={onPreview} onClose={() => onPreview(undefined)} />
      )}
    </>
  )
}

function ShellOutput({ block, onCollapse }: { block: ToolBlock; onCollapse: () => void }) {
  const command = str(block.input.command)
  const output = block.output ?? ""
  const [copied, setCopied] = useState<"all" | "command" | "output">()
  const [copyError, setCopyError] = useState(false)
  const [commandExpanded, setCommandExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])
  useEffect(() => {
    const element = outputRef.current
    if (!element) return
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [output])

  async function copy(kind: "all" | "command" | "output", text: string) {
    try { await navigator.clipboard.writeText(text) } catch { setCopyError(true); return }
    setCopyError(false)
    setCopied(kind)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(undefined), 1500)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-secondary,#F9F9F7)]">
      <div className="flex h-8 items-center justify-between border-b border-[var(--divider-subtle)] px-3 text-caption text-[var(--sidebar-text-muted,#898781)]">
        <span>Shell</span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/tool:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => copy("all", [`$ ${command}`, output].filter(Boolean).join("\n"))}
            className="flex size-5 items-center justify-center rounded hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]"
            aria-label={copied === "all" ? "Copied shell contents" : "Copy shell contents"}
            title={copied === "all" ? "Copied shell contents" : "Copy shell contents"}
          >
            {copied === "all" ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="flex size-5 items-center justify-center rounded hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]"
            aria-label="Collapse shell"
            title="Collapse shell"
          >
            <ChevronUp size={12} />
          </button>
        </div>
      </div>
      <div className="group/command relative py-2">
        <pre
          role="button"
          tabIndex={0}
          aria-expanded={commandExpanded}
          onClick={() => setCommandExpanded((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            setCommandExpanded((value) => !value)
          }}
          className={`m-0 cursor-pointer whitespace-pre-wrap break-words pe-8 ps-3 font-mono text-[length:var(--code-font-size)] leading-[max(1.5em,20px)] text-[var(--text-secondary,#5D5D5D)] ${commandExpanded ? "" : "line-clamp-2"}`}
        >
          <span className="text-[var(--text-tertiary,#8F8F8F)]">$</span> {command}
        </pre>
        <button
          type="button"
          onClick={() => copy("command", command)}
          className="absolute end-1 top-1 flex size-5 items-center justify-center rounded text-[var(--sidebar-text-muted,#898781)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] focus-visible:opacity-100 group-hover/command:opacity-100"
          aria-label={copied === "command" ? "Copied command" : "Copy command"}
          title={copied === "command" ? "Copied command" : "Copy command"}
        >
          {copied === "command" ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      {output ? (
        <div className="group/output relative">
          <div ref={outputRef} role="region" aria-label="Command output" tabIndex={0} onKeyDown={(event) => { if (event.key === "Home" || event.key === "End") { event.preventDefault(); event.currentTarget.scrollTop = event.key === "End" ? 0 : -event.currentTarget.scrollHeight } }} className="noa-shell-output" data-overflow={overflowing}>
            <pre className="m-0 px-3 py-2 font-mono text-[length:var(--code-font-size)] leading-[max(1.5em,20px)] whitespace-pre">{output}</pre>
          </div>
          <button
            type="button"
            onClick={() => copy("output", output)}
            className="absolute end-1 top-1 flex size-5 items-center justify-center rounded text-[var(--sidebar-text-muted,#898781)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] focus-visible:opacity-100 group-hover/output:opacity-100"
            aria-label={copied === "output" ? "Copied output" : "Copy output"}
            title={copied === "output" ? "Copied output" : "Copy output"}
          >
            {copied === "output" ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      ) : block.status === "running" ? (
        <div className="px-3 pb-2 text-caption text-[var(--sidebar-text-muted,#898781)]">Waiting for output…</div>
      ) : (
        <div className="px-3 pb-2 text-caption text-[var(--sidebar-text-muted,#898781)]">No output</div>
      )}
      {copyError && <span role="status" className="px-3 text-caption text-[#C24444]">Could not copy. Try again.</span>}
      {block.status !== "running" && (
        <div className={`flex items-center justify-end gap-1 border-t border-[var(--divider-subtle)] px-3 py-1 text-caption ${block.status === "error" ? "text-[#C24444]" : "text-[var(--sidebar-text-muted,#898781)]"}`}>
          {block.status === "error" ? (
            block.exitCode !== undefined ? `Exit code ${block.exitCode}` : "Error"
          ) : block.status === "unknown" ? (
            "Connection lost"
          ) : block.status === "stopped" || block.interrupted ? (
            "Stopped"
          ) : (
            <>
              <Check size={12} aria-hidden="true" />
              Success
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <pre className="m-0 overflow-auto rounded-panel bg-[var(--bg-secondary,#F9F9F7)] py-1 font-mono text-[length:var(--code-font-size)] leading-[1.55] max-h-80">
      {oldText.split("\n").map((line, i) => (
        <div key={`-${i}`} className="whitespace-pre-wrap bg-[rgba(212,85,85,0.12)] px-3">
          -{line}
        </div>
      ))}
      {newText.split("\n").map((line, i) => (
        <div key={`+${i}`} className="whitespace-pre-wrap bg-[rgba(16,185,129,0.12)] px-3">
          +{line}
        </div>
      ))}
    </pre>
  )
}
