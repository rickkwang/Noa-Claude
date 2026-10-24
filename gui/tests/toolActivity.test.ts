import { expect, test } from "bun:test"
import { groupActivityBlocks, toolActivityLabel, toolActivitySummary } from "../src/agent/toolActivity"

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

test("activity grouping follows Codex boundaries", () => {
  const read = { kind: "tool" as const, id: "read", name: "Read", input: { file_path: "/repo/src/App.tsx" }, partialJson: "", status: "done" as const }
  const run = { kind: "tool" as const, id: "run", name: "Bash", input: { command: "bun test" }, partialJson: "", status: "done" as const }
  const image = { kind: "tool" as const, id: "image", name: "Read", input: { file_path: "/tmp/preview.png" }, partialJson: "", status: "done" as const }
  const thought = { kind: "thinking" as const, text: "Inspect", done: true }
  const text = { kind: "text" as const, text: "Now implementing." }
  const empty = { kind: "text" as const, text: "" }

  expect(groupActivityBlocks([read, thought, empty, run, image, read, thought, text])).toMatchObject([
    { kind: "tools", blocks: [{ id: "read" }, { id: "run" }] },
    { kind: "tools", blocks: [{ id: "image" }] },
    { kind: "tools", blocks: [{ id: "read" }] },
    { kind: "text" },
  ])
})

test("only active thinking is rendered", () => {
  const thought = { kind: "thinking" as const, text: "Inspecting", done: false }
  expect(groupActivityBlocks([thought])).toMatchObject([{ kind: "thinking" }])
  expect(groupActivityBlocks([{ ...thought, done: true }])).toEqual([])
})
