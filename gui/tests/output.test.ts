import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup as render } from "react-dom/server"
import { initialState, reducer, type AgentState } from "../src/agent/reducer"
import { MessageList } from "../src/components/MessageList"
import { Markdown } from "../src/components/Markdown"
import { ToolCard } from "../src/components/ToolCard"
import { PermissionCard } from "../src/components/PermissionCard"
import { Collapsible } from "../src/components/Collapsible"
import { RightPanel } from "../src/components/RightPanel"

const agent = (s: AgentState, message: object) => reducer(s, { type: "agent", message } as any)
const start = () => reducer(initialState, { type: "user-sent", id: "u", text: "task" })
const bash = { kind: "tool" as const, id: "b", name: "Bash", input: { command: "sleep 10" }, partialJson: "", status: "running" as const }
const messages = (turns: any[], extra = {}) => render(createElement(MessageList, { turns, busy: false, readingWidth: 800, ...extra }))

test("user messages render formatted text while retaining the original for editing", () => {
  const text = "Inspect **this** and `that`"
  const html = messages([{ role: "user", id: "u", text }], { onEdit() {} })
  expect(html).toContain("<strong>this</strong>")
  expect(html).toContain("<code>that</code>")
  expect(html).toContain('aria-label="Edit message"')
})

test("user messages retain reference definitions and extra blank lines", () => {
  const html = messages([{ role: "user", id: "u", text: "[x]: foo\n\nhello\n\n\n\nworld" }])
  expect(html).toContain("[x]: foo")
  expect(html).toContain("\n\n</span>")
  expect(html).toContain("hello")
  expect(html).toContain("world")
  const nested = messages([{ role: "user", id: "nested", text: "> [x]: foo\n>\n> hello" }])
  expect(nested).toContain("[x]: foo")
})

test("activity distinguishes input from approval", () => {
  const oldStorage = globalThis.localStorage
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } })
  try {
    const state = { ...initialState, connection: "ready" as const, historyBefore: 10, elicitations: [{ requestId: "input" }] as any }
    const html = render(createElement(RightPanel, { state, cwd: "/project", tab: "activity", onTab: () => {}, onStopTask: () => {}, onReference: () => {}, workspaceRefreshKey: 0 }))
    expect(html).toContain("Waiting for input")
    expect(html).not.toContain("Load earlier")
    expect(html).not.toContain("Waiting for approval")
  } finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: oldStorage }) }
})

test("context request state retains the last measurement after an error or disconnect", () => {
  const usage = { totalTokens: 100, maxTokens: 1000, percentage: 10 } as any
  let state = reducer(initialState, { type: "control", payload: { kind: "context_usage", usage } })
  state = reducer(state, { type: "context-request" })
  expect(state.contextLoading).toBe(true)
  state = reducer(state, { type: "context-error", error: "Unavailable" })
  expect(state).toMatchObject({ contextLoading: false, contextError: "Unavailable", contextUsage: usage })
  state = reducer(state, { type: "context-request" })
  state = reducer(state, { type: "connection", status: "closed" })
  expect(state).toMatchObject({ contextLoading: false, contextUsage: usage })
})

test("restored interruption settles an unfinished command", () => {
  let s = agent(start(), { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "sleep 10" } }] } })
  s = reducer(s, { type: "turn-duration", durationMs: 1000, interrupted: true })
  expect(s.turns.at(-1)).toMatchObject({ interrupted: true, blocks: [{ status: "stopped" }] })
})

test("MCP structured-only results remain readable", () => {
  let s = agent(start(), { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "m", name: "mcp__local__query", input: {} }] } })
  const raw = { content: [], structuredContent: { rows: [1, 2] }, _meta: { cursor: "next" } }
  s = agent(s, { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "m", content: [] }] }, tool_use_result: raw })
  const tool = (s.turns[1] as any).blocks[0]
  expect(tool.rawResult).toEqual(raw)
  const html = render(createElement(ToolCard, { block: tool, defaultOpen: true }))
  expect(html).toContain("rows")
  expect(html).toContain("Raw result")
})

