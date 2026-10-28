import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, statSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createElement } from "react"
import { renderToStaticMarkup as render } from "react-dom/server"
import { Markdown, OutputContext } from "../src/components/Markdown"
import { ElicitationCard } from "../src/components/ElicitationCard"
import { parseBlocks, parseStreaming } from "../src/components/markdownGrammar"
import { initialState, reducer, type AgentState } from "../src/agent/reducer"
import type { HistoryItem } from "../src/agent/protocol"
import { historyPage } from "../server/sessions"
import { mediaResponse } from "../server/workspace"
import { splitReferences } from "../src/lib/references"
import { parseContextOutput } from "../src/lib/contextOutput"
import { ContextCard } from "../src/components/ContextCard"

const agent = (state: AgentState, message: object) => reducer(state, { type: "agent", message } as any)
const directory = mkdtempSync(join(tmpdir(), "noa-conversation-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

test("math renders without interpreting currency or trusting TeX HTML", () => {
  const html = render(createElement(Markdown, { text: "Inline \\(x^2\\) and \\(y+1\\).\n\n$$\n\\frac{a}{b}\n$$" }))
  expect((html.match(/class="katex"/g) ?? []).length).toBe(3)
  expect(render(createElement(Markdown, { text: "It costs $5 and $10." }))).not.toContain('class="katex"')
  const untrusted = render(createElement(Markdown, { text: "$$\\href{javascript:alert(1)}{x}$$" }))
  expect(untrusted).not.toContain('href="javascript:')
})

test("Mermaid only starts after its fence closes", () => {
  expect(render(createElement(Markdown, { text: "```mermaid\ngraph LR\nA-->B", streaming: true }))).toContain('aria-label="Toggle code wrapping"')
  expect(render(createElement(Markdown, { text: "```mermaid\ngraph LR\nA-->B\n```" }))).toContain("Rendering diagram")
})

test("review comments and typed citations retain workspace line navigation", () => {
  const text = '::code-comment{title="Check the branch" body="Handle **empty** results" file="/project/a.ts" start=12 priority=2}\n\nSource :codex-file-citation{path="/project/a.ts" line_range_start=12 label="a.ts"}'
  const html = render(createElement(OutputContext, { value: { cwd: "/project", onOpenFile() {} } }, createElement(Markdown, { text })))
  expect(html).toContain('aria-label="Code review comment"')
  expect(html).toContain("<strong>empty</strong>")
  expect(html).toContain('title="/project/a.ts#L12"')
  expect(html).not.toContain("::code-comment{")
})

test("stream blocks update by protocol index and partial confirmations preserve siblings", () => {
  let state = agent(initialState, { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "m" } } })
  for (const [index, type] of [[0, "text"], [1, "thinking"]] as const) state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index, content_block: { type } } })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Answer" } } })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "Reason" } } })
  state = agent(state, { type: "assistant", parent_tool_use_id: null, message: { id: "m", content: [{ type: "text", text: "Answer" }] } })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } })
  expect(state.turns[0]).toMatchObject({ streaming: true, blocks: [{ text: "Answer" }, { text: "Reason" }] })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: " complete" } } })
  state = agent(state, { type: "assistant", parent_tool_use_id: null, message: { id: "m", content: [{ type: "thinking", thinking: "Reason complete" }] } })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_stop", index: 1 } })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "message_stop" } })
  expect(state.turns[0]).toMatchObject({ streaming: false, blocks: [{ text: "Answer", done: true }, { text: "Reason complete", done: true }] })
})

test("history pages keep complete turns and background results with their calls", () => {
  const items: HistoryItem[] = Array.from({ length: 100 }, (_, index) => [
    { kind: "user" as const, id: `u${index}`, text: `Request ${index}` },
    { kind: "agent" as const, message: { type: "assistant" as const, parent_tool_use_id: null, message: { content: [{ type: "text" as const, text: `Answer ${index}` }] } } },
  ]).flat()
  const latest = historyPage(items)
  expect(latest.before).toBe(120)
  expect(latest.items[0]).toMatchObject({ id: "u60" })
  expect(historyPage(items, latest.before).items.at(-1)).toEqual(items[119])
  items[5] = { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "background", name: "Bash", input: {} }] } } }
  items.push({ kind: "agent", message: { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "background", content: "done" }] } } })
  expect(historyPage(items).items[0]).toMatchObject({ id: "u2" })
})

