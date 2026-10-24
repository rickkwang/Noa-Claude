import { useState } from "react"
import type { ToolBlock } from "../agent/reducer"
import { ChevronRight } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { CodeBlock } from "./Markdown"

// A tool call as a quiet activity line, like Claude's tool rows; the body expands on click.
// Collapsed by default, like Codex's command rows; status shows in the dot, not by opening the body.
export function ToolCard({ block }: { block: ToolBlock }) {
  const kind = block.status === "running" ? "running" : block.status === "error" ? "error" : "ready"
  const [open, setOpen] = useState(false)
  return (
    <div className="not-prose text-body">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm px-3 py-1.5 text-left text-[length:var(--text-chat-sm)] leading-5 select-none text-[var(--text-tertiary,#8F8F8F)] hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary,#2D2D2B)]">
        <span
          data-kind={kind}
          className="size-1.5 shrink-0 rounded-full bg-[var(--sidebar-text-muted,#898781)] data-[kind=error]:bg-[#D45555] data-[kind=running]:noa-status-running data-[kind=running]:bg-[var(--accent-color,#CC7D5E)]"
        />
        <span className="shrink-0 font-mono text-[var(--text-primary,#2D2D2B)]">{block.name}</span>
        <span className={`min-w-0 flex-1 truncate font-mono text-[var(--text-tertiary,#8F8F8F)] ${kind === "running" ? "noa-shimmer" : ""}`}>{previewOf(block)}</span>
        <ChevronRight size={12} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      <Collapsible open={open}>
        <div className="mt-1 mb-2 flex flex-col gap-2 border-l border-[var(--divider-subtle)] pl-3">{renderBody(block)}</div>
      </Collapsible>
    </div>
  )
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

// One-line summary shown next to the tool name.
function previewOf(block: ToolBlock): string {
  const i = block.input
  switch (block.name) {
    case "Bash":
      return str(i.command)
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return basename(str(i.file_path))
    case "Grep":
    case "Glob":
      return str(i.pattern)
    case "Task":
      return str(i.description)
    default:
      return Object.values(i).find((v) => typeof v === "string")?.toString().slice(0, 80) ?? ""
  }
}

function renderBody(block: ToolBlock) {
  const i = block.input
  const output = block.output !== undefined ? <CodeBlock lang="output" code={block.output} /> : null

  switch (block.name) {
    case "Bash":
      return (
        <>
          <CodeBlock lang="bash" code={str(i.command)} />
          {output}
        </>
      )
    case "Edit":
      return (
        <>
          <DiffView oldText={str(i.old_string)} newText={str(i.new_string)} />
          {output}
        </>
      )
    case "Write":
      return (
        <>
          <CodeBlock lang={basename(str(i.file_path))} code={str(i.content)} />
          {output}
        </>
      )
    default: {
      const input = block.status === "running" && Object.keys(i).length === 0 ? block.partialJson : JSON.stringify(i, null, 2)
      return (
        <>
          {input && <CodeBlock lang="input" code={input} />}
          {output}
        </>
      )
    }
  }
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
