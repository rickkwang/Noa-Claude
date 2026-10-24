import { useEffect, useRef, useState } from "react"
import type { AgentTask, ToolBlock } from "../agent/reducer"
import { toolActivityLabel } from "../agent/toolActivity"
import { BookOpen, Check, ChevronRight, Copy, Edit2, List, Photo, Search, Terminal, Tool, Users } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { Lightbox, type LightboxItem } from "./Lightbox"
import { CodeBlock } from "./Markdown"

// A tool call as a quiet activity line; body details stay collapsed until requested.
export function ToolCard({ block, defaultOpen = false, task }: { block: ToolBlock; defaultOpen?: boolean; task?: AgentTask }) {
  const baseLabel = toolActivityLabel(block)
  const label = task
    ? {
        action: task.status === "running" ? "Subagent working:" : task.status === "failed" ? "Subagent failed:" : task.status === "stopped" ? "Subagent stopped:" : "Subagent finished:",
        detail: task.description,
      }
    : baseLabel
  const [open, setOpen] = useState(defaultOpen)
  const userToggled = useRef(false)
  const [preview, setPreview] = useState<number>()
  const Icon = toolIcon(block)

  useEffect(() => {
    if (!userToggled.current) setOpen(defaultOpen)
  }, [defaultOpen])

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
        className="flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm px-3 py-1.5 text-left text-[length:var(--text-chat-sm)] leading-5 select-none text-[var(--text-tertiary,#8F8F8F)] hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary,#2D2D2B)]">
        <Icon size={14} className="shrink-0 text-[var(--text-tertiary,#8F8F8F)]" aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate ${block.status === "running" ? "noa-shimmer" : ""}`}>
          <span className="font-medium text-[var(--text-secondary,#5D5D5D)] group-hover/tool:text-[var(--text-primary,#2D2D2B)]">{label.action}</span>
          {label.detail && <span className="text-[var(--text-tertiary,#8F8F8F)]"> {label.detail}</span>}
        </span>
        <ChevronRight size={12} className={`shrink-0 opacity-0 transition-[transform,opacity] duration-300 group-hover/tool:opacity-100 group-focus-visible/tool:opacity-100 ${open ? "rotate-90" : ""}`} />
      </button>
      <Collapsible open={open}>
        <div className="mt-1 mb-2 flex flex-col gap-2 ps-1">
          {task ? <TaskDetail task={task} /> : renderBody(block)}
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
    </div>
  )
}

function TaskDetail({ task }: { task: AgentTask }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-secondary)] px-2.5 py-2 text-caption">
      <div className="flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${task.status === "failed" ? "bg-[#C24444]" : task.status === "running" ? "bg-[var(--accent-color)] noa-status-running" : "bg-[#168447]"}`} />
        <span className="font-medium capitalize text-[var(--text-secondary)]">{task.status}</span>
        {task.lastTool && <span className="min-w-0 truncate text-[var(--sidebar-text-muted)]">· {task.lastTool}</span>}
      </div>
      {task.summary && <p className="m-0 whitespace-pre-wrap break-words text-[var(--text-secondary)]">{task.summary}</p>}
      {task.usage && (
        <span className="text-[var(--sidebar-text-muted)]">
          {task.usage.tool_uses} tools · {(task.usage.duration_ms / 1000).toFixed(1)}s · {task.usage.total_tokens.toLocaleString()} tokens
        </span>
      )}
    </div>
  )
}

function toolIcon(block: ToolBlock) {
  const file = str(block.input.file_path)
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

function renderBody(block: ToolBlock) {
  const i = block.input
  const output = block.output?.trim() ? <CodeBlock lang="output" code={block.output} /> : null
  const image = /\.(?:avif|gif|jpe?g|png|webp)$/i.test(str(i.file_path))
  if (block.name === "ViewImage" || (block.name === "Read" && (image || block.images?.length))) return null

  switch (block.name) {
    case "Bash":
      return <ShellOutput block={block} />
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
      return output ?? <EmptyToolBody label={block.status === "running" ? "Waiting for result…" : "No details available"} />
  }
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

function ShellOutput({ block }: { block: ToolBlock }) {
  const command = str(block.input.command).replace(/\s+/g, " ").trim()
  const output = block.output ?? ""
  const [copied, setCopied] = useState(false)
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

  async function copy() {
    await navigator.clipboard.writeText([`$ ${command}`, output].filter(Boolean).join("\n"))
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-secondary,#F9F9F7)]">
      <div className="flex h-8 items-center justify-between border-b border-[var(--divider-subtle)] px-3 text-caption text-[var(--sidebar-text-muted,#898781)]">
        <span>Shell</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 opacity-0 transition-opacity group-hover/tool:opacity-100 focus-visible:opacity-100 hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]"
          aria-label="Copy shell command and output"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words px-3 pt-2 font-mono text-[length:var(--code-font-size)] leading-5 text-[var(--text-secondary,#5D5D5D)]"><span className="text-[var(--text-tertiary,#8F8F8F)]">$</span> {command}</pre>
      {output ? (
        <div ref={outputRef} className="noa-shell-output" data-overflow={overflowing}>
          <pre className="m-0 px-3 py-2 font-mono text-[length:var(--code-font-size)] leading-5 whitespace-pre">{output}</pre>
        </div>
      ) : block.status === "running" ? (
        <div className="px-3 pb-2 text-caption text-[var(--sidebar-text-muted,#898781)]">Waiting for output…</div>
      ) : (
        <div className="px-3 pb-2 text-caption text-[var(--sidebar-text-muted,#898781)]">No output</div>
      )}
      <div className={`flex items-center justify-end border-t border-[var(--divider-subtle)] px-3 py-1 text-caption ${block.status === "error" ? "text-[#C24444]" : "text-[var(--sidebar-text-muted,#898781)]"}`}>
        {block.status === "running"
          ? "Running"
          : block.interrupted
            ? "Interrupted"
            : block.exitCode !== undefined
              ? `Exit code ${block.exitCode}`
              : block.status === "error" ? "Error" : "Success"}
      </div>
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