test("history prepend preserves live state and marks unfinished disk tools uncertain", () => {
  const items: HistoryItem[] = [{ kind: "user", id: "old", text: "Old" }, { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "abandoned", name: "Bash", input: {} }] } } }]
  const state = reducer({ ...initialState, busy: true, turns: [{ role: "user", id: "live", text: "Live" }] }, { type: "history", items, prepend: true, before: 0 })
  expect(state.busy).toBe(true)
  expect(state.turns.map(turn => turn.id)).toContain("live")
  expect(state.turns[1]).toMatchObject({ incomplete: true, blocks: [{ status: "unknown" }] })
})

test("external authorization completion updates the matching request without approving it", () => {
  let state = agent(initialState, { type: "control_request", request_id: "r", request: { subtype: "elicitation", mcp_server_name: "server", mode: "url", url: "https://example.com", message: "Authorize", elicitation_id: "e" } })
  state = agent(state, { type: "system", subtype: "elicitation_complete", mcp_server_name: "server", elicitation_id: "e" })
  expect(state.elicitations[0]).toMatchObject({ requestId: "r", completed: true })
  expect(render(createElement(ElicitationCard, { request: state.elicitations[0]!, onAnswer() {} }))).toContain("Authorization complete")
})

test("media streaming supports byte ranges and keeps the workspace boundary", async () => {
  writeFileSync(join(directory, "clip.mp3"), "0123456789")
  const request = new Request("http://127.0.0.1/api/media", { headers: { range: "bytes=2-5" } })
  const response = await mediaResponse(directory, "clip.mp3", request)
  expect(response.status).toBe(206)
  expect(response.headers.get("content-range")).toBe("bytes 2-5/10")
  expect(await response.text()).toBe("2345")
  expect((await mediaResponse(directory, "clip.mp3", new Request(request.url, { headers: { range: "bytes=40-" } }))).status).toBe(416)
  expect(await (await mediaResponse(directory, "clip.mp3", new Request(request.url, { headers: { range: "bytes=-3" } }))).text()).toBe("789")
  await expect(mediaResponse(directory, "../outside.mp3", request)).rejects.toThrow("outside")
})

test("incremental Markdown remains equivalent across lists, tables, fences, math and references", () => {
  const examples = [
    "1. a\n\n2. b\n\n3. c",
    "First paragraph.\n\nSecond **paragraph**.\n\nThird paragraph.\n\nEnd.",
    "- first\n\n  continuation\n\n- next\n\nOutside.\n\nEnd.",
    "Header\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter.\n\nEnd.",
    "Before\n\n```ts\nlet a = 1\n\nlet b = 2\n```\n\nAfter\n\nEnd",
    "Before\n\n$$\na+b\n\nc+d\n$$\n\nAfter\n\nEnd",
    "[Earlier][ref]\n\nSecond\n\nThird\n\n[ref]: https://example.com\n",
  ]
  for (const text of examples) {
    const cache = { text: "", tokens: [] as ReturnType<typeof parseBlocks>[number][] }
    for (let length = 1; length <= text.length; length += 3) {
      const prefix = text.slice(0, length)
      expect(JSON.stringify(parseStreaming(prefix, cache))).toBe(JSON.stringify(parseBlocks(prefix)))
    }
  }
})

test("canonical tool confirmation before stop cannot remove parallel tool blocks", () => {
  let state = agent(initialState, { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "parallel" } } })
  for (let index = 0; index < 2; index++) state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index, content_block: { type: "tool_use", id: `t${index}`, name: "Read" } } })
  state = agent(state, { type: "assistant", parent_tool_use_id: null, message: { id: "parallel", content: [{ type: "tool_use", id: "t0", name: "Read", input: { file_path: "a.ts" } }] } })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } })
  state = agent(state, { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"file_path":"b.ts"}' } } })
  expect(state.turns[0]).toMatchObject({ streaming: true, blocks: [{ id: "t0", input: { file_path: "a.ts" } }, { id: "t1", partialJson: '{"file_path":"b.ts"}' }] })
})