test("canonical Agent renders as a standalone subagent", async () => {
  const { groupActivityBlocks, groupActivityRuns, toolActivityLabel } = await import("../src/agent/toolActivity")
  const block = { ...bash, name: "Agent", input: { description: "Inspect files" } }
  expect(groupActivityRuns(groupActivityBlocks([block]))[0]?.kind).toBe("standalone")
  expect(toolActivityLabel(block)).toEqual({ action: "Starting subagent:", detail: "Inspect files" })
})

test("TodoWrite exposes the actual checklist", () => {
  const html = render(createElement(ToolCard, { block: { ...bash, name: "TodoWrite", input: { todos: [{ content: "Inspect files", status: "completed" }, { content: "Run checks", status: "in_progress" }] }, status: "done", output: "Todos have been modified successfully" }, defaultOpen: true }))
  expect(html).toContain("Inspect files")
  expect(html).toContain("Run checks")
  expect(html).toContain('aria-label="completed"')
  expect(html).toContain('aria-label="in progress"')
})

test("hook failures stay visible and pending hooks settle on exit", () => {
  let s = agent(start(), { type: "system", subtype: "hook_started", hook_id: "h", hook_name: "Check", hook_event: "PreToolUse" })
  expect(messages(s.turns, { busy: true })).toContain("Check")
  s = agent(s, { type: "system", subtype: "hook_response", hook_id: "h", hook_name: "Check", hook_event: "PreToolUse", stdout: "", stderr: "Hook failed", output: "Hook failed", exit_code: 1, outcome: "error" })
  expect(messages(s.turns)).toContain("Hook failed")
  expect((s.turns.at(-1) as any).blocks[0]).toMatchObject({ status: "error", exitCode: 1 })
  s = agent(s, { type: "system", subtype: "hook_started", hook_id: "pending", hook_name: "Stop check", hook_event: "Stop" })
  s = reducer(s, { type: "exit", code: 1 })
  expect((s.turns.at(-1) as any).blocks.at(-1).status).toBe("stopped")
})

test("process exit settles tools while a transport disconnect stays uncertain", () => {
  const s = agent(start(), { type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "sleep 10" } }] }, parent_tool_use_id: null })
  const disconnected = reducer(s, { type: "connection", status: "closed" })
  expect((disconnected.turns.at(-1) as any).blocks[0].status).toBe("unknown")
  const exited = reducer(s, { type: "exit", code: 1 } as any)
  expect((exited.turns.at(-1) as any).blocks[0].status).toBe("stopped")
  expect((exited.turns.at(-1) as any).error).toContain("exited")
  expect(s.turns.at(-1)).toMatchObject({ blocks: [{ status: "running" }] })
})

test("compaction and API retries enter the timeline and settle", () => {
  let s = agent(start(), { type: "system", subtype: "status", status: "compacting" })
  expect(messages(s.turns, { busy: true })).toContain("Compacting context")
  s = agent(s, { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 10000 } })
  expect(messages(s.turns)).toContain("Context compacted")
  s = agent(s, { type: "system", subtype: "api_retry", attempt: 2, max_retries: 5, retry_delay_ms: 10000, error_status: 429 })
  expect(messages(s.turns, { busy: true })).toContain("Retrying 2/5")
  s = agent(s, { type: "assistant", message: { content: [{ type: "text", text: "recovered" }] }, parent_tool_use_id: null })
  expect(messages(s.turns)).not.toContain("Retrying 2/5")
  const stopped = agent(agent(start(), { type: "system", subtype: "status", status: "compacting" }), { type: "result", is_error: true, errors: ["stopped"], duration_ms: 1 })
  expect(messages(stopped.turns)).toContain("Compaction interrupted")
})

