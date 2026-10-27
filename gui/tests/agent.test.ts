import { afterAll, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, mkdirSync, statSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { sanitizePath } from "../../src/utils/sessionStoragePortable"
import { findTurnUserMessage, loadHistory, listSessions, renameSession, transcriptPath } from "../server/sessions"
import { initialState, reducer } from "../src/agent/reducer"
import { parseAuthorizationCode } from "../src/agent/useAgent"
import { MessageList } from "../src/components/MessageList"
import { Markdown } from "../src/components/Markdown"
import { ToolCard } from "../src/components/ToolCard"

const config = mkdtempSync(join(tmpdir(), "noa-gui-agent-test-"))
const originalConfig = process.env.CLAUDE_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = config
afterAll(() => {
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfig
  rmSync(config, { recursive: true, force: true })
})
function transcript(cwd: string, entries: object[]) {
  const id = crypto.randomUUID()
  const dir = join(config, "projects", sanitizePath(cwd))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.jsonl`), entries.map((entry) => JSON.stringify({ cwd, ...entry })).join("\n") + "\n")
  return id
}
test("history preserves identical blocks at distinct transcript positions", async () => {
  const cwd = "/private/tmp/repeated-content-blocks"
  const id = transcript(cwd, [
    { type: "user", uuid: "u", parentUuid: null, message: { content: "Repeat" } },
    { type: "assistant", uuid: "a", parentUuid: "u", message: { id: "m", content: [{ type: "text", text: "same" }] } },
    { type: "assistant", uuid: "b", parentUuid: "a", message: { id: "m", content: [{ type: "text", text: "same" }] } },
  ])
  expect((await loadHistory(cwd, id))?.[1]).toMatchObject({ kind: "agent", message: { message: { content: [{ type: "text", text: "same" }, { type: "text", text: "same" }] } } })
})

test("long project paths use the CLI transcript directory", async () => {
  const cwd = `/private/tmp/${"a".repeat(99)}/${"b".repeat(99)}/project`
  const id = transcript(cwd, [{ type: "user", message: { content: "long path task" } }])
  expect(listSessions(cwd).map((s) => s.id)).toContain(id)
  expect((await loadHistory(cwd, id))?.[0]).toMatchObject({ kind: "user", text: "long path task" })
})
test("task history is not truncated at 50 and cached titles refresh", () => {
  const cwd = `/private/tmp/noa-many-sessions-${crypto.randomUUID()}`
  const ids = Array.from({ length: 55 }, (_, index) => transcript(cwd, [{ type: "user", message: { content: `task ${index}` } }]))
  expect(listSessions(cwd)).toHaveLength(55)

  renameSession(cwd, ids[0]!, "Cached title updated")
  const renamed = listSessions(cwd).find((session) => session.id === ids[0])
  expect(renamed?.title).toBe("Cached title updated")
})
test("history follows the latest conversation leaf instead of replaying abandoned branches", async () => {
  const cwd = "/private/tmp/branched-project"
  const id = transcript(cwd, [
    {
      type: "user",
      uuid: "root",
      parentUuid: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: { content: "question" },
    },
    {
      type: "assistant",
      uuid: "old",
      parentUuid: "root",
      timestamp: "2026-01-01T00:00:01Z",
      message: { id: "old", content: [{ type: "text", text: "obsolete" }] },
    },
    {
      type: "assistant",
      uuid: "current",
      parentUuid: "root",
      timestamp: "2026-01-01T00:00:02Z",
      message: { id: "current", content: [{ type: "text", text: "current answer" }] },
    },
  ])
  const history = await loadHistory(cwd, id)
  expect(history?.length).toBe(2)
  expect(JSON.stringify(history)).toContain("current answer")
  expect(JSON.stringify(history)).not.toContain("obsolete")
})
test("turn offsets resolve the current user message in non-ASCII transcripts", () => {
  const cwd = `/private/tmp/noa-unicode-offset-${crypto.randomUUID()}`
  const id = crypto.randomUUID()
  const file = transcriptPath(cwd, id)
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify({
    type: "user",
    uuid: "11111111-1111-4111-8111-111111111111",
    cwd,
    message: { content: "你好，这是第一轮🙂" },
  }) + "\n")
  const offset = statSync(file).size
  const current = "22222222-2222-4222-8222-222222222222"
  appendFileSync(file, JSON.stringify({
    type: "user",
    uuid: current,
    cwd,
    message: { content: "第二轮" },
  }) + "\n")
  expect(findTurnUserMessage(cwd, id, offset)).toBe(current)
})
test("error results retain actionable details", () => {
  const state = reducer(initialState, {
    type: "agent",
    message: {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      duration_ms: 1,
      errors: ["Provider unavailable"],
    } as any,
  })
  expect(state.error).toBe("Provider unavailable")
})
test("MCP input requests are visible until answered or cancelled", () => {
  const state = reducer(initialState, {
    type: "agent",
    message: {
      type: "control_request",
      request_id: "mcp-form",
      request: {
        subtype: "elicitation",
        mcp_server_name: "fixture",
        message: "Choose a workspace",
        requested_schema: { type: "object" },
      },
    },
  })
  expect((state as any).elicitations).toHaveLength(1)
})

test("task events and child messages share one identity", () => {
  let state = reducer(initialState, {
    type: "agent",
    message: {
      type: "system",
      subtype: "task_started",
      task_id: "agent-1",
      tool_use_id: "toolu-1",
      description: "Inspect code",
    },
  })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "assistant",
      parent_tool_use_id: "toolu-1",
      message: { content: [{ type: "text", text: "Inspection result" }] },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: { type: "system", subtype: "task_notification", task_id: "agent-1", status: "completed", summary: "Done" },
  })
  expect(state.tasks).toHaveLength(1)
  expect(state.tasks[0]).toMatchObject({ id: "agent-1", toolUseId: "toolu-1", status: "completed" })
  expect(state.tasks[0]?.turns).toHaveLength(1)
})
test("CLI compact recovery preserves the retained segment", async () => {
  const cwd = "/private/tmp/compact-project"
  const id = transcript(cwd, [
    {
      type: "user",
      uuid: "old",
      parentUuid: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: { content: "old root" },
    },
    {
      type: "user",
      uuid: "keep",
      parentUuid: "old",
      timestamp: "2026-01-01T00:00:01Z",
      message: { content: "retained instruction" },
    },
    {
      type: "assistant",
      uuid: "tail",
      parentUuid: "keep",
      timestamp: "2026-01-01T00:00:02Z",
      message: { content: [{ type: "text", text: "retained answer" }] },
    },
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: "boundary",
      parentUuid: null,
      timestamp: "2026-01-01T00:00:03Z",
      compactMetadata: { preservedSegment: { headUuid: "keep", tailUuid: "tail", anchorUuid: "summary" } },
    },
    {
      type: "user",
      uuid: "summary",
      parentUuid: "boundary",
      timestamp: "2026-01-01T00:00:04Z",
      isCompactSummary: true,
      message: { content: "summary" },
    },
    {
      type: "user",
      uuid: "after",
      parentUuid: "summary",
      timestamp: "2026-01-01T00:00:05Z",
      message: { content: "continue" },
    },
  ])
  const history = await loadHistory(cwd, id)
  expect(JSON.stringify(history)).toContain("retained instruction")
  expect(JSON.stringify(history)).toContain("retained answer")
  expect(JSON.stringify(history)).toContain("continue")
  expect(JSON.stringify(history)).not.toContain("old root")
})

test("local slash-command output is displayed from the result envelope", () => {
  let state = reducer(initialState, { type: "user-sent", id: "command", text: "/context" })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1,
      result: "## Context Usage\n1.8k / 1m tokens",
    } as any,
  })
  expect(JSON.stringify(state.turns)).toContain("Context Usage")
})
test("result text does not duplicate an already rendered model answer", () => {
  let state = reducer(initialState, { type: "user-sent", id: "prompt", text: "/test-skill" })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "text", text: "Skill result" }] },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: { type: "result", subtype: "success", is_error: false, duration_ms: 1, result: "Skill result" } as any,
  })
  expect(state.turns.filter((turn) => turn.role === "assistant")).toHaveLength(1)
})
test("steering closes the in-flight assistant before starting the steered reply", () => {
  let state = reducer(initialState, { type: "user-sent", id: "first", text: "Start" })
  state = reducer(state, {
    type: "agent",
    message: { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } },
  })
  state = reducer(state, {
    type: "agent",
    message: { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Partial" } } },
  })
  state = reducer(state, { type: "user-sent", id: "steer", text: "Steer now" })
  state = reducer(state, {
    type: "agent",
    message: { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } },
  })
  state = reducer(state, {
    type: "agent",
    message: { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Steered reply" } } },
  })
  state = reducer(state, {
    type: "agent",
    message: { type: "result", subtype: "success", is_error: false, result: "Steered reply", duration_ms: 10 },
  })
  expect(state.turns.filter((turn) => turn.role === "assistant").map((turn) => "streaming" in turn && turn.streaming)).toEqual([false, false])
})

test("tool result images are preserved without stringifying base64 into output", () => {
  let state = reducer(initialState, { type: "user-sent", id: "image-task", text: "Inspect screenshots" })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/before.png" } },
        ],
      },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } },
              { type: "text", text: "The screenshot is valid." },
            ],
          },
        ],
      },
    },
  })
  const tool = state.turns
    .flatMap((turn) => turn.role === "assistant" ? turn.blocks : [])
    .find((block) => block.kind === "tool")
  expect(tool).toMatchObject({
    output: "The screenshot is valid.",
    images: [{ type: "image", source: { media_type: "image/png", data: "YWJj" } }],
  })
})

test("tool result metadata preserves command exit status", () => {
  let state = reducer(initialState, { type: "user-sent", id: "command-task", text: "Run tests" })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "bun test" } }] },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "tool-1",
          content: "1 failed",
          is_error: true,
          tool_use_result: { stdout: "1 failed", stderr: "", exitCode: 1, interrupted: false },
        }],
      },
    },
  })
  const tool = state.turns.flatMap((turn) => turn.role === "assistant" ? turn.blocks : []).find((block) => block.kind === "tool")
  expect(tool).toMatchObject({ output: "1 failed", exitCode: 1, status: "error" })
})

test("live tool result metadata is read from the message envelope", () => {
  let state = reducer(initialState, { type: "user-sent", id: "command-task", text: "Run tests" })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "bun test" } }] },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "1 failed", is_error: true }] },
      tool_use_result: { stdout: "1 failed", stderr: "", exitCode: 1, interrupted: false },
    },
  })
  const tool = state.turns.flatMap((turn) => turn.role === "assistant" ? turn.blocks : []).find((block) => block.kind === "tool")
  expect(tool).toMatchObject({ output: "1 failed", exitCode: 1, status: "error" })
})

test("interrupted tool results become stopped instead of failed", () => {
  let state = reducer(initialState, { type: "user-sent", id: "command-task", text: "Run tests" })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "bun test" } }] },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "tool-1",
          content: "Interrupted",
          is_error: true,
          tool_use_result: { stdout: "", stderr: "", exitCode: 130, interrupted: true },
        }],
      },
    },
  })
  const tool = state.turns.flatMap((turn) => turn.role === "assistant" ? turn.blocks : []).find((block) => block.kind === "tool")
  expect(tool).toMatchObject({ status: "stopped", interrupted: true })
  if (tool?.kind === "tool") expect(typeof tool.endedAt).toBe("number")
})

test("history hides internal transcript envelopes and interruption markers", async () => {
  const cwd = "/private/tmp/hidden-envelope-project"
  const id = transcript(cwd, [
    { type: "user", message: { content: "<system-reminder>internal policy</system-reminder>" } },
    {
      type: "user",
      message: {
        content: "<task-notification>\n<task-id>task-1</task-id>\n<summary>background finished</summary>\n</task-notification>",
      },
    },
    { type: "user", message: { content: "[Request interrupted by user for tool use]" } },
    { type: "user", message: { content: "Visible request" } },
  ])
  const history = await loadHistory(cwd, id)
  expect(history).toEqual([{ kind: "user", id: `${id}:user:3`, text: "Visible request" }])
  expect(listSessions(cwd)[0]?.title).toBe("Visible request")
})

test("history restores turn duration and interruption state", async () => {
  const cwd = "/private/tmp/turn-duration-project"
  const id = transcript(cwd, [
    { type: "user", message: { content: "Run the checks" } },
    { type: "assistant", message: { id: "answer", content: [{ type: "text", text: "Checks finished" }] } },
    { type: "user", message: { content: "[Request interrupted by user]" } },
    { type: "system", subtype: "turn_duration", durationMs: 4321 },
  ])
  expect(await loadHistory(cwd, id)).toEqual([
    { kind: "user", id: `${id}:user:0`, text: "Run the checks", images: undefined },
    {
      kind: "agent",
      messageId: "answer",
      message: {
        type: "assistant",
        message: { content: [{ type: "text", text: "Checks finished" }] },
        parent_tool_use_id: null,
      },
    },
    { kind: "turn-duration", durationMs: 4321, interrupted: true },
  ])
})

test("live results stamp duration and completion onto the final assistant message", () => {
  let state = reducer(initialState, { type: "user-sent", id: "turn", text: "Run the checks" })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_start", content_block: { type: "text" } },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Done" } },
    },
  })
  state = reducer(state, {
    type: "agent",
    message: {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 4321,
      parent_tool_use_id: null,
    },
  })
  const assistant = state.turns.find((turn) => turn.role === "assistant")
  expect(assistant).toMatchObject({
    durationMs: 4321,
    blocks: [{ kind: "text", text: "Done", done: true }],
  })
})

test("a turn duration without an assistant does not overwrite the previous turn", () => {
  let state = reducer(initialState, { type: "user-sent", id: "first", text: "First" })
  state = reducer(state, {
    type: "agent",
    message: { type: "result", subtype: "success", is_error: false, duration_ms: 1000, parent_tool_use_id: null },
  })
  state = reducer(state, { type: "user-sent", id: "second", text: "Second" })
  state = reducer(state, { type: "turn-duration", durationMs: 2000, interrupted: true })
  expect(state.turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user", "assistant"])
  expect(state.turns[1]).toMatchObject({ durationMs: 1000, interrupted: false })
  expect(state.turns[3]).toMatchObject({ durationMs: 2000, interrupted: true, blocks: [] })
})

test("assistant actions wait for completed text and completed turns show worked time", () => {
  const render = (turns: Parameters<typeof MessageList>[0]["turns"], busy: boolean) =>
    renderToStaticMarkup(createElement(MessageList, {
      turns,
      busy,
      readingWidth: 800,
      onChanges: () => {},
    }))
  const streaming = render([
    { role: "user", id: "user", text: "Work" },
    {
      role: "assistant",
      id: "assistant",
      streaming: true,
      blocks: [{ kind: "text", text: "Partial", done: false }],
    },
  ], true)
  expect(streaming).not.toContain('aria-label="Copy response"')
  expect(streaming).toContain('aria-label="Copy message"')

  const commentary = render([
    { role: "user", id: "user", text: "Work" },
    { role: "assistant", id: "assistant", streaming: false, blocks: [
      { kind: "text", text: "First check the workspace.", done: true },
      { kind: "tool", id: "tool", name: "Bash", input: { command: "git status" }, status: "running" },
    ] },
  ], true)
  expect(commentary).toContain("First check the workspace.")
  expect(commentary).not.toContain('aria-label="Copy response"')

  const completed = render([
    { role: "user", id: "user", text: "Work" },
    {
      role: "assistant",
      id: "assistant",
      streaming: false,
      durationMs: 4321,
      blocks: [{ kind: "text", text: "Complete", done: true }],
    },
  ], false)
  // A plain answer has no activity to fold, so it shows no worked-for divider.
  expect(completed).not.toContain("Worked for 4s")
  expect(completed).toContain('aria-label="Copy response"')
  expect(completed).not.toContain("Copy task output")

  const withActivity = render([
    { role: "user", id: "user", text: "Work" },
    {
      role: "assistant",
      id: "assistant",
      streaming: false,
      durationMs: 4321,
      blocks: [
        { kind: "tool", id: "tool", name: "Bash", input: { command: "bun test" }, partialJson: "", status: "done" },
        { kind: "text", text: "Complete", done: true },
      ],
    },
  ], false)
  expect(withActivity).toContain("Worked for 4s")
})

test("tool cards show elapsed time and shell controls", () => {
  const block = {
    kind: "tool" as const,
    id: "tool",
    name: "Bash",
    input: { command: "bun test" },
    partialJson: "",
    status: "done" as const,
    startedAt: 1_000,
    endedAt: 5_000,
    exitCode: 0,
  }
  const html = renderToStaticMarkup(createElement(ToolCard, { block, defaultOpen: true }))
  expect(html).toContain("in 4s")
  expect(html).toContain("Copy shell contents")
  expect(html).toContain("Collapse shell")
  expect(html).toContain("line-clamp-2")
  expect(html).toContain("Success")

  const stopped = renderToStaticMarkup(createElement(ToolCard, {
    block: { ...block, status: "stopped", interrupted: true },
    defaultOpen: true,
  }))
  expect(stopped).toContain("Stopped")
})

test("markdown renders nested lists, ordered starts, tasks, table alignment and images", () => {
  const html = renderToStaticMarkup(createElement(Markdown, {
    text: [
      "3. third",
      "4. fourth",
      "   - nested",
      "- [x] done",
      "- [ ] todo",
      "",
      "| left | right |",
      "| :--- | ---: |",
      "| a | b |",
      "",
      "~~gone~~ and ![shot](https://example.com/shot.png)",
    ].join("\n"),
  }))
  expect(html).toContain('<ol start="3">')
  expect(html).toContain("<ul>")
  expect(html).toContain('type="checkbox"')
  expect(html).toContain('checked=""')
  expect(html).toContain("text-align:left")
  expect(html).toContain("text-align:right")
  expect(html).toContain("<del>gone</del>")
  expect(html).toContain("Remote image blocked")
  expect(html).toContain('href="https://example.com/shot.png"')
})

test("streaming markdown fades live text and block decorations", () => {
  const text = ["- one", "- two", "  - nested", "", "> quote", "", "---"].join("\n")
  const streaming = renderToStaticMarkup(createElement(Markdown, { text, streaming: true, streamKey: "turn:0" }))
  const final = renderToStaticMarkup(createElement(Markdown, { text }))
  expect((streaming.match(/noa-stream-seg/g) ?? []).length).toBeGreaterThan(0)
  expect((streaming.match(/noa-stream-block/g) ?? []).length).toBeGreaterThanOrEqual(5)
  expect(final).not.toContain("noa-stream-seg")
  expect(final).not.toContain("noa-stream-block")
})

test("composer commands keep GUI actions, CLI commands and skills distinct", async () => {
  const { composerCommands, findComposerCommand, filterComposerCommands, slashAtCaret } = await import("../src/agent/commands")
  const commands = composerCommands([
    {
      name: "project-check",
      type: "prompt",
      source: "projectSettings",
      description: "Check the workspace",
      argumentHint: "<target>",
    },
    { name: "compact", type: "local", description: "Summarize context", argumentHint: "[instructions]" },
    { name: "model", type: "local-jsx", description: "Terminal picker", argumentHint: "" },
    { name: "agents", type: "local", hidden: true, description: "Removed wizard", argumentHint: "" },
  ])
  expect(findComposerCommand(commands, "clear")).toMatchObject({ name: "new", action: "new" })
  expect(findComposerCommand(commands, "settings")).toMatchObject({ name: "config", action: "settings" })
  expect(findComposerCommand(commands, "model")).toMatchObject({ action: "model" })
  expect(findComposerCommand(commands, "project-check")).toMatchObject({ group: "Skills", source: "projectSettings" })
  expect(findComposerCommand(commands, "compact")).toMatchObject({ group: "Commands", type: "local" })
  expect(findComposerCommand(commands, "agents")).toBeUndefined()
  expect(filterComposerCommands(commands, "target").length).toBe(0)
  expect(filterComposerCommands(commands, "workspace").map((command) => command.name)).not.toContain("project-check")
  expect(filterComposerCommands(commands, "prj-c").map((command) => command.name)).toContain("project-check")
  expect(commands.filter((command) => command.name === "model")).toHaveLength(1)
  expect(slashAtCaret("Please use /mo", 14)).toMatchObject({ query: "mo", start: 11, end: 14 })
  expect(slashAtCaret("foo@example.com", 15)).toBeUndefined()
})

test("Anthropic sign-in codes and account responses stay in sync", () => {
  expect(parseAuthorizationCode("https://localhost/callback?code=abc&state=xyz")).toEqual({
    authorizationCode: "abc",
    state: "xyz",
  })
  expect(parseAuthorizationCode("abc#xyz")).toEqual({ authorizationCode: "abc", state: "xyz" })
  expect(parseAuthorizationCode("invalid")).toBeUndefined()

  let state = reducer(initialState, { type: "auth-start" })
  state = reducer(state, {
    type: "auth-urls",
    automaticUrl: "http://localhost/callback",
    manualUrl: "https://example.invalid/login",
  })
  expect(state.auth?.status).toBe("waiting")
  state = reducer(state, {
    type: "auth-complete",
    account: { email: "person@example.invalid", apiProvider: "firstParty" },
  })
  expect(state.auth?.status).toBe("complete")
  expect(state.account?.email).toBe("person@example.invalid")
})

test("approval scope labels follow permission destinations", async () => {
  const { permissionRememberLabel } = await import("../src/components/PermissionCard")
  expect(permissionRememberLabel([{ destination: "session" }])).toBe("Allow this conversation")
  expect(permissionRememberLabel([{ destination: "localSettings" }])).toBe("Always allow")
  expect(permissionRememberLabel([{ destination: "session" }, { destination: "projectSettings" }])).toBe("Always allow")
})

test("local command input and output survive transcript restoration", async () => {
  const cwd = "/private/tmp/local-command-project"
  const id = transcript(cwd, [
    {
      type: "user",
      uuid: "command",
      parentUuid: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        content:
          "<command-name>/pause-memory</command-name>\n<command-message>pause-memory</command-message>\n<command-args>pause</command-args>",
      },
    },
    {
      type: "system",
      subtype: "local_command",
      uuid: "output",
      parentUuid: "command",
      timestamp: "2026-01-01T00:00:01Z",
      content: "<local-command-stdout>Auto-memory paused</local-command-stdout>",
    },
  ])
  const history = await loadHistory(cwd, id)
  expect(history?.[0]).toMatchObject({ kind: "user", text: "/pause-memory pause" })
  expect(JSON.stringify(history)).toContain("Auto-memory paused")
})

test("symlinked project paths restore the CLI’s canonical transcript", async () => {
  const folder = join(config, "canonical-project")
  mkdirSync(folder)
  const physical = realpathSync(folder)
  const link = join(config, "project-link")
  symlinkSync(physical, link)
  const id = transcript(physical, [{ type: "user", message: { content: "canonical task" } }])
  expect(listSessions(link).map((session) => session.id)).toContain(id)
  expect((await loadHistory(link, id))?.[0]).toMatchObject({ kind: "user", text: "canonical task" })
})

test("compaction markers and failed turn results survive history restoration", async () => {
  const { appendTurnResult } = await import("../server/sessions")
  const cwd = "/private/tmp/output-history"
  const id = transcript(cwd, [
    { type: "user", uuid: "u", message: { content: "task" } },
    { type: "assistant", uuid: "a", parentUuid: "u", message: { content: [{ type: "text", text: "partial" }] } },
    { type: "system", subtype: "compact_boundary", uuid: "compact", parentUuid: "a", compactMetadata: { trigger: "manual" } },
  ])
  appendTurnResult(cwd, id, { index: 1, userMessageId: "u", durationMs: 100, error: "Provider failed" })
  const history = await loadHistory(cwd, id)
  expect(history).toContainEqual({ kind: "compaction", trigger: "manual" })
  expect(history).toContainEqual({ kind: "turn-duration", durationMs: 100, error: "Provider failed" })
})

test("manual compact history shows the command before its completion", async () => {
  const id = transcript("/private/tmp/compact-command-order", [
    { type: "system", subtype: "compact_boundary", uuid: "b", parentUuid: null, compactMetadata: { trigger: "manual" } },
    { type: "user", uuid: "s", parentUuid: "b", isCompactSummary: true, message: { content: "summary" } },
    { type: "user", uuid: "c", parentUuid: "s", message: { content: "<command-name>/compact</command-name>" } },
  ])
  const history = await loadHistory("/private/tmp/compact-command-order", id)
  expect(history?.[0]).toMatchObject({ kind: "user", text: "/compact" })
  expect(history?.[1]).toMatchObject({ kind: "compaction", trigger: "manual" })
})

test("disk history restores Agent identity, terminal status and child tool results", async () => {
  const cwd = "/private/tmp/restored-agent"
  const id = transcript(cwd, [
    { type: "user", uuid: "u", parentUuid: null, message: { content: "Inspect" } },
    { type: "assistant", uuid: "a", parentUuid: "u", message: { id: "m", content: [{ type: "tool_use", id: "agent-tool", name: "Agent", input: { description: "Inspect files" } }] } },
    { type: "user", uuid: "r", parentUuid: "a", message: { content: [{ type: "tool_result", tool_use_id: "agent-tool", content: "Done" }] }, toolUseResult: { status: "completed", agentId: "child-1", totalDurationMs: 100, totalTokens: 20, totalToolUseCount: 1 } },
  ])
  const childDir = join(config, "projects", sanitizePath(cwd), id, "subagents")
  mkdirSync(childDir, { recursive: true })
  writeFileSync(join(childDir, "agent-child-1.jsonl"), [
    { type: "user", uuid: "cu", parentUuid: null, isSidechain: true, message: { content: "Inspect files" } },
    { type: "assistant", uuid: "ca", parentUuid: "cu", isSidechain: true, message: { id: "cm", content: [{ type: "tool_use", id: "read", name: "Read", input: { file_path: "a.ts" } }] } },
    { type: "user", uuid: "cr", parentUuid: "ca", isSidechain: true, message: { content: [{ type: "tool_result", tool_use_id: "read", content: "file contents" }] } },
  ].map(entry => JSON.stringify({ cwd, ...entry })).join("\n"))
  let state = initialState
  for (const item of (await loadHistory(cwd, id)) ?? []) {
    if (item.kind === "agent") state = reducer(state, { type: "agent", message: item.message })
  }
  expect(state.tasks[0]).toMatchObject({ id: "child-1", toolUseId: "agent-tool", status: "completed", description: "Inspect files", turns: [{ blocks: [{ name: "Read", status: "done", output: "file contents" }] }] })
})

test("hook timeline survives disk restoration at its transcript anchor", async () => {
  const { appendTimelineEvent } = await import("../server/sessions")
  const cwd = "/private/tmp/restored-hook-timeline"
  const id = transcript(cwd, [
    { type: "user", uuid: "u", parentUuid: null, message: { content: "Run" } },
    { type: "assistant", uuid: "a", parentUuid: "u", message: { id: "m1", content: [{ type: "text", text: "Before hook" }] } },
    { type: "assistant", uuid: "b", parentUuid: "a", message: { id: "m2", content: [{ type: "text", text: "After hook" }] } },
  ])
  appendTimelineEvent(cwd, id, { turn: 1, afterUuid: "a", message: { type: "system", subtype: "hook_started", hook_id: "h", hook_name: "Check", hook_event: "Stop" } })
  appendTimelineEvent(cwd, id, { turn: 1, afterUuid: "a", message: { type: "system", subtype: "hook_response", hook_id: "h", hook_name: "Check", hook_event: "Stop", output: "Check failed", outcome: "error", exit_code: 1 } })
  const state = reducer(initialState, { type: "history", items: (await loadHistory(cwd, id))! })
  const blocks = state.turns.flatMap(turn => turn.role === "assistant" ? turn.blocks : [])
  expect(blocks).toMatchObject([{ text: "Before hook" }, { kind: "tool", status: "error", output: "Check failed" }, { text: "After hook" }])
})

test("nested Agent disk transcripts restore as separately addressable tasks", async () => {
  const cwd = "/private/tmp/nested-restored-agent"
  const id = transcript(cwd, [
    { type: "user", message: { content: "Inspect" } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "outer", name: "Agent", input: { description: "Outer" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "outer", content: "Done" }] }, toolUseResult: { status: "completed", agentId: "child" } },
  ])
  const folder = join(config, "projects", sanitizePath(cwd), id, "subagents")
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, "agent-child.jsonl"), [
    { type: "assistant", isSidechain: true, message: { content: [{ type: "tool_use", id: "inner", name: "Agent", input: { description: "Inner" } }] } },
    { type: "user", isSidechain: true, message: { content: [{ type: "tool_result", tool_use_id: "inner", content: "Nested done" }] }, toolUseResult: { status: "completed", agentId: "nested" } },
  ].map(entry => JSON.stringify({ cwd, ...entry })).join("\n"))
  writeFileSync(join(folder, "agent-nested.jsonl"), JSON.stringify({ cwd, type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "Nested child result" }] } }))
  const state = reducer(initialState, { type: "history", items: (await loadHistory(cwd, id))! })
  expect(state.tasks.map(task => [task.id, task.toolUseId])).toEqual([["child", "outer"], ["nested", "inner"]])
  expect(state.tasks[1]?.turns[0]).toMatchObject({ blocks: [{ text: "Nested child result" }] })
})

test("legacy timeline turn ordinals resolve through raw UUIDs after abandoned branches", async () => {
  const { appendTimelineEvent } = await import("../server/sessions")
  const cwd = "/private/tmp/timeline-branch-anchor"
  const id = transcript(cwd, [
    { type: "user", uuid: "u1", parentUuid: null, timestamp: "2026-01-01T00:00:00Z", message: { content: "First" } },
    { type: "user", uuid: "old", parentUuid: "u1", timestamp: "2026-01-01T00:00:01Z", message: { content: "Abandoned" } },
    { type: "user", uuid: "u2", parentUuid: "u1", timestamp: "2026-01-01T00:00:02Z", message: { content: "Second" } },
    { type: "user", uuid: "u3", parentUuid: "u2", timestamp: "2026-01-01T00:00:03Z", message: { content: "Third" } },
  ])
  appendTimelineEvent(cwd, id, { turn: 4, message: { type: "system", subtype: "hook_started", hook_id: "h", hook_name: "Current hook", hook_event: "PreToolUse" } })
  const history = (await loadHistory(cwd, id))!
  expect(history.filter(item => item.kind === "user").map(item => item.text)).toEqual(["First", "Second", "Third"])
  expect(history.at(-1)).toMatchObject({ kind: "agent", message: { subtype: "hook_started", hook_name: "Current hook" } })
})

test("turn anchors ignore late background results before the next real prompt", () => {
  const cwd = "/private/tmp/strict-user-anchor"
  const id = transcript(cwd, [{ type: "user", uuid: "first", message: { content: "First" } }])
  const file = transcriptPath(cwd, id)
  const offset = statSync(file).size
  appendFileSync(file, JSON.stringify({ cwd, type: "user", uuid: "background-result", message: { content: [{ type: "tool_result", tool_use_id: "old-tool", content: "done" }] } }) + "\n")
  expect(findTurnUserMessage(cwd, id, offset, true)).toBeUndefined()
  appendFileSync(file, JSON.stringify({ cwd, type: "user", uuid: "next-prompt", message: { content: "Next" } }) + "\n")
  expect(findTurnUserMessage(cwd, id, offset, true)).toBe("next-prompt")
})

test("persisted Agent terminal state outranks async launch inference", async () => {
  const { appendTimelineEvent } = await import("../server/sessions")
  const cwd = "/private/tmp/completed-before-launch-result"
  const id = transcript(cwd, [
    { type: "user", uuid: "u", parentUuid: null, message: { content: "Inspect" } },
    { type: "assistant", uuid: "a", parentUuid: "u", message: { content: [{ type: "tool_use", id: "tool", name: "Agent", input: { description: "Inspect" } }] } },
    { type: "user", uuid: "r", parentUuid: "a", message: { content: [{ type: "tool_result", tool_use_id: "tool", content: "Launched" }] }, toolUseResult: { status: "async_launched", agentId: "child" } },
  ])
  appendTimelineEvent(cwd, id, { turn: 1, afterUuid: "a", message: { type: "system", subtype: "task_notification", task_id: "child", tool_use_id: "tool", status: "completed", summary: "Done" } })
  const state = reducer(initialState, { type: "history", items: (await loadHistory(cwd, id))! })
  expect(state.tasks[0]).toMatchObject({ status: "completed", summary: "Done" })
})

test("legacy user messages also retain bookmark identity across history reloads", async () => {
  const cwd = "/private/tmp/legacy-bookmark-identity"
  const id = transcript(cwd, [{ type: "user", message: { content: "Same prompt" } }, { type: "user", message: { content: "Same prompt" } }])
  const first = (await loadHistory(cwd, id))!.filter(item => item.kind === "user").map(item => item.id)
  const second = (await loadHistory(cwd, id))!.filter(item => item.kind === "user").map(item => item.id)
  expect(first.every(Boolean)).toBe(true)
  expect(new Set(first).size).toBe(2)
  expect(second).toEqual(first)
})
