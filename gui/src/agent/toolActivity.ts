import type { Block, ToolBlock } from "./reducer"

export interface ToolActivityLabel {
  action: string
  detail: string
}

export interface ToolActivitySummary {
  label: string
  kind: "commands" | "edits" | "images" | "reads" | "tools"
}

export interface ToolDiffStats {
  additions: number
  deletions: number
}

const MAX_DIFF_CELLS = 250_000

export type ThinkingBlock = Extract<Block, { kind: "thinking" }>

export type ActivityUnit =
  | { kind: "tools"; blocks: ToolBlock[] }
  | { kind: "thinking"; block: ThinkingBlock }
  | { kind: "text"; block: Extract<Block, { kind: "text" }> }

// Codex renders one collapsible activity group per run of reasoning and tool
// calls. Text breaks the run and is always visible outside the group.
export type ActivityRun =
  | { kind: "activity"; blocks: (ToolBlock | ThinkingBlock)[] }
  | { kind: "text"; block: Extract<Block, { kind: "text" }> }

export function groupActivityRuns(units: ActivityUnit[]): ActivityRun[] {
  const runs: ActivityRun[] = []
  let blocks: (ToolBlock | ThinkingBlock)[] = []
  const flush = () => {
    if (blocks.length) runs.push({ kind: "activity", blocks })
    blocks = []
  }
  for (const unit of units) {
    if (unit.kind === "text") {
      flush()
      runs.push(unit)
    } else if (unit.kind === "thinking") blocks.push(unit.block)
    else blocks.push(...unit.blocks)
  }
  flush()
  return runs
}

function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
}

function basename(value: unknown): string {
  const path = oneLine(value)
  return path.split("/").filter(Boolean).pop() ?? path
}

function firstText(input: Record<string, unknown>): string {
  return oneLine(Object.values(input).find((value) => typeof value === "string" && value.trim()))
}

export function toolActivityLabel(block: Pick<ToolBlock, "name" | "input" | "status" | "images">): ToolActivityLabel {
  const running = block.status === "running"
  const failed = block.status === "error"
  const command = oneLine(block.input.command)
  const target = basename(block.input.file_path)
  const pattern = oneLine(block.input.pattern)
  if (block.name.startsWith("mcp__")) {
    const [, server, ...toolParts] = block.name.split("__")
    const tool = toolParts.join("__") || server || block.name
    return {
      action: failed ? `Couldn’t call ${tool}` : running ? `Calling ${tool}` : `Used ${tool}`,
      detail: server && server !== tool ? server : "",
    }
  }

  switch (block.name) {
    case "Bash":
      return { action: failed ? "Failed to run" : running ? "Running" : "Ran", detail: command || "command" }
    case "Read":
      if (/\.(?:avif|gif|jpe?g|png|webp)$/i.test(target))
        return {
          action: failed ? "Couldn’t view" : running ? "Viewing" : "Viewed",
          detail: (block.images?.length ?? 0) > 1 ? `${block.images!.length} images` : "an image",
        }
      return { action: failed ? "Couldn’t read" : running ? "Reading" : "Read", detail: target || "file" }
    case "Write":
      return { action: failed ? "Couldn’t write" : running ? "Writing" : "Wrote", detail: target || "file" }
    case "Edit":
    case "MultiEdit":
      return { action: failed ? "Couldn’t edit" : running ? "Editing" : "Edited", detail: target || "file" }
    case "Grep":
      return { action: failed ? "Search failed for" : running ? "Searching for" : "Searched for", detail: pattern || "files" }
    case "Glob":
      return { action: failed ? "Couldn’t find" : running ? "Finding" : "Found", detail: pattern || "files" }
    case "Task":
      return {
        action: failed ? "Subagent failed:" : running ? "Starting subagent:" : "Ran subagent:",
        detail: oneLine(block.input.description) || block.name,
      }
    default:
      return {
        action: failed ? `Failed using ${block.name}` : running ? `Calling ${block.name}` : `Used ${block.name}`,
        detail: firstText(block.input),
      }
  }
}