test("errors and stops belong to each reply even without activity", () => {
  let s = agent(start(), { type: "result", is_error: true, errors: ["Provider unavailable"], duration_ms: 10 })
  s = reducer(s, { type: "user-sent", id: "next", text: "next" })
  s = agent(s, { type: "result", is_error: false, result: "success", duration_ms: 10 })
  expect(messages(s.turns)).toContain("Provider unavailable")
  for (const blocks of [[], [{ kind: "text", text: "partial", done: true }]]) {
    expect(messages([{ role: "assistant", id: "s", streaming: false, durationMs: 2000, interrupted: true, blocks }])).toContain("You stopped after")
  }
})

test("busy messages keep live changes and recovered failures fold with the completed turn", () => {
  const turn = { role: "assistant", id: "a", streaming: false, blocks: [bash] }
  const diff = { files: [{ path: "a.ts", additions: 1, deletions: 0 }], additions: 1, deletions: 0 }
  expect(messages([turn], { busy: true, liveDiff: diff })).toContain("noa-live-diff")
  const ended = messages([{ ...turn, blocks: [{ ...bash, status: "error" }, { kind: "text", text: "Done", done: true }] }])
  expect(ended).toContain("Done")
  expect(ended).toContain('aria-expanded="false"')
  expect(ended).not.toContain("1 failed")
})

test("Shell details preserve multiline commands and image failures retain diagnostics", () => {
  const command = "cat <<'EOF'\na  b\nEOF"
  const html = render(createElement(ToolCard, { block: { ...bash, input: { command }, status: "done", output: "result" }, defaultOpen: true }))
  expect(html).toContain("a  b\nEOF")
  const image = render(createElement(ToolCard, { block: { ...bash, name: "Read", input: { file_path: "missing.png" }, status: "error", output: "ENOENT diagnosis" }, defaultOpen: true }))
  expect(image).toContain("ENOENT diagnosis")
})

test("approval exposes proposed file content and complete structured arguments", () => {
  for (const input of [{ file_path: "config.ts", content: "PROPOSED_CONTENT" }, { nested: { operation: "PROPOSED_CONTENT" }, text: "x".repeat(200) + "END_OF_INPUT" }]) {
    const html = render(createElement(PermissionCard, { permission: { requestId: "p", toolName: "Write", input, suggestions: [] }, onAnswer() {} }))
    expect(html).toContain("PROPOSED_CONTENT")
    if ("text" in input) expect(html).toContain("END_OF_INPUT")
  }
})

test("Markdown preserves nested blocks, escaped table pipes and recursive inline styles", () => {
  const text = "1. step\n\n   paragraph\n\n   ```ts\n   const n = 1\n   ```\n\n2. next\n\n> - quoted\n\n| A | B |\n| --- | --- |\n| expr | `a \\| b` |\n\n**bold `code`**\n\n~~~~ts\nlet n = 2\n~~~~"
  const html = render(createElement(Markdown, { text }))
  expect(html).toMatch(/<li[\s>][\s\S]*?paragraph[\s\S]*?<pre[\s\S]*?<\/li>/)
  expect(html).toMatch(/<blockquote[\s\S]*?<ul>/)
  expect((html.match(/<td/g) ?? []).length).toBe(2)
  expect(html).toContain("a | b")
  expect(html).toContain("<strong>bold <code>code</code></strong>")
  expect((html.match(/Copy code/g) ?? []).length).toBeGreaterThanOrEqual(2)
  const unsafe = render(createElement(Markdown, { text: '[unsafe](javascript:alert(1))\n\n<script>alert(1)</script>' }))
  expect(unsafe).not.toContain('href="javascript:')
  expect(unsafe).not.toContain('<script>')
})
test("remote Markdown images require an explicit external open", () => {
  const html = render(createElement(Markdown, { text: "![tracker](https://tracker.example/pixel.png)" }))
  expect(html).toContain("Remote image blocked")
  expect(html).toContain('href="https://tracker.example/pixel.png"')
  expect(html).not.toContain("<img")
  expect(html).not.toContain("src=\"https://tracker.example")
})
test("renderer CSP blocks remote subresources", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
  expect(html).toContain("default-src 'self'")
  expect(html).toContain("img-src 'self' data: blob:")
  expect(html).toContain("object-src 'none'")
})

