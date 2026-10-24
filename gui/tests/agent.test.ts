import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sanitizePath } from "../../src/utils/sessionStoragePortable"
import { loadHistory, listSessions } from "../server/sessions"
import { initialState, reducer } from "../src/agent/reducer"

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
test("long project paths use the CLI transcript directory", async () => {
  const cwd = `/private/tmp/${"a".repeat(99)}/${"b".repeat(99)}/project`
  const id = transcript(cwd, [{ type: "user", message: { content: "long path task" } }])
  expect(listSessions(cwd).map((s) => s.id)).toContain(id)
  expect((await loadHistory(cwd, id))?.[0]).toMatchObject({ kind: "user", text: "long path task" })
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

test("composer commands keep GUI actions, CLI commands and skills distinct", async () => {
  const { composerCommands, findComposerCommand, filterComposerCommands } = await import("../src/agent/commands")
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
  expect(filterComposerCommands(commands, "workspace").map((command) => command.name)).toContain("project-check")
  expect(commands.filter((command) => command.name === "model")).toHaveLength(1)
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
