import type { Block, ToolBlock, SubagentBlock } from "./reducer"

interface ToolActivityLabel {
  action: string
  detail: string
}

interface ToolActivitySummary {
  label: string
  kind: "commands" | "edits" | "images" | "reads" | "web" | "tools"
}

interface ToolDiffStats {
  additions: number
  deletions: number
}

const MAX_DIFF_CELLS = 250_000

export type ThinkingBlock = Extract<Block, { kind: "thinking" }>

type ActivityUnit =
  | { kind: "status"; block: Extract<Block, { kind: "compaction" | "retry" }> }
  | { kind: "tools"; blocks: ToolBlock[] }
  | { kind: "thinking"; block: ThinkingBlock }
  | { kind: "subagent"; block: SubagentBlock }
  | { kind: "text"; block: Extract<Block, { kind: "text" }> }

// One collapsible activity group per run of reasoning and tool
// calls. Text breaks the run and is always visible outside the group.
export type ActivityRun =
  | { kind: "status"; block: Extract<Block, { kind: "compaction" | "retry" }> }
  | { kind: "standalone"; block: ToolBlock }
  | { kind: "agents"; blocks: ToolBlock[] }
  | { kind: "subagents"; blocks: SubagentBlock[] }
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
    if (unit.kind === "text" || unit.kind === "status") {
      flush()
      runs.push(unit)
    } else if (unit.kind === "subagent") {
      flush()
      const previous = runs.at(-1)
      if (previous?.kind === "subagents" && previous.blocks[0]?.status === unit.block.status) previous.blocks.push(unit.block)
      else runs.push({ kind: "subagents", blocks: [unit.block] })
    } else if (unit.kind === "thinking") blocks.push(unit.block)
    else for (const block of unit.blocks) {
      if (block.name === "Agent" || block.name === "Task") {
        flush()
        const previous = runs.at(-1)
        if (previous?.kind === "agents") previous.blocks.push(block)
        else runs.push({ kind: "agents", blocks: [block] })
      } else if (isStandaloneActivity(block)) { flush(); runs.push({ kind: "standalone", block }) }
      else blocks.push(block)
    }
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

const PARTIAL_KEYS = ["file_path", "command", "pattern", "query", "url"]

// Arguments stream as JSON text; read the leading top-level string fields so the label can
// name its target before the complete call arrives.
function partialInput(json: string): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  let i = json.indexOf("{") + 1
  if (i === 0) return input
  const skip = () => { while (i < json.length && /[\s,]/.test(json[i]!)) i++ }
  const readString = (): { raw: string; closed: boolean } | undefined => {
    if (json[i] !== '"') return undefined
    let raw = ""
    for (let j = i + 1; j < json.length; j++) {
      const char = json[j]!
      if (char === "\\") { raw += json.slice(j, j + 2); j++; continue }
      if (char === '"') { i = j + 1; return { raw, closed: true } }
      raw += char
    }
    i = json.length
    return { raw, closed: false }
  }
  const decode = (raw: string) => {
    // A prefix can end on a lone backslash or a cut unicode escape.
    for (const candidate of [raw, raw.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "")]) {
      try { return JSON.parse(`"${candidate}"`) as string } catch {}
    }
    return undefined
  }
  for (;;) {
    skip()
    const key = readString()
    if (!key?.closed) break
    skip()
    if (json[i] !== ":") break
    i++
    skip()
    if (json[i] === '"') {
      const value = readString()
      if (!value) break
      if (PARTIAL_KEYS.includes(key.raw)) { const text = decode(value.raw); if (text !== undefined) input[key.raw] = text }
      if (!value.closed) break
    } else {
      // Skip a non-string value, including nested objects and arrays.
      let depth = 0
      while (i < json.length) {
        const char = json[i]!
        if (char === '"') { if (!readString()?.closed) return input; continue }
        if (char === "{" || char === "[") depth++
        else if (char === "}" || char === "]") { if (depth === 0) return input; depth-- }
        else if (char === "," && depth === 0) break
        i++
      }
      if (i >= json.length) break
    }
  }
  return input
}