test("local output references retain line targets and reject external schemes", async () => {
  const { localReference, OutputContext } = await import("../src/components/Markdown")
  expect(localReference("/project/src/file.ts:12:3", "/project")).toEqual({ path: "src/file.ts", line: 12 })
  expect(localReference("./src/file.ts#L9", "/project")).toEqual({ path: "src/file.ts", line: 9 })
  for (const path of ["javascript:alert(1)", "https://example.com/file.ts", "../secret", "/other/private.png", "//example.com/file.ts"])
    expect(localReference(path, "/project")).toBeUndefined()
  expect(localReference("./src/a.ts:12", "/tmp/team#1")).toEqual({ path: "src/a.ts", line: 12 })
  expect(localReference("foo#bar.png", "/project")).toEqual({ path: "foo#bar.png" })
  expect(localReference("foo?bar.png", "/project")).toEqual({ path: "foo?bar.png" })
  const html = render(createElement(OutputContext, { value: { cwd: "/project", onOpenFile() {} } }, createElement(Markdown, { text: "[source](/project/src/file.ts:12)" })))
  expect(html).toContain('<button type="button"')
  expect(html).toContain('title="/project/src/file.ts:12"')
})

test("pathological single-line output stays plain and link definitions stay hidden", () => {
  const text = "[".repeat(50_000)
  const start = performance.now()
  const html = render(createElement(Markdown, { text }))
  expect(performance.now() - start).toBeLessThan(1000)
  expect(html).toContain(text)
  const defined = render(createElement(Markdown, { text: "Term [1]\n\n[1]: https://example.com" }))
  expect(defined).toContain('href="https://example.com"')
  expect(defined).not.toContain("[1]: https://example.com")
})

test("closed details do not render their expensive content", () => {
  const html = render(createElement(Collapsible, { open: false }, createElement("div", { children: "HIDDEN_EXPENSIVE_OUTPUT" })))
  expect(html).not.toContain("HIDDEN_EXPENSIVE_OUTPUT")
  expect(render(createElement(Collapsible, { open: true }, createElement("div", { children: "VISIBLE_OUTPUT" })))).toContain("VISIBLE_OUTPUT")
})

test("disconnected approvals cannot be submitted", () => {
  const state = reducer({
    ...initialState,
    connection: "ready",
    permissions: [{ requestId: "p", toolUseId: "t", toolName: "Bash", input: {}, suggestions: [] }],
  }, { type: "connection", status: "closed" })
  expect(state.permissions).toEqual([])
})

test("stopped activities keep their terminal state in summaries", () => {
  const html = messages([{ role: "assistant", id: "a", streaming: false, interrupted: true, blocks: [
    { ...bash, status: "stopped" },
    { kind: "tool", id: "t2", name: "Read", input: { file_path: "a.ts" }, partialJson: "", status: "done" },
    { kind: "text", text: "Stopped", done: true },
  ] }])
  expect(html).toContain("Stopped command")
  expect(html).not.toContain("ran a command")
})

