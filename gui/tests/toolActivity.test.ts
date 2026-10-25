import { expect, test } from "bun:test"
import { groupActivityBlocks, toolActivityLabel, toolActivitySummary, toolDiffStats } from "../src/agent/toolActivity"

test("tool activity uses action phrases instead of raw tool names", () => {
  expect(toolActivityLabel({ name: "Bash", status: "running", input: { command: "npm test" } }))
    .toEqual({ action: "Running", detail: "npm test" })
  expect(toolActivityLabel({ name: "Read", status: "done", input: { file_path: "/repo/gui/src/App.tsx" } }))
    .toEqual({ action: "Read", detail: "App.tsx" })
  expect(toolActivityLabel({ name: "Grep", status: "done", input: { pattern: "tool call" } }))
    .toEqual({ action: "Searched for", detail: "tool call" })
  expect(toolActivityLabel({ name: "Read", status: "done", input: { file_path: "/tmp/preview.png" } }))
    .toEqual({ action: "Viewed", detail: "an image" })
  expect(toolActivityLabel({
    name: "Read",
    status: "done",
    input: { file_path: "/tmp/preview.png" },
    images: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "YQ==" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "Yg==" } },
    ],
  })).toEqual({ action: "Viewed", detail: "2 images" })
})

test("failed and unknown tools remain explicit", () => {
  expect(toolActivityLabel({ name: "Edit", status: "error", input: { file_path: "src/App.tsx" } }))
    .toEqual({ action: "Couldn’t edit", detail: "App.tsx" })
  expect(toolActivityLabel({ name: "CustomTool", status: "running", input: { query: "hello" } }))
    .toEqual({ action: "Calling CustomTool", detail: "hello" })
  expect(toolActivityLabel({ name: "mcp__filesystem__read_file", status: "done", input: { path: "/tmp/a" } }))
    .toEqual({ action: "Used read_file", detail: "filesystem" })
})

test("completed activity summaries combine semantic tool actions", () => {
  expect(toolActivitySummary([
    { name: "Edit", input: { file_path: "/repo/gui/src/App.tsx" } },
    { name: "Read", input: { file_path: "/repo/gui/src/App.tsx" } },
    { name: "Bash", input: { command: "bun test" } },
  ])).toEqual({ label: "Edited a file, read files, ran a command", kind: "edits" })
  expect(toolActivitySummary([
    { name: "Read", input: { file_path: "/tmp/preview.png" } },
    { name: "Read", input: { file_path: "/tmp/after.png" } },
  ])).toEqual({ label: "Viewed 2 images", kind: "images" })
  expect(toolActivitySummary([
    { name: "Edit", input: { file_path: "/repo/src/App.tsx" } },
    { name: "Edit", input: { file_path: "/repo/src/App.tsx" } },
  ])).toEqual({ label: "Edited a file", kind: "edits" })
})

test("file changes expose per-file line counts", () => {
  expect(toolDiffStats({
    name: "Edit",
    input: { old_string: "one\ntwo", new_string: "one\nthree\nfour" },
  })).toEqual({ additions: 2, deletions: 1 })
  expect(toolDiffStats({
    name: "Edit",
    input: { old_string: "a\nb\nc\nd\ne", new_string: "a\nx\nc\ny\ne" },
  })).toEqual({ additions: 2, deletions: 2 })
  expect(toolDiffStats({
    name: "MultiEdit",
    input: { edits: [
      { old_string: "a", new_string: "b" },
      { old_string: "c\nd", new_string: "c" },
    ] },
  })).toEqual({ additions: 1, deletions: 2 })
  expect(toolDiffStats({ name: "Write", input: { content: "a\nb\n" } })).toEqual({ additions: 2, deletions: 0 })
})

test("activity grouping follows Codex boundaries", () => {
  const read = { kind: "tool" as const, id: "read", name: "Read", input: { file_path: "/repo/src/App.tsx" }, partialJson: "", status: "done" as const }
  const run = { kind: "tool" as const, id: "run", name: "Bash", input: { command: "bun test" }, partialJson: "", status: "done" as const }
  const image = { kind: "tool" as const, id: "image", name: "Read", input: { file_path: "/tmp/preview.png" }, partialJson: "", status: "done" as const }
  const thought = { kind: "thinking" as const, text: "Inspect", done: true }
  const task = { kind: "tool" as const, id: "task", name: "Task", input: { description: "Inspect rendering" }, partialJson: "", status: "done" as const }
  const text = { kind: "text" as const, text: "Now implementing." }
  const empty = { kind: "text" as const, text: "" }

  expect(groupActivityBlocks([read, thought, empty, run, image, task, read, thought, text])).toMatchObject([
    { kind: "tools", blocks: [{ id: "read" }, { id: "run" }] },
    { kind: "tools", blocks: [{ id: "image" }] },
    { kind: "tools", blocks: [{ id: "task" }] },
    { kind: "tools", blocks: [{ id: "read" }] },
    { kind: "text" },
  ])
})

test("only active thinking is rendered", () => {
  const thought = { kind: "thinking" as const, text: "Inspecting", done: false }
  expect(groupActivityBlocks([thought])).toMatchObject([{ kind: "thinking" }])
  expect(groupActivityBlocks([{ ...thought, done: true }])).toEqual([])
})