export function toolActivityLabel(source: Pick<ToolBlock, "name" | "input" | "status" | "images"> & { partialJson?: string }): ToolActivityLabel {
  const block = source.status === "running" && source.partialJson && !Object.keys(source.input).length
    ? { ...source, input: partialInput(source.partialJson) }
    : source
  const running = block.status === "running"
  if (block.status === "unknown") return { action: "Connection lost during", detail: block.name === "Bash" ? oneLine(block.input.command) : block.name }
  const failed = block.status === "error"
  const stopped = block.status === "stopped"
  const command = oneLine(block.input.command)
  const target = basename(block.input.file_path)
  const pattern = oneLine(block.input.pattern)
  if (block.name.startsWith("mcp__")) {
    const [, server, ...toolParts] = block.name.split("__")
    const tool = toolParts.join("__") || server || block.name
    return {
      action: failed ? `Couldn’t call ${tool}` : stopped ? `Stopped calling ${tool}` : running ? `Calling ${tool}` : `Used ${tool}`,
      detail: server && server !== tool ? server : "",
    }
  }

  switch (block.name) {
    case "Bash":
      return {
        action: failed ? "Failed to run" : stopped ? "Stopped" : running ? "Running" : "Ran",
        detail: command || "command",
      }
    case "Read":
      if (/\.(?:avif|gif|jpe?g|png|webp)$/i.test(target))
        return {
          action: failed ? "Couldn’t view" : stopped ? "Stopped viewing" : running ? "Viewing" : "Viewed",
          detail: (block.images?.length ?? 0) > 1 ? `${block.images!.length} images` : "an image",
        }
      return {
        action: failed ? "Couldn’t read" : stopped ? "Stopped reading" : running ? "Reading" : "Read",
        detail: target || "file",
      }
    case "Write":
      return {
        action: failed ? "Couldn’t write" : stopped ? "Stopped writing" : running ? "Writing" : "Wrote",
        detail: target || "file",
      }
    case "Edit":
    case "MultiEdit":
      return {
        action: failed ? "Couldn’t edit" : stopped ? "Stopped editing" : running ? "Editing" : "Edited",
        detail: target || "file",
      }
    case "Grep":
      return {
        action: failed ? "Search failed for" : stopped ? "Stopped searching for" : running ? "Searching for" : "Searched for",
        detail: pattern || "files",
      }
    case "Glob":
      return {
        action: failed ? "Couldn’t find" : stopped ? "Stopped finding" : running ? "Finding" : "Found",
        detail: pattern || "files",
      }
    case "WebSearch":
      return { action: failed ? "Web search failed:" : stopped ? "Stopped searching:" : running ? "Searching the web:" : "Searched the web:", detail: oneLine(block.input.query) }
    case "WebFetch":
      return { action: failed ? "Couldn’t fetch" : stopped ? "Stopped fetching" : running ? "Fetching" : "Fetched", detail: oneLine(block.input.url) }
    case "ExitPlanMode":
      return { action: running ? "Writing plan" : "Plan", detail: "" }
    case "AskUserQuestion": {
      const count = Array.isArray(block.input.questions) ? block.input.questions.length : 0
      const noun = count === 1 ? "question" : "questions"
      return { action: failed || stopped ? "Question dismissed" : running ? "Asking" : "Asked", detail: count ? `${count} ${noun}` : "a question" }
    }
    case "Hook":
      return { action: failed ? "Hook failed:" : stopped ? "Hook stopped:" : running ? "Running hook:" : "Ran hook:", detail: oneLine(block.input.hook_name) }
    case "Agent":
    case "Task":
      return {
        action: failed ? "Subagent failed:" : stopped ? "Subagent stopped:" : running ? "Starting subagent:" : "Ran subagent:",
        detail: oneLine(block.input.description) || block.name,
      }
    default:
      return {
        action: failed ? `Failed using ${block.name}` : stopped ? `Stopped using ${block.name}` : running ? `Calling ${block.name}` : `Used ${block.name}`,
        detail: firstText(block.input),
      }
  }
}

/** One file action a shell command performs. */
export type ShellStep =
  | { kind: "read"; name: string }
  | { kind: "search"; query?: string; path?: string }
  | { kind: "list"; path?: string }

/**
 * The file actions of a shell command that only reads, searches or lists files, one per step, so the command can
 * show as those actions instead of a generic command. Every step of a `;`/`&&` chain must be recognised; anything
 * else (other programs, redirects, substitutions) leaves it a plain command.
 */