test("turn diffs skip status-only assistant notices", () => {
  let state = reducer(initialState, { type: "user-sent", id: "u", text: "task" })
  state = agent(state, { type: "assistant", message: { content: [{ type: "text", text: "Done" }] }, parent_tool_use_id: null })
  state = agent(state, { type: "system", subtype: "status", status: "compacting" })
  state = agent(state, { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto" } })
  state = reducer(state, { type: "turn-diff", diff: { files: [], additions: 0, deletions: 0, turnIndex: 1 } })
  const assistants = state.turns.filter((turn) => turn.role === "assistant")
  expect(assistants[0]).toHaveProperty("diff.turnIndex", 1)
  expect(assistants[1]).not.toHaveProperty("diff")
})

test("unfinished replies do not reserve a final response action row", () => {
  const turn = { role: "assistant", id: "a", streaming: false, blocks: [{ kind: "text", text: "partial", done: true }] }
  expect(messages([{ ...turn, interrupted: true, durationMs: 2000 }])).not.toContain('aria-label="Copy response"')
  expect(messages([{ ...turn, error: "Provider unavailable" }])).not.toContain('aria-label="Copy response"')
  const live = agent(start(), { type: "assistant", message: { content: [{ type: "text", text: "partial" }] }, parent_tool_use_id: null })
  const disconnected = reducer(live, { type: "connection", status: "closed" })
  expect(messages(disconnected.turns)).not.toContain('aria-label="Copy response"')
  expect(messages([turn])).toContain('aria-label="Copy response"')
})

test("streaming code can only be copied after its fence closes", () => {
  const open = render(createElement(Markdown, { text: "```ts\nconst n = 1", streaming: true }))
  const closed = render(createElement(Markdown, { text: "```ts\nconst n = 1\n```", streaming: true }))
  expect(open).toContain("const")
  expect(open).not.toContain('aria-label="Copy code"')
  expect(closed).toContain('aria-label="Copy code"')
})

test("hook events cannot steal the active text stream", () => {
  let s = agent(start(), { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } })
  s = agent(s, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Before " } } })
  s = agent(s, { type: "system", subtype: "hook_started", hook_id: "h", hook_name: "Check", hook_event: "PreToolUse" })
  s = agent(s, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "after" } } })
  expect((s.turns.at(-1) as any).blocks[0].text).toBe("Before after")
  expect((s.turns.at(-1) as any).blocks[1].name).toBe("Hook")
})

test("authoritative text preserves an intervening hook and its order", () => {
  let s = agent(start(), { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } })
  s = agent(s, { type: "system", subtype: "hook_started", hook_id: "h", hook_name: "Check", hook_event: "PreToolUse" })
  s = agent(s, { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Complete" }] } })
  expect((s.turns.at(-1) as any).blocks).toMatchObject([{ kind: "text", text: "Complete" }, { kind: "tool", name: "Hook" }])
})

test("partial TaskUpdate does not invent a pending state", () => {
  const block = { ...bash, name: "TaskUpdate", status: "done" as const, input: { taskId: "7", subject: "Updated title" }, rawResult: { success: true, taskId: "7", updatedFields: ["subject"] } }
  const html = render(createElement(ToolCard, { block, defaultOpen: true }))
  expect(html).toContain("Updated title")
  expect(html).not.toContain('aria-label="pending"')
  const completed = render(createElement(ToolCard, { block: { ...block, input: { ...block.input, status: "completed" } }, defaultOpen: true }))
  expect(completed).toContain('aria-label="completed"')
})

test("edit approval defaults to the Codex file summary instead of expanded replacement text", () => {
  const html = render(createElement(PermissionCard, { permission: { requestId: "edit-summary", toolName: "Edit", input: { file_path: "src/render.ts", old_string: "OLD_ONLY_TOKEN", new_string: "NEW_ONLY_TOKEN\nreturn value" }, suggestions: [] }, onAnswer() {} }))
  expect(html).toContain('aria-label="Preview proposed changes to src/render.ts"')
  expect(html).toContain("+2")
  expect(html).toContain("-1")
  expect(html).not.toContain("OLD_ONLY_TOKEN")
  expect(html).not.toContain("NEW_ONLY_TOKEN")
})

test("edit diffs keep unchanged lines as context and shell output has no running placeholder", () => {
  const edit = { ...bash, id: "e", name: "Edit", status: "done" as const, input: { file_path: "a.ts", old_string: "one\ntwo\nthree", new_string: "one\nTWO\nthree" } }
  const html = render(createElement(ToolCard, { block: edit, defaultOpen: true }))
  expect(html.match(/>one</g)?.length ?? 0).toBe(0)
  expect((html.match(/ one</g) ?? []).length).toBe(1)
  expect(html).toContain("-two")
  expect(html).toContain("+TWO")
  expect(render(createElement(ToolCard, { block: bash, defaultOpen: true }))).not.toContain("Waiting for output")
  expect(render(createElement(ToolCard, { block: { ...bash, status: "error" as const }, defaultOpen: true }))).toContain("Exit code unknown")
})
