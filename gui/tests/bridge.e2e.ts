import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { initialState, reducer } from "../src/agent/reducer"
import type { Envelope, Outgoing } from "../src/agent/protocol"

const directory = mkdtempSync(join(tmpdir(), "noa-gui-runtime-"))
const cwd = join(directory, "workspace")
const plainCwd = join(directory, "plain")
const config = join(directory, "config")
mkdirSync(cwd)
mkdirSync(plainCwd)
mkdirSync(config)
writeFileSync(
  join(config, "settings.json"),
  JSON.stringify({
    model: "claude-sonnet-4-6",
    permissions: { defaultMode: "default" },
    enableAllProjectMcpServers: true,
  }),
)
const mcpScript = join(directory, "mcp.ts")
writeFileSync(
  mcpScript,
  `import { createInterface } from "node:readline";
let pending;
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
for await (const line of createInterface({ input: process.stdin })) {
 const message = JSON.parse(line);
 if (message.method === "initialize") send({id:message.id,result:{protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"gui-fixture",version:"1"}}});
 else if (message.method === "tools/list") send({id:message.id,result:{tools:[{name:"choose",description:"Request a workspace choice",inputSchema:{type:"object",properties:{},additionalProperties:false}}]}});
 else if (message.method === "tools/call") {pending=message.id;send({id:"ask",method:"elicitation/create",params:{message:"Choose workspace",requestedSchema:{type:"object",properties:{workspace:{type:"string",enum:["local","remote"]}},required:["workspace"]}}});}
 else if (message.id === "ask") send({id:pending,result:{content:[{type:"text",text:JSON.stringify(message.result)}]}});
 else if (message.id !== undefined) send({id:message.id,result:{}});
}`,
)
mkdirSync(join(cwd, ".noa"))
writeFileSync(
  join(cwd, ".noa", "mcp.json"),
  JSON.stringify({ mcpServers: { fixture: { type: "stdio", command: process.execPath, args: [mcpScript] } } }),
)
// Per-turn diffs need a git worktree; seed one file so the write below is the only change.
writeFileSync(join(cwd, "seed.txt"), "seed\n")
for (const args of [
  ["init", "-q"],
  ["config", "user.email", "t@t"],
  ["config", "user.name", "t"],
  ["add", "-A"],
  ["commit", "-qm", "init"],
]) {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args])
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
}
let sawSkillWithImage = false
let sawImage = false
const observedModels = new Set<string>()
let calls = 0
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method !== "POST") return Response.json({})
    const body = (await request.json()) as any
    if (request.url.includes("count_tokens")) return Response.json({ input_tokens: 100 })
    if (!request.url.includes("messages")) return Response.json({})
    calls++
    observedModels.add(body.model)
    sawImage ||= body.messages?.some(
      (m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "image"),
    )
    sawSkillWithImage ||=
      JSON.stringify(body.messages).includes("GUI_SLASH_SKILL_INSTRUCTIONS") &&
      body.messages?.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "image"))
    const last = body.messages?.at(-1)?.content
    const hasResult = Array.isArray(last) && last.some((b: any) => b.type === "tool_result")
    const question = !hasResult && JSON.stringify(last).includes("GUI_QUESTION")
    const mcp = !hasResult && JSON.stringify(last).includes("GUI_MCP_FORM")
    const background =
      !hasResult &&
      JSON.stringify(last).includes("GUI_BACKGROUND") &&
      !JSON.stringify(last).includes("GUI_BACKGROUND_OK")
    const plainWrite = !hasResult && JSON.stringify(last).includes("GUI_WRITE_PLAIN")
    const write =
      !hasResult &&
      !plainWrite &&
      JSON.stringify(last).includes("GUI_WRITE") &&
      !JSON.stringify(last).includes("GUI_WRITE_OK")
    // Leave the turn running after the write result, so the live diff arrives
    // before the final text and the turn diff.
    if (hasResult && !JSON.stringify(last).includes("GUI_WRITE_PLAIN") && JSON.stringify(body.messages).includes("GUI_WRITE"))
      await Bun.sleep(800)
    if (JSON.stringify(last).includes("GUI_SLOW")) await Bun.sleep(1500)
    if (JSON.stringify(last).includes("GUI_STEER")) await Bun.sleep(10000)
    const block = mcp
      ? {
          type: "tool_use",
          id: `mcp_${calls}`,
          name:
            body.tools?.find((t: any) => t.name.includes("fixture") && t.name.endsWith("choose"))?.name ??
            "mcp__fixture__choose",
          input: {},
        }
      : question
        ? {
            type: "tool_use",
            id: `question_${calls}`,
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Which verification?",
                  header: "Verify",
                  options: [
                    { label: "Focused", description: "This task" },
                    { label: "Full", description: "Everything" },
                  ],
                },
              ],
            },
          }
        : background
          ? {
              type: "tool_use",
              id: `bash_${calls}`,
              name: "Bash",
              input: {
                command: "sleep 1; printf GUI_BACKGROUND_OK",
                description: "Background verification",
                run_in_background: true,
              },
            }
          : plainWrite
            ? {
                type: "tool_use",
                id: `plain_write_${calls}`,
                name: "Write",
                input: { file_path: join(plainCwd, "turn-diff.txt"), content: "one\ntwo\n" },
              }
            : write
              ? {
                  type: "tool_use",
                  id: `write_${calls}`,
                  name: "Write",
                  input: { file_path: join(cwd, "turn-diff.txt"), content: "one\ntwo\n" },
                }
              : { type: "text", text: `GUI_REPLY_${calls}` }
    const reason = block.type === "text" ? "end_turn" : "tool_use"
    const message = {
      id: `msg_${crypto.randomUUID()}`,
      type: "message",
      role: "assistant",
      model: body.model,
      content: [block],
      stop_reason: reason,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    }
    if (!body.stream) return Response.json(message)
    const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    return new Response(
      event("message_start", { message: { ...message, content: [], stop_reason: null } }) +
        event("content_block_start", {
          index: 0,
          content_block: block.type === "text" ? { type: "text", text: "" } : { ...block, input: {} },
        }) +
        event("content_block_delta", {
          index: 0,
          delta:
            block.type === "text"
              ? { type: "text_delta", text: block.text }
              : { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        }) +
        event("content_block_stop", { index: 0 }) +
        event("message_delta", { delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 20 } }) +
        event("message_stop", {}),
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const port = reservation.port!
reservation.stop(true)
const bridge = Bun.spawn([process.execPath, "run", "server/main.ts"], {
  cwd: resolve(import.meta.dir, ".."),
  env: {
    ...process.env,
    NOA_GUI_PORT: String(port),
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_CODE_PRODUCT_DIR: config,
    CLAUDE_CODE_CACHE_DIR: join(directory, "cache"),
    CLAUDE_CODE_USE_OPENAI: "",
    CLAUDE_CODE_USE_BEDROCK: "",
    CLAUDE_CODE_USE_VERTEX: "",
    CLAUDE_CODE_USE_FOUNDRY: "",
    NOA_CLAUDE_OPENAI_AUTH: "",
    OPENAI_BASE_URL: "",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "",
    ANTHROPIC_DEFAULT_FABLE_MODEL: "",
    NOA_CLAUDE_PROVIDER_MODELS: "",
    NOA_CLAUDE_PROVIDER_CONTEXT_WINDOWS: "",
    NOA_CLAUDE_PROVIDER_EFFORT_LEVELS: "",
    NOA_CLAUDE_PROVIDER_MAX_OUTPUT_TOKENS: "",
    ANTHROPIC_API_KEY: "local-fixture",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.port}`,
    ANTHROPIC_MODEL: "claude-sonnet-4-6",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_TOOL_SEARCH: "false",
  },
  stdout: "pipe",
  stderr: "pipe",
})
const sockets: WebSocket[] = []
const wait = async (predicate: () => boolean, label: string, timeout = 20000) => {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await Bun.sleep(25)
  }
}
function connect(runtime: string, resume?: string, workdir = cwd) {
  const events: Envelope[] = []
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/ws?${new URLSearchParams({ cwd: workdir, runtime, ...(resume ? { resume } : {}) })}`,
  )
  sockets.push(socket)
  socket.onmessage = (event) => events.push(JSON.parse(String(event.data)))
  const send = (message: Outgoing) => socket.send(JSON.stringify(message))
  const initialize = async () => {
    await wait(() => socket.readyState === WebSocket.OPEN, "socket open")
    const id = crypto.randomUUID()
    send({ type: "control_request", request_id: id, request: { subtype: "initialize" } })
    await wait(
      () =>
        events.some(
          (e) => e.kind === "agent" && e.message.type === "control_response" && e.message.response.request_id === id,
        ),
      "initialize",
    )
    const response = events.find(
      (e) => e.kind === "agent" && e.message.type === "control_response" && e.message.response.request_id === id,
    ) as any
    assert.equal(response.message.response.subtype, "success", JSON.stringify(response.message.response))
    return response.message.response.response
  }
  const results = () => events.filter((e) => e.kind === "agent" && e.message.type === "result")
  return { socket, events, send, initialize, results }
}
try {
  for (let i = 0; i < 200; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/info`)
      break
    } catch {
      await Bun.sleep(25)
    }
  }
  await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: cwd }),
  })
  if (process.env.NOA_GUI_BROWSER_FIXTURE === "1") {
    console.log(`BROWSER_FIXTURE http://127.0.0.1:${port}/?cwd=${encodeURIComponent(cwd)}`)
    process.on("SIGTERM", () => {
      bridge.kill("SIGTERM")
      provider.stop(true)
      rmSync(directory, { recursive: true, force: true })
      process.exit(0)
    })
    await new Promise(() => {})
  }
  const runtime = crypto.randomUUID()
  const first = connect(runtime)
  const concurrent = connect(runtime)
  const [init, otherInit] = await Promise.all([first.initialize(), concurrent.initialize()])
  assert.equal(init.pid, otherInit.pid)
  concurrent.socket.close()
  console.log("PASS simultaneous initialize requests share one CLI handshake")
  assert.ok(init.models.length)
  first.send({ type: "user", message: { role: "user", content: "GUI_SLOW first" }, parent_tool_use_id: null })
  await wait(() => first.events.some((e) => e.kind === "user"), "user acknowledgement")
  first.send({ type: "user", message: { role: "user", content: "second queued" }, parent_tool_use_id: null })
  first.send({ type: "user", message: { role: "user", content: "remove this" }, parent_tool_use_id: null })
  await wait(() => first.events.some((e) => e.kind === "queue" && e.messages.length === 2), "queue")
  const queued = first.events.filter((e) => e.kind === "queue").at(-1) as Extract<Envelope, { kind: "queue" }>
  first.send({ type: "queue_update", id: queued.messages[0]!.id, content: "second updated" })
  await wait(
    () => first.events.some((e) => e.kind === "queue" && e.messages[0]?.content === "second updated"),
    "queue update",
  )
  first.send({ type: "queue_move", id: queued.messages[1]!.id, toIndex: 0 })
  await wait(
    () => first.events.some((e) => e.kind === "queue" && e.messages[0]?.id === queued.messages[1]!.id),
    "queue reorder",
  )
  first.send({ type: "queue_move", id: queued.messages[1]!.id, toIndex: 1 })
  first.send({ type: "queue_pause", paused: true })
  await wait(
    () => first.events.some((e) => e.kind === "queue" && e.paused === true),
    "queue pause",
  )
  first.send({ type: "queue_pause", paused: false })
  first.send({ type: "queue_remove", id: queued.messages[1]!.id })
  first.socket.close()
  await Bun.sleep(50)
  const second = connect(runtime)
  const resumed = await second.initialize()
  assert.equal(resumed.pid, init.pid)
  await wait(() => second.results().length === 2, "both queued turns complete")
  assert.equal(second.events.filter((e) => e.kind === "user").length, 2)
  assert.ok(!JSON.stringify(second.events.filter((e) => e.kind === "user")).includes("remove this"))
  console.log("PASS disconnect/reconnect retains the same CLI, replays turns and runs a removable queue")
  const initMessage = second.events.find(
    (e) => e.kind === "agent" && e.message.type === "system" && e.message.subtype === "init",
  ) as any
  assert.ok(initMessage?.message.session_id)
  second.socket.close()
  const third = connect(crypto.randomUUID(), initMessage.message.session_id)
  const selected = await third.initialize()
  assert.notEqual(selected.pid, init.pid)
  await wait(() => {
    try {
      process.kill(init.pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH"
    }
  }, "idle task process reclaimed")
  console.log("PASS detached idle sessions release their CLI and resume in a fresh process")
  const thirdResultBase = third.results().length
  const thirdUserBase = third.events.filter((e) => e.kind === "user").length
  third.send({ type: "user", message: { role: "user", content: "GUI_QUESTION" }, parent_tool_use_id: null })
  await wait(
    () =>
      third.events.some(
        (e) =>
          e.kind === "agent" &&
          e.message.type === "control_request" &&
          (e.message.request as any).tool_name === "AskUserQuestion",
      ),
    "question approval",
  )
  const permission = third.events.findLast((e) => e.kind === "agent" && e.message.type === "control_request") as any
  third.send({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: permission.message.request_id,
      response: {
        behavior: "allow",
        updatedInput: { ...permission.message.request.input, answers: { "Which verification?": "Focused" } },
      },
    },
  })
  await wait(() => third.results().length === thirdResultBase + 1, "question answered")
  console.log("PASS real CLI AskUserQuestion approval and continuation")
  third.send({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: "image round trip" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=",
          },
        },
      ],
    },
    parent_tool_use_id: null,
  })
  await wait(() => third.results().length === thirdResultBase + 2, "image turn")
  assert.ok(sawImage)
  console.log("PASS image content travels through bridge and CLI to the local provider")
  third.send({ type: "user", message: { role: "user", content: "GUI_MCP_FORM" }, parent_tool_use_id: null })
  await wait(
    () =>
      third.events.some(
        (e) =>
          e.kind === "agent" &&
          e.message.type === "control_request" &&
          e.message.request.subtype === "can_use_tool" &&
          (e.message.request as any).tool_name.includes("fixture"),
      ),
    "MCP permission",
  )
  const mcpPermission = third.events.findLast((e) => e.kind === "agent" && e.message.type === "control_request") as any
  third.send({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: mcpPermission.message.request_id,
      response: { behavior: "allow", updatedInput: mcpPermission.message.request.input },
    },
  })
  await wait(
    () =>
      third.events.some(
        (e) =>
          e.kind === "agent" && e.message.type === "control_request" && e.message.request.subtype === "elicitation",
      ),
    "MCP form request",
  )
  const form = third.events.findLast(
    (e) => e.kind === "agent" && e.message.type === "control_request" && e.message.request.subtype === "elicitation",
  ) as any
  third.send({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: form.message.request_id,
      response: { action: "accept", content: { workspace: "local" } },
    },
  })
  await wait(() => third.results().length === thirdResultBase + 3, "MCP form completed")
  console.log("PASS real stdio MCP form request and accept response complete the tool call")

  const diffRun = connect(crypto.randomUUID())
  await diffRun.initialize()
  diffRun.send({ type: "user", message: { role: "user", content: "GUI_WRITE" }, parent_tool_use_id: null })
  await wait(
    () =>
      diffRun.events.some(
        (e) =>
          e.kind === "agent" &&
          e.message.type === "control_request" &&
          (e.message.request as any).subtype === "can_use_tool",
      ),
    "write permission",
  )
  const writePermission = diffRun.events.findLast(
    (e) => e.kind === "agent" && e.message.type === "control_request",
  ) as any
  diffRun.send({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: writePermission.message.request_id,
      response: { behavior: "allow", updatedInput: writePermission.message.request.input },
    },
  })
  await wait(() => diffRun.events.some((e) => e.kind === "turn-diff"), "turn diff", 30000)
  const turnDiff = diffRun.events.findLast((e) => e.kind === "turn-diff") as Extract<Envelope, { kind: "turn-diff" }>
  assert.ok(
    turnDiff.diff.files.some((file) => file.path === "turn-diff.txt"),
    JSON.stringify(turnDiff.diff),
  )
  assert.ok(turnDiff.diff.additions >= 2, JSON.stringify(turnDiff.diff))
  const sidecars = readdirSync(join(config, "projects")).flatMap((project) =>
    readdirSync(join(config, "projects", project)).filter((file) => file.endsWith(".turn-diffs.jsonl")),
  )
  assert.ok(sidecars.length > 0, "turn diff sidecar missing")
  const live = diffRun.events.filter((e) => e.kind === "turn-diff-live") as Extract<Envelope, { kind: "turn-diff-live" }>[]
  assert.ok(live.some((e) => e.diff.files.some((file) => file.path === "turn-diff.txt")), "live turn diff missing")
  assert.equal(turnDiff.diff.turnIndex, 1, JSON.stringify(turnDiff.diff))
  console.log("PASS a turn's git diff streams live and is persisted")

  diffRun.send({ type: "turn_diff_action", turnIndex: 1, action: "undo" })
  await wait(
    () => diffRun.events.some((e) => e.kind === "turn-diff-action" && e.action === "undo"),
    "undo result",
  )
  const undo = diffRun.events.findLast(
    (e) => e.kind === "turn-diff-action" && e.action === "undo",
  ) as Extract<Envelope, { kind: "turn-diff-action" }>
  assert.ok(undo.result.ok, JSON.stringify(undo.result))
  assert.equal(existsSync(join(cwd, "turn-diff.txt")), false)
  await wait(
    () => diffRun.events.some((e) => e.kind === "turn-diff" && e.diff.reverted === true),
    "reverted turn diff",
  )
  diffRun.send({ type: "turn_diff_action", turnIndex: 1, action: "reapply" })
  await wait(
    () => diffRun.events.some((e) => e.kind === "turn-diff-action" && e.action === "reapply"),
    "reapply result",
  )
  const reapply = diffRun.events.findLast(
    (e) => e.kind === "turn-diff-action" && e.action === "reapply",
  ) as Extract<Envelope, { kind: "turn-diff-action" }>
  assert.ok(reapply.result.ok, JSON.stringify(reapply.result))
  assert.equal(readFileSync(join(cwd, "turn-diff.txt"), "utf8"), "one\ntwo\n")
  console.log("PASS a turn diff can be undone and reapplied")

  const plainRun = connect(crypto.randomUUID(), undefined, plainCwd)
  await plainRun.initialize()
  plainRun.send({ type: "user", message: { role: "user", content: "GUI_WRITE_PLAIN" }, parent_tool_use_id: null })
  await wait(
    () =>
      plainRun.events.some(
        (e) =>
          e.kind === "agent" &&
          e.message.type === "control_request" &&
          (e.message.request as any).subtype === "can_use_tool",
      ),
    "plain write permission",
  )
  const plainPermission = plainRun.events.findLast(
    (e) => e.kind === "agent" && e.message.type === "control_request",
  ) as any
  plainRun.send({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: plainPermission.message.request_id,
      response: { behavior: "allow", updatedInput: plainPermission.message.request.input },
    },
  })
  await wait(() => plainRun.events.some((e) => e.kind === "turn-diff"), "plain turn diff", 30000)
  const plainDiff = plainRun.events.findLast(
    (e) => e.kind === "turn-diff",
  ) as Extract<Envelope, { kind: "turn-diff" }>
  assert.ok(
    plainDiff.diff.files.some((file) => file.path === "turn-diff.txt"),
    JSON.stringify(plainDiff.diff),
  )
  assert.ok(plainDiff.diff.patch?.includes("+one"), JSON.stringify(plainDiff.diff))
  const plainIndex = plainDiff.diff.turnIndex!
  plainRun.send({ type: "turn_diff_action", turnIndex: plainIndex, action: "undo" })
  await wait(
    () => plainRun.events.some((e) => e.kind === "turn-diff-action" && e.action === "undo"),
    "plain undo result",
  )
  const plainUndo = plainRun.events.findLast(
    (e) => e.kind === "turn-diff-action" && e.action === "undo",
  ) as Extract<Envelope, { kind: "turn-diff-action" }>
  assert.equal(plainUndo.result.errorCode, "not-git-repo", JSON.stringify(plainUndo.result))
  assert.equal(readFileSync(join(plainCwd, "turn-diff.txt"), "utf8"), "one\ntwo\n")
  console.log("PASS a non-git turn diff comes from tool results and Undo reports not-git-repo")

  third.send({ type: "user", message: { role: "user", content: "GUI_BACKGROUND" }, parent_tool_use_id: null })
  await wait(
    () =>
      third.events.some(
        (e) =>
          e.kind === "agent" && e.message.type === "control_request" && (e.message.request as any).tool_name === "Bash",
      ),
    "background Bash permission",
  )
  const bashPermission = third.events.findLast((e) => e.kind === "agent" && e.message.type === "control_request") as any
  third.send({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: bashPermission.message.request_id,
      response: { behavior: "allow", updatedInput: bashPermission.message.request.input },
    },
  })
  await wait(
    () =>
      third.events.some(
        (e) => e.kind === "agent" && e.message.type === "system" && e.message.subtype === "task_started",
      ),
    "background task starts",
  )
  await wait(
    () =>
      third.events.some(
        (e) =>
          e.kind === "agent" &&
          e.message.type === "system" &&
          e.message.subtype === "task_notification" &&
          e.message.status === "completed",
      ),
    "background task completes",
  )
  await wait(() => third.results().length >= thirdResultBase + 4, "background turn ends")
  console.log("PASS real background Bash task emits started and completed events")
  await wait(() => {
    const states = third.events.filter(
      (e) => e.kind === "agent" && e.message.type === "system" && e.message.subtype === "session_state_changed",
    )
    return (states.at(-1) as any)?.message.state === "idle"
  }, "background session idle")
  const beforeInterrupt = third.results().length
  third.send({ type: "user", message: { role: "user", content: "GUI_SLOW interrupt" }, parent_tool_use_id: null })
  await wait(() => third.events.filter((e) => e.kind === "user").length === thirdUserBase + 5, "interrupt turn started")
  third.send({
    type: "user",
    message: { role: "user", content: "Keep this queued after stop" },
    parent_tool_use_id: null,
  })
  await wait(() => third.events.some((e) => e.kind === "queue" && e.messages.length === 1), "queued before stop")
  third.send({ type: "control_request", request_id: crypto.randomUUID(), request: { subtype: "interrupt" } })
  await wait(() => third.results().length > beforeInterrupt, "interrupted result")
  await Bun.sleep(100)
  assert.equal(third.events.filter((e) => e.kind === "user").length, thirdUserBase + 5)
  let stopped = initialState
  for (const event of third.events) {
    if (event.kind === "user") stopped = reducer(stopped, { type: "user-sent", id: event.id, content: event.content })
    if (event.kind === "interrupt") stopped = reducer(stopped, { type: "interrupt-requested" })
    if (event.kind === "agent") stopped = reducer(stopped, { type: "agent", message: event.message })
  }
  assert.equal(stopped.result?.interrupted, true)
  assert.equal(stopped.error, undefined, "Stopping is not a GUI error")
  assert.equal(stopped.result?.isError, false)
  assert.ok(stopped.logs.some((line) => line.includes("[ede_diagnostic]")))
  console.log("PASS real CLI interruption terminates the active turn and pauses queued follow-ups")
  const crashRuntime = crypto.randomUUID()
  const crashing = connect(crashRuntime)
  const crashInit = await crashing.initialize()
  crashing.send({ type: "user", message: { role: "user", content: "GUI_SLOW crash" }, parent_tool_use_id: null })
  await wait(() => crashing.events.some((e) => e.kind === "user"), "crash turn started")
  crashing.send({ type: "user", message: { role: "user", content: "queued across crash" }, parent_tool_use_id: null })
  await wait(() => crashing.events.some((e) => e.kind === "queue" && e.messages.length === 1), "queue before crash")
  await wait(
    () => crashing.events.some((e) => e.kind === "agent" && e.message.type === "system" && e.message.subtype === "init"),
    "crash session init",
  )
  const crashSession = crashing.events.find(
    (e) => e.kind === "agent" && e.message.type === "system" && e.message.subtype === "init",
  ) as any
  process.kill(crashInit.pid, "SIGTERM")
  await wait(() => crashing.events.some((e) => e.kind === "exit"), "CLI crash")
  crashing.socket.close()
  const recovered = connect(crashRuntime, crashSession.message.session_id)
  await recovered.initialize()
  const recoveredQueue = recovered.events.filter((e) => e.kind === "queue").at(-1) as Extract<Envelope, { kind: "queue" }> | undefined
  assert.equal(recoveredQueue?.messages[0]?.content, "queued across crash")
  recovered.send({ type: "queue_run" })
  await wait(() => recovered.results().length === 1, "queued turn after crash")
  console.log("PASS unexpected CLI exit retains and resumes queued follow-ups")
  const blank = connect(crypto.randomUUID())
  const blankInit = await blank.initialize()
  blank.socket.close()
  await wait(() => {
    try {
      process.kill(blankInit.pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH"
    }
  }, "empty task process reclaimed")
  console.log("PASS detached empty tasks release their CLI process")
  const commandRun = connect(crypto.randomUUID())
  const commandInit = await commandRun.initialize()
  assert.equal(commandInit.commands.find((c: any) => c.name === "compact")?.type, "local")
  assert.equal(commandInit.commands.find((c: any) => c.name === "init")?.type, "prompt")
  const beforeLocal = calls
  commandRun.send({ type: "user", message: { role: "user", content: "/pause-memory" }, parent_tool_use_id: null })
  await wait(() => commandRun.results().length === 1, "local slash result")
  assert.equal(calls, beforeLocal)
  const commandResult = commandRun.results()[0] as any
  assert.ok(commandResult.message.result.trim())
  let rendered = initialState
  for (const event of commandRun.events) {
    if (event.kind === "user") rendered = reducer(rendered, { type: "user-sent", id: event.id, content: event.content })
    if (event.kind === "agent") rendered = reducer(rendered, { type: "agent", message: event.message })
  }
  assert.ok(JSON.stringify(rendered.turns).includes(commandResult.message.result))
  console.log("PASS native slash command renders its actual result without a model request")
  const restoredCommand = await fetch(`http://127.0.0.1:${port}/api/sessions/${commandResult.message.session_id}?${new URLSearchParams({cwd})}`).then((r) => r.json())
  assert.ok(JSON.stringify(restoredCommand).includes("/pause-memory"), JSON.stringify(restoredCommand))
  assert.ok(JSON.stringify(restoredCommand).includes(commandResult.message.result))
  console.log("PASS native slash input and output restore from the real CLI transcript")
  mkdirSync(join(cwd, ".noa", "skills", "gui-slash"), { recursive: true })
  writeFileSync(
    join(cwd, ".noa", "skills", "gui-slash", "SKILL.md"),
    "---\nname: gui-slash\ndescription: GUI slash fixture\nargument-hint: <instruction>\n---\nGUI_SLASH_SKILL_INSTRUCTIONS: $ARGUMENTS\n",
  )
  const reloadId = crypto.randomUUID()
  commandRun.send({ type: "control_request", request_id: reloadId, request: { subtype: "reload_plugins" } })
  await wait(
    () =>
      commandRun.events.some(
        (e) =>
          e.kind === "agent" && e.message.type === "control_response" && e.message.response.request_id === reloadId,
      ),
    "command reload",
  )
  const reload = commandRun.events.find(
    (e) => e.kind === "agent" && e.message.type === "control_response" && e.message.response.request_id === reloadId,
  ) as any
  assert.equal(reload.message.response.subtype, "success")
  assert.ok(reload.message.response.response.commands.some((c: any) => c.name === "gui-slash" && c.type === "prompt"))
  assert.ok(!reload.message.response.response.commands.some((c: any) => c.type === "local-jsx"))
  console.log("PASS reload refreshes project skills and excludes terminal-only commands")
  commandRun.send({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=",
          },
        },
        { type: "text", text: "/gui-slash custom argument" },
      ],
    },
    parent_tool_use_id: null,
  })
  await wait(() => commandRun.results().length === 2, "skill slash turn")
  assert.ok(sawSkillWithImage)
  assert.deepEqual([...observedModels], ["claude-sonnet-4-6"])
  const cached = connect(crypto.randomUUID(), (commandRun.results()[1] as any).message.session_id)
  const cachedInit = await cached.initialize()
  assert.ok(cachedInit.commands.some((c: any) => c.name === "gui-slash"))
  console.log("PASS slash skills expand through Noa with image input, and refreshed commands survive reconnect")

  const steering = connect(crypto.randomUUID())
  await steering.initialize()
  steering.send({ type: "user", message: { role: "user", content: "GUI_STEER steering" }, parent_tool_use_id: null })
  await wait(() => steering.events.some((e) => e.kind === "user"), "steering active turn")
  steering.send({ type: "user", message: { role: "user", content: "Steer this now" }, parent_tool_use_id: null })
  await wait(
    () => steering.events.some((e) => e.kind === "queue" && e.messages.some((message) => message.content === "Steer this now")),
    "steering queue",
  )
  const steerMessage = steering.events.findLast(
    (e) => e.kind === "queue" && e.messages.some((message) => message.content === "Steer this now"),
  ) as Extract<Envelope, { kind: "queue" }>
  const steerId = steerMessage.messages[0]!.id
  steering.send({ type: "queue_steer", id: steerId })
  await wait(
    () => steering.events.some((e) => e.kind === "user" && e.id === steerId),
    "steering transcript echo",
  )
  assert.equal(steering.events.find((e) => e.kind === "user" && e.id === steerId)?.content, "Steer this now")
  console.log("PASS steering removes the queued message and writes it back into the live transcript")
} finally {
  for (const socket of sockets) socket.close()
  bridge.kill("SIGTERM")
  await bridge.exited
  provider.stop(true)
  rmSync(directory, { recursive: true, force: true })
}