export function shellActivitySteps(command: string): ShellStep[] | undefined {
  const pipelines = shellSteps(command)
  if (!pipelines?.length) return undefined
  const steps: ShellStep[] = []
  for (const pipeline of pipelines) {
    const found = pipelineSteps(pipeline)
    if (found === undefined) return undefined
    if (found !== "skip") steps.push(...found)
  }
  return steps.length ? steps : undefined
}

/** A Bash call's file actions while it runs or once it succeeds; a failed or stopped one stays a command. */
export function toolShellSteps(block: Pick<ToolBlock, "name" | "input" | "status">): ShellStep[] | undefined {
  if (block.name !== "Bash" || (block.status !== "done" && block.status !== "running")) return undefined
  return typeof block.input.command === "string" ? shellActivitySteps(block.input.command) : undefined
}

/** The rows a tool call shows: one per file action once a file-action command finishes, otherwise the call itself. */
export function toolRowSteps(block: Pick<ToolBlock, "name" | "input" | "status">): (ShellStep | undefined)[] {
  return (block.status === "running" ? undefined : toolShellSteps(block)) ?? [undefined]
}

/** A finished or running step as a row label. */
export function shellStepLabel(step: ShellStep, finished: boolean): ToolActivityLabel {
  switch (step.kind) {
    case "read":
      return { action: finished ? "Read" : "Reading", detail: step.name }
    case "search": {
      const action = finished ? "Searched for" : "Searching for"
      if (step.query) return { action, detail: step.path ? `${step.query} in ${step.path}` : step.query }
      return { action, detail: "files" }
    }
    case "list":
      return step.path
        ? { action: finished ? "Listed files in" : "Listing files in", detail: step.path }
        : { action: finished ? "Listed files" : "Listing files", detail: "" }
  }
}

/** The running step as the activity group's live heading, which names the place rather than the query. */
export function shellStepActiveLabel(step: ShellStep): ToolActivityLabel {
  switch (step.kind) {
    case "read":
      return { action: "Reading", detail: step.name }
    case "search":
      if (step.path) return { action: "Searching", detail: `files in ${step.path} folder` }
      return step.query ? { action: "Searching", detail: `for ${step.query}` } : { action: "Searching", detail: "files" }
    case "list":
      return { action: "Listing", detail: step.path ? `files in ${step.path} folder` : "files" }
  }
}

// Splits into `;`/`&&`/`||`/newline steps of `|` stages of words; undefined for syntax this classifier won't guess at.
function shellSteps(command: string): string[][][] | undefined {
  const steps: string[][][] = []
  let stages: string[][] = []
  let words: string[] = []
  let word: string | undefined
  const endWord = () => { if (word !== undefined) words.push(word); word = undefined }
  const endStage = () => { endWord(); if (!words.length) return false; stages.push(words); words = []; return true }
  const endStep = () => { if (!endStage()) return false; steps.push(stages); stages = []; return true }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (char === "'") {
      const close = command.indexOf("'", i + 1)
      if (close === -1) return undefined
      word = (word ?? "") + command.slice(i + 1, close)
      i = close
    } else if (char === '"') {
      let text = ""
      for (i++; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === "$" || command[i] === "`") return undefined
        // Inside double quotes a backslash only escapes these; elsewhere it stays, as in "a\(b".
        if (command[i] === "\\" && i + 1 < command.length && '$`"\\\n'.includes(command[i + 1]!)) i++
        text += command[i]
      }
      if (i >= command.length) return undefined
      word = (word ?? "") + text
    } else if (char === "\\") {
      if (i + 1 >= command.length) return undefined
      // A backslash before a newline joins the lines.
      if (command[++i] !== "\n") word = (word ?? "") + command[i]
    } else if (char === "#" && word === undefined) {
      // A comment runs to the end of the line.
      const end = command.indexOf("\n", i)
      i = (end === -1 ? command.length : end) - 1
    } else if (char === " " || char === "\t") {
      endWord()
    } else if (char === ";" || char === "\n") {
      // Blank or comment-only lines, and a line after `&&`, separate nothing.
      if (char === "\n" && word === undefined && !words.length && !stages.length) continue
      if (!endStep()) return undefined
    } else if ((char === "&" || char === "|") && command[i + 1] === char) {
      if (!endStep()) return undefined
      i++
    } else if (char === "|") {
      if (!endStage()) return undefined
    } else if ("&<>()`$*?{}~".includes(char)) {
      return undefined
    } else {
      word = (word ?? "") + char
    }
  }
  if (word !== undefined || words.length) endStage()
  if (stages.length) steps.push(stages)
  return steps
}