test("journal reattachment preserves unconfirmed parallel blocks", async () => {
  const { emit } = await import("../server/agents")
  const run = { journal: [], clients: new Set() } as any
  const stream = (event: object) => ({ kind: "agent", message: { type: "stream_event", parent_tool_use_id: null, event } }) as any
  const events = [
    { kind: "user", id: "u", content: "Read both" },
    stream({ type: "message_start", message: { id: "m" } }),
    stream({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t0", name: "Read" } }),
    stream({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Read" } }),
    { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m", content: [{ type: "tool_use", id: "t0", name: "Read", input: { file_path: "a.ts" } }] } } },
    stream({ type: "content_block_stop", index: 0 }),
    stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"file_path":"b.ts"}' } }),
  ] as any[]
  for (const event of events) emit(run, event)
  const replay = (journal: any[]) => journal.reduce((state, entry) => reducer(state, entry.kind === "user" ? { type: "user-sent", id: entry.id, content: entry.content } : { type: "agent", message: entry.message }), initialState)
  expect(replay(run.journal).turns[1]).toMatchObject({ streaming: true, blocks: [{ id: "t0", input: { file_path: "a.ts" } }, { id: "t1", partialJson: '{"file_path":"b.ts"}' }] })
  emit(run, { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "b.ts" } }] } } })
  emit(run, stream({ type: "content_block_stop", index: 1 }))
  emit(run, stream({ type: "message_stop" }))
  expect(replay(run.journal).turns.flatMap((turn: any) => turn.blocks ?? []).map((block: any) => block.id)).toEqual(["t0", "t1"])
})

test("loading older history reconciles a live-completed hook with its earlier start", () => {
  const items: HistoryItem[] = []
  for (let i = 0; i < 41; i++) {
    items.push({ kind: "user", id: `u${i}`, text: `Turn ${i}` })
    if (!i) items.push({ kind: "agent", message: { type: "system", subtype: "hook_started", hook_id: "h", hook_name: "Check", hook_event: "PostToolUse" } })
    items.push({ kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `Reply ${i}` }] } } })
  }
  const page = historyPage(items)
  let state = reducer(initialState, { type: "history", ...page })
  state = agent(state, { type: "system", subtype: "hook_response", hook_id: "h", hook_name: "Check", hook_event: "PostToolUse", outcome: "success", output: "done" })
  state = reducer(state, { type: "history", ...historyPage(items, page.before), prepend: true })
  const hooks = state.turns.flatMap(turn => turn.role === "assistant" ? turn.blocks.filter(block => block.kind === "tool" && block.id === "hook:h") : [])
  expect(hooks).toHaveLength(1)
  expect(hooks[0]).toMatchObject({ status: "done", output: "done" })
})

test("Codex math delimiters preserve shell variables and support math fences", () => {
  const shell = render(createElement(Markdown, { text: "Use $HOME/$USER" }))
  expect(shell).toContain("$HOME/$USER")
  expect(shell).not.toContain('class="katex"')
  const inline = parseBlocks("Given $$x$$ and \\[y\\].")
  expect((inline[0] as any).tokens.filter((token: any) => token.type === "mathInline").map((token: any) => token.text)).toEqual(["x", "y"])
  expect(parseBlocks("$$$\nx^2\n$$$")[0]).toMatchObject({ type: "mathBlock", text: "x^2" })
  expect(render(createElement(Markdown, { text: "```math\nx^2\n```" }))).toContain('class="katex"')
})

test("typed citation aliases validate lines and preserve ranges", async () => {
  const { localReference } = await import("../src/components/Markdown")
  const text = ':codex-file-citation{path="src/a.ts" lineRangeStart="12" lineRangeEnd="14" title="Important"}'
  const html = render(createElement(OutputContext, { value: { cwd: "/project", onOpenFile() {} } }, createElement(Markdown, { text })))
  expect(html).toContain('title="src/a.ts#L12-L14"')
  expect(html).toContain("Important")
  expect(localReference("src/a.ts#L12-L14", "/project")).toEqual({ path: "src/a.ts", line: 12, endLine: 14 })
  const invalid = render(createElement(OutputContext, { value: { cwd: "/project", onOpenFile() {} } }, createElement(Markdown, { text: ':codex-file-citation{path="src/a.ts" line_range_start="abc"}' })))
  expect(invalid).toContain('title="src/a.ts"')
  expect(invalid).not.toContain("#Labc")
})

test("details disclosure renders structured safe Markdown", () => {
  const html = render(createElement(Markdown, { text: "<details open>\n<summary>More **context**</summary>\n\nBody **text**.\n\n<details><summary>Nested</summary>\n\nNested body.\n</details>\n\n<script>window.bad = true</script>\n</details>" }))
  expect(html).toContain("<details")
  expect(html).toContain("<summary")
  expect(html).toContain("<strong>context</strong>")
  expect(html).toContain("<strong>text</strong>")
  expect(html).toContain("Nested body.")
  expect(html).not.toContain("<script>")
})

