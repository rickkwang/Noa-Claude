import { expect, test } from "bun:test"
import { formatElapsed, groupActivityBlocks, groupActivityRuns, shellActivitySteps, shellStepActiveLabel, shellStepLabel, toolActivityLabel, toolActivitySummary, toolDiffStats, toolElapsedMs, toolRowSteps, toolShellSteps } from "../src/agent/toolActivity"

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

test("stopped tools read as stopped and keep elapsed time", () => {
  expect(toolActivityLabel({ name: "Bash", status: "stopped", input: { command: "bun test" } }))
    .toEqual({ action: "Stopped", detail: "bun test" })
  expect(toolActivityLabel({ name: "Edit", status: "stopped", input: { file_path: "/repo/App.tsx" } }))
    .toEqual({ action: "Stopped editing", detail: "App.tsx" })
  expect(toolElapsedMs({ status: "stopped", startedAt: 1_000, endedAt: 4_500 })).toBe(3_500)
  expect(toolElapsedMs({ status: "running", startedAt: 1_000 }, 3_000)).toBe(2_000)
  expect(formatElapsed(3_500)).toBe("4s")
  expect(formatElapsed(65_000)).toBe("1m 5s")
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
  expect(toolActivitySummary([
    { name: "WebSearch", input: { query: "a" } },
    { name: "Bash", input: { command: "ls" } },
    { name: "mcp__s__t", input: {} },
  ])).toEqual({ label: "Called a tool, ran a command, searched the web", kind: "commands" })
  expect(toolActivitySummary([{ name: "WebSearch", input: { query: "a" } }])).toEqual({ label: "Searched the web", kind: "web" })
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
  const thought = { kind: "thinking" as const, text: "Inspect", done: false }
  const task = { kind: "tool" as const, id: "task", name: "Task", input: { description: "Inspect rendering" }, partialJson: "", status: "done" as const }
  const text = { kind: "text" as const, text: "Now implementing." }
  const empty = { kind: "text" as const, text: "" }

  expect(groupActivityBlocks([read, thought, empty, run, image, task, read, thought, text])).toMatchObject([
    { kind: "tools", blocks: [{ id: "read" }] },
    { kind: "thinking" },
    { kind: "tools", blocks: [{ id: "run" }] },
    { kind: "tools", blocks: [{ id: "image" }] },
    { kind: "tools", blocks: [{ id: "task" }] },
    { kind: "tools", blocks: [{ id: "read" }] },
    { kind: "thinking" },
    { kind: "text" },
  ])
})

test("returned thinking stays available after it finishes", () => {
  const thought = { kind: "thinking" as const, text: "Inspecting", done: false }
  expect(groupActivityBlocks([thought])).toMatchObject([{ kind: "thinking" }])
  expect(groupActivityBlocks([{ ...thought, done: true }])).toMatchObject([{ kind: "thinking" }])
})

test("activity runs group consecutive reasoning and tool calls", () => {
  const thought = { kind: "thinking" as const, text: "Inspect", done: false }
  const read = { kind: "tool" as const, id: "read", name: "Read", input: { file_path: "/repo/a.ts" }, partialJson: "", status: "done" as const }
  const run = { kind: "tool" as const, id: "run", name: "Bash", input: { command: "bun test" }, partialJson: "", status: "done" as const }
  const text = { kind: "text" as const, text: "Done." }

  expect(groupActivityRuns(groupActivityBlocks([thought, read, thought, text, run]))).toMatchObject([
    { kind: "activity", blocks: [{ kind: "thinking" }, { kind: "tool" }, { kind: "thinking" }] },
    { kind: "text" },
    { kind: "activity", blocks: [{ kind: "tool" }] },
  ])
})