// Later stages may only trim, count or filter the first stage's output; a filtering search is a step of its own.
function pipelineSteps([head, ...rest]: string[][]): ShellStep[] | "skip" | undefined {
  if (!head || !rest.every(stage => isOutputFilter(stage))) return undefined
  const first = stageSteps(head)
  if (first === undefined) return undefined
  const filters = rest.flatMap(([program, ...args]): ShellStep[] => program === "rg" || program === "grep" ? [{ kind: "search", query: searchArgs(args)!.query }] : [])
  if (first === "skip") return filters.length ? filters : "skip"
  return [...first, ...filters]
}

// One or more `N,Mp` ranges, as in `sed -n '1,20p;40,60p'`.
const SED_PRINT = /^\d+(,\d+)?p(;\d+(,\d+)?p)*;?$/

function isOutputFilter([program, ...args]: string[]): boolean {
  if (program === "head" || program === "tail") return args.length === 0 || (args.length === 1 && /^-n?\d+$/.test(args[0]!)) || (args.length === 2 && args[0] === "-n" && /^\d+$/.test(args[1]!))
  if (program === "sed") return args.length === 2 && args[0] === "-n" && SED_PRINT.test(args[1]!)
  if (program === "rg" || program === "grep") return searchArgs(args)?.paths.length === 0
  return program === "wc" || program === "sort" || program === "uniq" || program === "cut"
}

function stageSteps([program, ...args]: string[]): ShellStep[] | "skip" | undefined {
  const files = (list: string[]) => list.length > 0 && list.every(arg => !arg.startsWith("-"))
  const reads = (list: string[]) => files(list) ? list.map((path): ShellStep => ({ kind: "read", name: basename(path) })) : undefined
  switch (program) {
    case "cat":
      return reads(args)
    case "head":
      return args.length === 3 && args[0] === "-n" && /^\d+$/.test(args[1]!) ? reads(args.slice(2)) : undefined
    case "sed":
      return args.length === 3 && args[0] === "-n" && SED_PRINT.test(args[1]!) ? reads(args.slice(2)) : undefined
    case "nl":
      return reads(args.filter(arg => !/^-b[at]$/.test(arg)))
    // Counts and section markers between reads don't change what the chain does.
    case "wc":
    case "echo":
    case "printf":
      return "skip"
    case "ls": {
      const path = args.find(arg => !arg.startsWith("-"))
      return [{ kind: "list", path: displayFolder(path) }]
    }
    case "find": {
      // Only a plain walk of one folder, optionally bounded by depth and entry type.
      const [path, ...options] = args
      if (!path || path.startsWith("-")) return undefined
      for (let i = 0; i < options.length; i += 2) {
        const [option, value] = [options[i], options[i + 1]]
        if (!(option === "-maxdepth" && /^\d+$/.test(value ?? "")) && !(option === "-type" && (value === "f" || value === "d"))) return undefined
      }
      return [{ kind: "list", path: displayFolder(path) }]
    }
    case "rg":
    case "grep": {
      const parsed = searchArgs(args)
      if (!parsed) return undefined
      if (program === "rg" && args.includes("--files")) {
        const path = parsed.query ?? parsed.paths[0]
        return [{ kind: "list", path: displayFolder(path) }]
      }
      // grep with no file reads stdin, which only makes sense as a filter.
      if (!parsed.query || (program === "grep" && !parsed.paths.length && !parsed.recursive)) return undefined
      return [{ kind: "search", query: parsed.query, path: displayFolder(parsed.paths[0]) }]
    }
    default:
      return undefined
  }
}

// Options that take the next word as their value.
const SEARCH_VALUE_FLAGS = new Set(["-g", "--glob", "-t", "--type", "-T", "--type-not", "-A", "-B", "-C", "-m", "--max-count", "-M", "--max-columns", "--include", "--exclude", "-f", "--file"])

function searchArgs(args: string[]): { query?: string; paths: string[]; recursive: boolean } | undefined {
  let query: string | undefined
  const positional: string[] = []
  let recursive = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "--") { positional.push(...args.slice(i + 1)); break }
    if (arg === "-e" || arg === "--regexp") {
      if (i + 1 >= args.length) return undefined
      query ??= args[++i]
    } else if (SEARCH_VALUE_FLAGS.has(arg)) {
      if (i + 1 >= args.length) return undefined
      i++
    } else if (arg.startsWith("-")) {
      if (/^-[a-zA-Z]*[rR]/.test(arg) || arg === "--recursive") recursive = true
    } else positional.push(arg)
  }
  if (query === undefined) query = positional.shift()
  return { query, paths: positional, recursive }
}