test("file viewer highlights the complete referenced range", async () => {
  const { default: CodeView } = await import("../src/components/CodeView")
  const html = render(createElement(CodeView, { path: "a.ts", content: "one\ntwo\nthree\nfour\nfive", focusLine: 2, focusEndLine: 4 }))
  expect((html.match(/data-reference-line="true"/g) ?? []).length).toBe(3)
})

test("math block starts cannot split inline formulas or become setext headings", () => {
  const block = parseBlocks("before\n\\[\nx\n---\ny\n\\]")
  expect(block.map(token => token.type)).toEqual(["paragraph", "mathBlock"])
  expect(block[1]).toMatchObject({ text: "x\n---\ny" })
  const inline = parseBlocks("$$$x$$$$x$$$")
  expect((inline[0] as any).tokens).toMatchObject([{ type: "mathInline", text: "x$$$$x" }])
  const escaped = render(createElement(Markdown, { text: "\\$$x$$" }))
  expect(escaped).toContain("$$x$$")
  expect(escaped).not.toContain('class="katex"')
})

test("details preserve closing tags inside fenced and indented code", () => {
  const text = "<details><summary>Example</summary>\n```\nfirst\n```not-a-close\n</details>\nstill code\n```\n</details>"
  const blocks = parseBlocks(text)
  expect(blocks[0]).toMatchObject({ type: "detailsBlock" })
  expect((blocks[0] as any).text).toContain("still code")
  expect(blocks.filter(token => token.type !== "space")).toHaveLength(1)
  const indented = parseBlocks("<details><summary>Example</summary>\n\n    </details>\n\nBody\n</details>")
  expect((indented[0] as any).text).toContain("Body")
})

test("citation line and label coercion follows the installed Codex parser", () => {
  const html = render(createElement(OutputContext, { value: { cwd: "/project", onOpenFile() {} } }, createElement(Markdown, { text: ':codex-file-citation{path="src/a.ts" lineRangeStart=" 12px" label=" " title=" Important "}' })))
  expect(html).toContain('title="src/a.ts#L12"')
  expect(html).toContain(">Important</button>")
})

test("history pages preserve Agent lifecycle dependencies", () => {
  const items: HistoryItem[] = [{ kind: "user", id: "old", text: "Inspect" }, { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "outer", name: "Agent", input: {} }] } } }]
  for (let i = 0; i < 41; i++) items.push({ kind: "user", id: `u${i}`, text: `Turn ${i}` })
  items.push({ kind: "agent", message: { type: "system", subtype: "task_notification", task_id: "child", tool_use_id: "outer", status: "completed" } })
  expect(historyPage(items).items[0]).toMatchObject({ id: "old" })
})

test("history prepend fills earlier child output without replacing its terminal state", () => {
  const earlier: HistoryItem[] = [{ kind: "agent", message: { type: "system", subtype: "task_started", task_id: "child", tool_use_id: "outer", description: "Inspect" } }, { kind: "agent", message: { type: "assistant", parent_tool_use_id: "outer", message: { content: [{ type: "text", text: "Earlier child output" }] } } }]
  const current = { ...initialState, tasks: [{ id: "child", toolUseId: "outer", description: "Inspect", status: "completed" as const, turns: [] }] }
  const state = reducer(current, { type: "history", items: earlier, prepend: true })
  expect(state.tasks[0]).toMatchObject({ status: "completed", turns: [{ blocks: [{ text: "Earlier child output" }] }] })
})

test("terminal task notifications settle child streams without stopping sibling tasks", () => {
  const child = { role: "assistant", id: "child-turn", streaming: true, blocks: [{ kind: "thinking", text: "Inspecting", done: false }, { kind: "tool", id: "read", name: "Read", input: {}, partialJson: "", status: "running" }] }
  let state = { ...initialState, tasks: [{ id: "a", description: "First", status: "running", turns: [child] }, { id: "b", description: "Background", status: "running", turns: [child] }] } as AgentState
  state = agent(state, { type: "system", subtype: "task_notification", task_id: "a", status: "completed" })
  expect(state.tasks.find(t => t.id === "a")?.turns[0]).toMatchObject({ streaming: false, blocks: [{ done: true }, { status: "stopped" }] })
  expect(state.tasks.find(t => t.id === "b")).toMatchObject({ status: "running", turns: [{ streaming: true }] })
})