export function toolActivitySummary(blocks: Pick<ToolBlock, "name" | "input">[]): ToolActivitySummary | undefined {
  let commands = 0
  let images = 0
  let reads = 0
  let tools = 0
  const editedFiles = new Set<string>()

  blocks.forEach((block, index) => {
    const file = oneLine(block.input.file_path)
    if ((block.name === "Read" && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(file)) || block.name === "ViewImage") {
      images++
    } else if (block.name === "Bash") {
      commands++
    } else if (block.name === "Read" || block.name === "Grep" || block.name === "Glob" || block.name === "List") {
      reads++
    } else if (block.name === "Write" || block.name === "Edit" || block.name === "MultiEdit") {
      editedFiles.add(file || `${block.name}:${index}`)
    } else {
      tools++
    }
  })
  const edits = editedFiles.size

  const parts: string[] = []
  if (edits) parts.push(edits === 1 ? "Edited a file" : "Edited files")
  if (reads) parts.push("Read files")
  if (commands) parts.push(commands === 1 ? "Ran a command" : "Ran commands")
  if (images) parts.push(images === 1 ? "Viewed an image" : `Viewed ${images} images`)
  if (tools) parts.push(tools === 1 ? "Used a tool" : "Used tools")
  if (parts.length === 0) return undefined

  const kind =
    edits ? "edits"
      : images ? "images"
        : commands ? "commands"
          : reads ? "reads"
            : "tools"
  const label = parts.map((part, index) => index === 0 ? part : part[0]!.toLowerCase() + part.slice(1)).join(", ")
  return { label, kind }
}

export function toolDiffStats(block: Pick<ToolBlock, "name" | "input">): ToolDiffStats | undefined {
  if (block.name === "Write") {
    const content = typeof block.input.content === "string" ? block.input.content : ""
    return { additions: textLines(content).length, deletions: 0 }
  }
  if (block.name === "Edit") {
    return lineDiffStats(
      typeof block.input.old_string === "string" ? block.input.old_string : "",
      typeof block.input.new_string === "string" ? block.input.new_string : "",
    )
  }
  if (block.name === "MultiEdit" && Array.isArray(block.input.edits)) {
    return block.input.edits.reduce<ToolDiffStats | undefined>((total, edit) => {
      if (!total || typeof edit !== "object" || edit === null) return total
      const value = edit as Record<string, unknown>
      const stats = lineDiffStats(
        typeof value.old_string === "string" ? value.old_string : "",
        typeof value.new_string === "string" ? value.new_string : "",
      )
      if (!stats) return undefined
      return {
        additions: total.additions + stats.additions,
        deletions: total.deletions + stats.deletions,
      }
    }, { additions: 0, deletions: 0 })
  }
  return undefined
}

function textLines(text: string): string[] {
  if (!text) return []
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines
}

function lineDiffStats(oldText: string, newText: string): ToolDiffStats | undefined {
  const before = textLines(oldText)
  const after = textLines(newText)
  if (before.length * after.length > MAX_DIFF_CELLS) return undefined
  let previous = new Uint32Array(after.length + 1)
  for (let i = 1; i <= before.length; i++) {
    const next = new Uint32Array(after.length + 1)
    for (let j = 1; j <= after.length; j++) {
      next[j] = before[i - 1] === after[j - 1]
        ? previous[j - 1]! + 1
        : Math.max(previous[j]!, next[j - 1]!)
    }
    previous = next
  }
  const common = previous[after.length]!
  return {
    additions: after.length - common,
    deletions: before.length - common,
  }
}

export function isImageActivity(block: Pick<ToolBlock, "name" | "input" | "images">): boolean {
  return !!block.images?.length ||
    block.name === "ViewImage" ||
    (block.name === "Read" && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(oneLine(block.input.file_path)))
}

export function isStandaloneActivity(block: Pick<ToolBlock, "name" | "input" | "images">): boolean {
  return block.name === "Task" || isImageActivity(block)
}

export function groupActivityBlocks(blocks: Block[]): ActivityUnit[] {
  const units: ActivityUnit[] = []
  let tools: ToolBlock[] = []
  const flush = () => {
    if (tools.length) units.push({ kind: "tools", blocks: tools })
    tools = []
  }

  for (const block of blocks) {
    if (block.kind === "tool" && !isStandaloneActivity(block)) {
      tools.push(block)
      continue
    }
    if (block.kind === "tool") {
      flush()
      units.push({ kind: "tools", blocks: [block] })
      continue
    }
    if (block.kind === "thinking") {
      // Completed reasoning stays as a collapsed row; only empty placeholders are dropped.
      if (!block.done || block.text.trim()) {
        flush()
        units.push({ kind: "thinking", block })
      }
      continue
    }
    if (!block.text.trim()) continue
    flush()
    units.push({ kind: "text", block })
  }
  flush()
  return units
}