test("shell commands that only read, search or list files become file actions", () => {
  const steps = (command: string) => shellActivitySteps(command)?.map(step => shellStepLabel(step, true)).map(label => `${label.action} ${label.detail}`.trim())
  expect(steps(`sed -n 280,340p gui/src/components/MessageList.tsx && echo "===760-1010===" && sed -n '760,1010p' gui/src/agent/toolActivity.ts`))
    .toEqual(["Read MessageList.tsx", "Read toolActivity.ts"])
  expect(steps(`grep -n "groupActivityRuns\\|type Block" -r gui/src | head -20`)).toEqual(["Searched for groupActivityRuns\\|type Block in gui"])
  expect(steps("cat gui/package.json | head -80 && ls gui/tests | head -40")).toEqual(["Read package.json", "Listed files in tests"])
  expect(steps("nl -ba gui/src/App.tsx | sed -n '150,165p;200,210p'")).toEqual(["Read App.tsx"])
  expect(steps("rg --files -g 'AGENTS.md' | rg agent | head -100")).toEqual(["Listed files", "Searched for agent"])
  expect(steps("rg -n -g '*.ts' -e 'a|b' gui/src/components | tail -18; wc -l a.ts")).toEqual(["Searched for a|b in components"])
  expect(steps("find gui/src -maxdepth 2 -type f")).toEqual(["Listed files in gui"])
  // Line continuations, comments and the current folder read the way the shell runs them.
  expect(steps("rg -n needle \\\n  gui/src/components")).toEqual(["Searched for needle in components"])
  expect(steps("cat a.ts  # quick look")).toEqual(["Read a.ts"])
  expect(steps("# the header first\nsed -n '1,9p' a.ts &&\n  rg -n b .")).toEqual(["Read a.ts", "Searched for b"])
  expect(steps("find . -maxdepth 2 -type f; ls -la ./")).toEqual(["Listed files", "Listed files"])
  // Any step that runs something else, writes, or needs expansion stays a plain command.
  expect(steps(`git status && echo "---DIFF---" && git diff`)).toBeUndefined()
  expect(steps("bun run build 2>&1 | tail -15")).toBeUndefined()
  expect(steps("cat > notes.txt")).toBeUndefined()
  expect(steps("cat $HOME/notes.txt")).toBeUndefined()
  expect(steps("ls ~/Applications")).toBeUndefined()
  expect(steps("sed -i 's/a/b/' file.ts")).toBeUndefined()
  expect(steps("tail -36 /tmp/debug.log")).toBeUndefined()
  expect(steps("head -15 gui/src/lib/glyphs.ts")).toBeUndefined()
  expect(steps("find . -name '*.ts' -delete")).toBeUndefined()
  expect(steps("ps ax | rg electron")).toBeUndefined()
  expect(steps("grep needle")).toBeUndefined()
  expect(steps("rg -n 'unterminated")).toBeUndefined()
  expect(steps("echo done")).toBeUndefined()
  expect(steps("")).toBeUndefined()
})

test("file-action commands read as file actions while running and count as reading", () => {
  const read = { name: "Bash", input: { command: "sed -n '1,20p' gui/src/App.tsx" } }
  expect(toolShellSteps({ ...read, status: "running" })?.map(shellStepActiveLabel)).toEqual([{ action: "Reading", detail: "App.tsx" }])
  expect(shellStepActiveLabel(shellActivitySteps("rg -n needle gui/src/components")![0]!)).toEqual({ action: "Searching", detail: "files in components folder" })
  // A failed read stays a visible command failure.
  expect(toolShellSteps({ ...read, status: "error" })).toBeUndefined()
  // A finished command lands as one row per action; a running or failed one is a single row.
  const chain = { name: "Bash", input: { command: "sed -n '1,9p' a.ts && rg -n b src" } }
  expect(toolRowSteps({ ...chain, status: "done" }).map(step => step?.kind)).toEqual(["read", "search"])
  expect(toolRowSteps({ ...chain, status: "running" })).toEqual([undefined])
  expect(toolRowSteps({ ...chain, status: "error" })).toEqual([undefined])
  expect(toolActivitySummary([{ ...read, status: "done" }, { name: "Bash", status: "done", input: { command: "bun test" } }])?.label)
    .toBe("Read files, ran a command")
})