test("idle and result settle thinking even when the assistant message already closed", () => {
  const turn = { role: "assistant", id: "t", streaming: false, blocks: [{ kind: "thinking", text: "Reason", done: false }] }
  const state = { ...initialState, busy: true, turns: [turn] } as AgentState
  for (const message of [{ type: "system", subtype: "session_state_changed", state: "idle" }, { type: "result", subtype: "success", duration_ms: 100, result: "Done" }]) {
    const ended = agent(state, message)
    expect(ended.busy).toBe(false)
    expect(ended.turns[0]).toMatchObject({ streaming: false, blocks: [{ done: true }] })
  }
})


test("startup activity creates private directories and a private sidecar before any transcript", async () => {
  const { appendTimelineEvent, projectDir } = await import("../server/sessions")
  const config = join(directory, "private-config")
  mkdirSync(config, { mode: 0o755 })
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = config
  try {
    const id = "10000000-0000-4000-8000-000000000001"
    appendTimelineEvent(directory, id, { turn: 0, message: { type: "system", subtype: "hook_response", hook_id: "startup", hook_name: "Startup", hook_event: "SessionStart", outcome: "success", output: "Private hook output" } })
    const project = projectDir(directory)
    expect(statSync(join(config, "projects")).mode & 0o777).toBe(0o700)
    expect(statSync(project).mode & 0o777).toBe(0o700)
    expect(statSync(join(project, `${id}.gui-events.jsonl`)).mode & 0o777).toBe(0o600)
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
})

test("an unloaded turn diff update cannot replace the latest reply and survives older-page replay", async () => {
  const { emit } = await import("../server/agents")
  const items: any[] = []
  for (let i = 0; i < 80; i++) items.push(
    { kind: "user", id: `paged-u${i}`, text: `Turn ${i}` },
    { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `Reply ${i}` }] } } },
    { kind: "turn-diff", diff: { turnIndex: i, files: [{ path: `file${i}.ts`, additions: 1, deletions: 0 }], additions: 1, deletions: 0 } },
  )
  const latest = historyPage(items), earlier = historyPage(items, latest.before)
  let state = reducer(initialState, { type: "history", ...latest })
  const updated = { ...items[2].diff, reverted: true }
  const event = { kind: "turn-diff", diff: updated, updateOnly: true } as const
  const run = { history: items, journal: [{ kind: "history", ...earlier }], clients: new Set() } as any
  emit(run, event)
  state = reducer(state, { type: "turn-diff", diff: updated, updateOnly: true })
  expect(state.turns.filter(t => t.role === "assistant").at(-1)).toHaveProperty("diff.turnIndex", 79)
  state = reducer(state, { type: "history", ...earlier, prepend: true })
  const old = state.turns.filter(t => t.role === "assistant" && t.diff?.turnIndex === 0)
  expect(old).toHaveLength(1)
  expect(old[0]).toMatchObject({ blocks: [{ text: "Reply 0" }], diff: { reverted: true } })
  expect((run.journal[0].items as any[]).find(item => item.kind === "turn-diff" && item.diff.turnIndex === 0).diff.reverted).toBe(true)
})

test("rate limit events surface until the limit reports allowed again", () => {
  let state = agent(initialState, { type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour" } })
  expect(state.rateLimit?.status).toBe("rejected")
  state = agent(state, { type: "rate_limit_event", rate_limit_info: { status: "allowed" } })
  expect(state.rateLimit).toBeUndefined()
})

test("a steering message sent mid-stream does not duplicate the in-flight reply", () => {
  const stream = (event: object) => ({ type: "stream_event", parent_tool_use_id: null, event })
  let state = reducer(initialState, { type: "user-sent", id: "u1", text: "first" })
  state = agent(state, stream({ type: "message_start", message: { id: "m" } }))
  state = agent(state, stream({ type: "content_block_start", index: 0, content_block: { type: "text" } }))
  state = agent(state, stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }))
  state = reducer(state, { type: "user-sent", id: "u2", text: "steer" })
  state = agent(state, stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } }))
  state = agent(state, { type: "assistant", parent_tool_use_id: null, message: { id: "m", content: [{ type: "text", text: "Hello world" }] } })
  state = agent(state, stream({ type: "message_stop" }))
  expect(state.turns.map(turn => turn.role === "user" ? turn.text : turn.blocks.map(block => "text" in block ? block.text : "").join())).toEqual(["first", "Hello world", "steer"])
})

test("composer file references render as attachments, not message text", () => {
  expect(splitReferences('Fix it\n\nReferenced project files:\n- "src/a.ts"\n- "dir/b \\"c\\".ts"')).toEqual({ text: "Fix it", paths: ["src/a.ts", 'dir/b "c".ts'] })
  expect(splitReferences('\n\nReferenced project files:\n- "a.ts"')).toEqual({ text: "", paths: ["a.ts"] })
  const plain = "Mention Referenced project files: in prose"
  expect(splitReferences(plain)).toEqual({ text: plain, paths: [] })
})