// The last meaningful folder or file name; generic build and source folders name their parent instead, and the
// current folder has no name to show.
function displayFolder(path: string | undefined): string | undefined {
  const parts = (path ?? "").split("/").filter(part => part && part !== ".")
  if (!parts.length) return path?.startsWith("/") ? "/" : undefined
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!["src", "build", "dist", "node_modules"].includes(parts[i]!)) return parts[i]!
  }
  return parts.at(-1)
}

/** Elapsed time for the tool row, frozen once the result arrives. */
export function toolElapsedMs(
  block: Pick<ToolBlock, "startedAt" | "endedAt" | "status">,
  now = Date.now(),
): number | undefined {
  if (block.startedAt === undefined) return undefined
  const end = block.endedAt ?? (block.status === "running" ? now : undefined)
  if (end === undefined) return undefined
  const elapsed = end - block.startedAt
  return elapsed > 0 ? elapsed : undefined
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s"
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function toolActivitySummary(blocks: Pick<ToolBlock, "name" | "input" | "status">[]): ToolActivitySummary | undefined {
  let commands = 0
  let images = 0
  let reads = 0
  let tools = 0
  let searches = 0
  const editedFiles = new Set<string>()

  blocks.forEach((block, index) => {
    const file = oneLine(block.input.file_path)
    if ((block.name === "Read" && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(file)) || block.name === "ViewImage") {
      images++
    } else if (toolShellSteps(block)) {
      reads++
    } else if (block.name === "Bash") {
      commands++
    } else if (block.name === "Read" || block.name === "Grep" || block.name === "Glob" || block.name === "List") {
      reads++
    } else if (block.name === "Write" || block.name === "Edit" || block.name === "MultiEdit") {
      editedFiles.add(file || `${block.name}:${index}`)
    } else if (block.name === "WebSearch") {
      searches++
    } else {
      tools++
    }
  })
  const edits = editedFiles.size

  // Order: tool calls, file changes, exploration, commands, web search.
  const parts: string[] = []
  const stopped = blocks.some(block => block.name === "Bash" && block.status === "stopped")
  if (tools) parts.push(tools === 1 ? "Called a tool" : "Called tools")
  if (stopped) parts.push("Stopped command")
  if (edits) parts.push(edits === 1 ? "Edited a file" : "Edited files")
  if (reads) parts.push("Read files")
  if (!stopped && commands) parts.push(commands === 1 ? "Ran a command" : "Ran commands")
  if (images) parts.push(images === 1 ? "Viewed an image" : `Viewed ${images} images`)
  if (searches) parts.push("Searched the web")
  if (parts.length === 0) return undefined

  const kind =
    edits ? "edits"
      : images ? "images"
        : commands ? "commands"
          : reads ? "reads"
            : searches && !tools ? "web"
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

function isImageActivity(block: Pick<ToolBlock, "name" | "input" | "images">): boolean {
  return !!block.images?.length ||
    block.name === "ViewImage" ||
    (block.name === "Read" && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(oneLine(block.input.file_path)))
}

function isStandaloneActivity(block: Pick<ToolBlock, "name" | "input" | "images">): boolean {
  return block.name === "Agent" || block.name === "Task" || block.name === "Hook" || block.name === "ExitPlanMode" || block.name === "AskUserQuestion" || ["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"].includes(block.name) || isImageActivity(block)
}

export function groupActivityBlocks(blocks: Block[]): ActivityUnit[] {
  const units: ActivityUnit[] = []
  let tools: ToolBlock[] = []
  const flush = () => {
    if (tools.length) units.push({ kind: "tools", blocks: tools })
    tools = []
  }

  for (const block of blocks) {
    if (block.kind === "subagent") { flush(); units.push({ kind: "subagent", block }); continue }
    if (block.kind === "compaction" || block.kind === "retry") { flush(); units.push({ kind: "status", block }); continue }
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
      flush()
      units.push({ kind: "thinking", block })
      continue
    }
    if (!block.text.trim()) continue
    flush()
    units.push({ kind: "text", block })
  }
  flush()
  return units
}