test("/context output from the CLI renders as a card with its category colors", () => {
  const esc = "\x1b"
  const gray = `${esc}[38;2;153;153;153m`, blue = `${esc}[38;2;136;136;136m`
  const raw = [
    `${esc}[1mContext Usage${esc}[22m`,
    `${blue}⛁ ⛁ ${esc}[39m`,
    `${gray}deepseek-flash ${esc}[39m`,
    `${gray}445.5k/1m tokens (42%) ${esc}[39m`,
    `${gray}${esc}[3mEstimated usage by category${esc}[23m`,
    `${gray}⛶ ⛶ ${esc}[39m  ${blue}⛁ ${esc}[39m System prompt: ${gray}4.1k tokens (0.4%)${esc}[39m`,
    `${gray}⛶ ${esc}[39m ${gray}⛶ ${esc}[39m Free space: ${gray}680.7k (64.9%)${esc}[39m`,
    `${gray}⛝ Autocompact buffer: 33k tokens (3.1%)${esc}[39m`,
    `${esc}[1mAuto-compact window:${esc}[22m 1m tokens`,
    `${esc}[1mMCP tools${esc}[22m ${gray} · /mcp${esc}[39m`,
    `${gray} └ 19 tools · 6.7k tokens${esc}[39m`,
  ].join("\n")
  expect(parseContextOutput(raw)).toEqual({
    model: "deepseek-flash", usedLabel: "445.5k", maxLabel: "1m", percent: 42, suggestions: [],
    categories: [
      { name: "System prompt", tokens: "4.1k", percent: 0.4, color: "rgb(136,136,136)", kind: "used" },
      { name: "Free space", tokens: "680.7k", percent: 64.9, color: "rgb(153,153,153)", kind: "free" },
      { name: "Autocompact buffer", tokens: "33k", percent: 3.1, color: "rgb(153,153,153)", kind: "buffer" },
    ],
    sections: [{ name: "MCP tools", detail: "19 tools · 6.7k tokens" }],
  })
  expect(parseContextOutput("Just some text")).toBeUndefined()
  const html = render(createElement(ContextCard, { data: parseContextOutput(raw)! }))
  expect(html).toContain("Context window")
  expect(html).toContain("445.5k / 1m (42%)")
})

test("/context output with grid glyphs on the same line as its text still renders as a card", () => {
  const plain = [
    "Context Usage",
    "⛁ ⛁ ⛀ ⛁ ⛁ deepseek-flash",
    "⛁ ⛁ ⛁ ⛁ ⛁ 445.5k/1m tokens (42%)",
    "⛁ ⛁ ⛁ ⛁ ⛁",
    "⛁ ⛁ ⛶ ⛶ ⛶ Estimated usage by category",
    "⛶ ⛶ ⛶ ⛁ System prompt: 4.1k tokens (0.4%)",
    "⛶ ⛶ ⛶ ⛁ MCP server instructions: 537 tokens (0.1%)",
    "⛁ Messages: 306.7k tokens (29.2%)",
    "⛶ Free space: 680.7k (64.9%)",
    "⛝ Autocompact buffer: 33k tokens (3.1%)",
    "",
    "Auto-compact window: 1m tokens",
    "",
    "MCP tools · /mcp",
    " └ 19 tools · 6.7k tokens",
    "",
    "Skills · /skills",
    " └ 7 skills · 606 tokens",
    "",
    "/context all to expand",
    "",
    "Suggestions",
    "⚠ Bash results using 257.3k tokens (25%) → save ~128.6k",
    "Pipe output through head, tail, or grep to reduce result size.",
  ].join("\n")
  const parsed = parseContextOutput(plain)!
  expect(parsed.model).toBe("deepseek-flash")
  expect(parsed.percent).toBe(42)
  expect(parsed.categories.map(category => category.name)).toEqual(["System prompt", "MCP server instructions", "Messages", "Free space", "Autocompact buffer"])
  expect(parsed.sections).toEqual([{ name: "MCP tools", detail: "19 tools · 6.7k tokens" }, { name: "Skills", detail: "7 skills · 606 tokens" }])
  expect(parsed.suggestions).toEqual([{ title: "Bash results using 257.3k tokens (25%) → save ~128.6k", detail: "Pipe output through head, tail, or grep to reduce result size." }])
})
