// The project coordinator against the real CLI and a scripted provider: it starts a thread, hears back
// when the thread finishes or waits for approval, answers from the thread list, and routes a follow-up.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Envelope, Outgoing } from "../src/agent/protocol"

const runtimeRoot = resolve(process.argv[2] ?? join(import.meta.dir, "../.."))
const bridgeEntry = existsSync(join(runtimeRoot, "gui/server/main.ts")) ? "server/main.ts" : "server/main.js"
const directory = realpathSync(mkdtempSync(join(tmpdir(), "noa-gui-coordinator-")))
const cwd = join(directory, "workspace")
const config = join(directory, "config")
mkdirSync(cwd)
mkdirSync(config)
writeFileSync(join(cwd, "seed.txt"), "seed\n")
for (const args of [["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"], ["add", "-A"], ["commit", "-qm", "init"]])
  Bun.spawnSync(["git", "-C", cwd, ...args])
writeFileSync(join(config, "gui-projects.json"), JSON.stringify({ projects: [{ path: cwd }] }))

// Requests seen by the provider, split by who sent them.
const coordinatorTurns: string[] = []
const threadTurns: string[] = []
let calls = 0
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method !== "POST") return Response.json({})
    const body = (await request.json()) as any
    if (request.url.includes("count_tokens")) return Response.json({ input_tokens: 100 })
    if (!request.url.includes("messages")) return Response.json({})
    const system = JSON.stringify(body.system ?? "")
    const reply = (block: any) => {
      const message = { id: `msg_${crypto.randomUUID()}`, type: "message", role: "assistant", model: body.model, content: [block], stop_reason: block.type === "text" ? "end_turn" : "tool_use", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }
      if (!body.stream) return Response.json(message)
      const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
      return new Response(
        event("message_start", { message: { ...message, content: [], stop_reason: null } }) +
          event("content_block_start", { index: 0, content_block: block.type === "text" ? { type: "text", text: "" } : { ...block, input: {} } }) +
          event("content_block_delta", { index: 0, delta: block.type === "text" ? { type: "text_delta", text: block.text } : { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }) +
          event("content_block_stop", { index: 0 }) +
          event("message_delta", { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } }) +
          event("message_stop", {}),
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    if (system.includes("sentence-case title")) {
      const prompt = JSON.stringify(body.messages)
      const titles: [string, string][] = [["THREAD_TASK_B", "Approval thread"], ["THREAD_FAIL", "Failing thread"], ["THREAD_CRASH", "Crashing thread"], ["THREAD_STOP", "Stoppable thread"], ["THREAD_TASK_WT", "Worktree thread"], ["THREAD_SLOW", "Slow thread"]]
      return reply({ type: "text", text: JSON.stringify({ title: titles.find(([marker]) => prompt.includes(marker))?.[1] ?? "Fixture thread" }) })
    }
    calls++
    const last = body.messages?.at(-1)?.content
    const lastText = JSON.stringify(last)
    const hasResult = Array.isArray(last) && last.some((b: any) => b.type === "tool_result")
    const tool = (name: string, input: object) => ({ type: "tool_use", id: `tool_${calls}`, name: body.tools?.find((t: any) => t.name.endsWith(`__${name}`))?.name ?? name, input })
    if (system.includes("# Project coordinator")) {
      coordinatorTurns.push(lastText)
      if (hasResult) return reply({ type: "text", text: lastText.includes("Slow work finished") ? "RESUMED_TOOLS_OK" : "COORD_ACK" })
      // A coordinator resumed without a window must still have its session tools.
      if (lastText.includes("project-activity") && lastText.includes("Slow work finished")) return reply(tool("list_sessions", {}))
      if (lastText.includes("project-activity")) return reply({ type: "text", text: `STATUS_UPDATE ${lastText.includes("needs input") ? "waiting" : lastText.includes("· failed") ? "failed" : "done"}` })
      if (lastText.includes("COORD_FAIL")) return reply(tool("start_session", { prompt: "THREAD_FAIL break" }))
      if (lastText.includes("COORD_CRASH")) return reply(tool("start_session", { prompt: "THREAD_CRASH hang" }))
      if (lastText.includes("COORD_STOP_START")) return reply(tool("start_session", { prompt: "THREAD_STOP long work" }))
      const stop = lastText.match(/COORD_STOP ([0-9a-f-]{36})/)
      if (stop) return reply(tool("stop_session", { session_id: stop[1] }))
      if (lastText.includes("COORD_WT")) return reply(tool("start_session", { prompt: "THREAD_TASK_WT edit in isolation", worktree: true }))
      if (lastText.includes("COORD_SLOW")) return reply(tool("start_session", { prompt: "THREAD_SLOW take a while" }))
      if (lastText.includes("COORD_START_B")) return reply(tool("start_session", { prompt: "THREAD_TASK_B run a command" }))
      if (lastText.includes("COORD_START")) return reply(tool("start_session", { prompt: "THREAD_TASK_A do the work" }))
      if (lastText.includes("COORD_STATUS")) return reply(tool("list_sessions", {}))
      const follow = lastText.match(/COORD_FOLLOW ([0-9a-f-]{36})/)
      if (follow) return reply(tool("send_message", { session_id: follow[1], message: "THREAD_FOLLOW add tests" }))
      return reply({ type: "text", text: "COORD_REPLY" })
    }
    threadTurns.push(lastText)
    if (lastText.includes("THREAD_FAIL")) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "FIXTURE_FAILURE" } }, { status: 400 })
    if (lastText.includes("THREAD_CRASH") || lastText.includes("THREAD_STOP")) await Bun.sleep(20000)
    if (lastText.includes("THREAD_SLOW")) {
      await Bun.sleep(6000)
      return reply({ type: "text", text: "Slow work finished" })
    }
    if (lastText.includes("THREAD_TASK_B") && !hasResult) return reply(tool("Bash", { command: "printf GATED", description: "Gated command" }))
    return reply({ type: "text", text: lastText.includes("THREAD_FOLLOW") ? "THREAD_FOLLOW_DONE" : "Finished the fixture work" })
  },
})
writeFileSync(join(config, "settings.json"), JSON.stringify({
  model: "claude-sonnet-4-6",
  permissions: { defaultMode: "default" },
  env: { ANTHROPIC_API_KEY: "local-fixture", ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.port}` },
}))

const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const port = reservation.port!
reservation.stop(true)
const blank = Object.fromEntries(["CLAUDE_CODE_USE_OPENAI", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "NOA_CLAUDE_OPENAI_AUTH", "OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL", "NOA_CLAUDE_PROVIDER_MODELS", "NOA_CLAUDE_PROVIDER_CONTEXT_WINDOWS", "NOA_CLAUDE_PROVIDER_EFFORT_LEVELS", "NOA_CLAUDE_PROVIDER_MAX_OUTPUT_TOKENS", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "NOA_GUI_TOKEN"].map((key) => [key, ""]))
const bridge = Bun.spawn([process.execPath, "run", bridgeEntry], {
  cwd: join(runtimeRoot, "gui"),
  env: {
    ...process.env,
    ...blank,
    NOA_GUI_PORT: String(port),
    NOA_GUI_INSECURE: "1",
    NOA_GUI_DEFAULT_CWD: cwd,
    CLAUDE_CONFIG_DIR: join(directory, "unused-config"),
    CLAUDE_CODE_PRODUCT_DIR: config,
    CLAUDE_CODE_CACHE_DIR: join(directory, "cache"),
    ANTHROPIC_MODEL: "claude-sonnet-4-6",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_TOOL_SEARCH: "false",
  },
  stdout: "pipe",
  stderr: "pipe",
})
const api = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ cwd })}`, init).then((r) => r.json() as Promise<any>)
const wait = async (predicate: () => boolean | Promise<boolean>, label: string, timeout = 30000) => {
  const deadline = Date.now() + timeout
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await Bun.sleep(50)
  }
}
const sockets: WebSocket[] = []
try {
  await wait(async () => fetch(`http://127.0.0.1:${port}/api/info`).then(() => true, () => false), "bridge up")

  const { sessionId: coordinator } = await api("/api/coordinator", { method: "POST" })
  assert.equal((await api("/api/coordinator", { method: "POST" })).sessionId, coordinator, "a project keeps one coordinator")

  const events: Envelope[] = []
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?${new URLSearchParams({ cwd, runtime: crypto.randomUUID(), resume: coordinator })}`)
  sockets.push(socket)
  socket.onmessage = (event) => events.push(JSON.parse(String(event.data)))
  const send = (message: Outgoing) => socket.send(JSON.stringify(message))
  await wait(() => socket.readyState === WebSocket.OPEN, "socket open")
  send({ type: "control_request", request_id: "init", request: { subtype: "initialize" } })
  await wait(() => events.some((e) => e.kind === "agent" && e.message.type === "control_response" && e.message.response.request_id === "init"), "initialize")
  const say = (text: string) => send({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null })
  const replies = () => events.flatMap((e) => e.kind === "agent" && e.message.type === "assistant" ? e.message.message.content.flatMap((b) => b.type === "text" ? [b.text] : []) : [])

  say("COORD_START")
  await wait(() => threadTurns.some((t) => t.includes("THREAD_TASK_A")), "thread A started")
  const sessions = await api("/api/sessions")
  const coordinatorRow = sessions.find((s: any) => s.id === coordinator)
  assert.deepEqual([coordinatorRow?.title, coordinatorRow?.coordinator], ["Coordinator", true])
  await wait(() => replies().some((t) => t.startsWith("STATUS_UPDATE done")), "status update after the thread finished")
  const relay = coordinatorTurns.find((t) => t.includes("project-activity"))!
  assert.match(relay, /Fixture thread/)
  assert.match(relay, /Finished the fixture work/)
  assert.match(relay, /untrusted/)
  console.log("PASS the coordinator starts a thread and posts an update when it finishes")

  const thread = (await api("/api/sessions")).find((s: any) => s.title === "Fixture thread")
  assert.ok(thread, "the thread is listed with the project")

  say("COORD_STATUS")
  await wait(() => coordinatorTurns.some((t) => t.includes("tool_result") && t.includes("Fixture thread") && t.includes("done")), "list_sessions result")
  console.log("PASS asked for status, the coordinator reads the thread list")

  say(`COORD_FOLLOW ${thread.id}`)
  await wait(() => threadTurns.some((t) => t.includes("THREAD_FOLLOW")), "follow-up delivered")
  const routed = threadTurns.find((t) => t.includes("THREAD_FOLLOW"))!
  assert.match(routed, /project-session-instructions from-session=/)
  assert.match(routed, /coordinator-context nonce=/)
  await wait(() => replies().filter((t) => t.startsWith("STATUS_UPDATE done")).length >= 2, "update after the follow-up")
  console.log("PASS a follow-up reaches the thread framed as coordinator context, and its result is relayed")

  say("COORD_START_B")
  await wait(() => replies().some((t) => t.startsWith("STATUS_UPDATE waiting")), "update while a thread waits for approval", 40000)
  const runs = await fetch(`http://127.0.0.1:${port}/api/runs`).then((r) => r.json() as Promise<any[]>)
  assert.ok(runs.some((r) => r.waiting && r.sessionId !== coordinator), "the thread still waits for approval with no window open")
  console.log("PASS a thread waiting for approval without a window is relayed as needing input")

  const threadId = async (title: string) => {
    let id: string | undefined
    await wait(async () => !!(id = (await api("/api/sessions")).find((s: any) => s.title === title)?.id), `${title} listed`)
    return id!
  }
  const relayed = (title: string, status: string) => coordinatorTurns.some((t) => t.includes("project-activity") && t.includes(title) && t.includes(`· ${status}`))

  say("COORD_FAIL")
  await wait(() => relayed("Failing thread", "failed"), "failure relayed")
  await wait(() => replies().some((t) => t.startsWith("STATUS_UPDATE failed")), "update about the failure")
  console.log("PASS a failed thread is relayed as failed")

  say("COORD_CRASH")
  const crashing = await threadId("Crashing thread")
  await wait(() => threadTurns.some((t) => t.includes("THREAD_CRASH")), "crashing thread running")
  Bun.spawnSync(["pkill", "-f", crashing])
  await wait(() => relayed("Crashing thread", "failed"), "crash relayed")
  console.log("PASS a thread whose agent exits mid-turn is relayed as failed")

  say("COORD_STOP_START")
  const stoppable = await threadId("Stoppable thread")
  await wait(() => threadTurns.some((t) => t.includes("THREAD_STOP")), "stoppable thread running")
  // Opening a thread while it runs without a window attaches to that run.
  const viewer: Envelope[] = []
  const view = new WebSocket(`ws://127.0.0.1:${port}/ws?${new URLSearchParams({ cwd, runtime: crypto.randomUUID(), resume: stoppable })}`)
  sockets.push(view)
  view.onmessage = (event) => viewer.push(JSON.parse(String(event.data)))
  await wait(() => view.readyState === WebSocket.OPEN, "viewer open")
  view.send(JSON.stringify({ type: "control_request", request_id: "view-init", request: { subtype: "initialize" } }))
  await wait(() => viewer.some((e) => e.kind === "agent" && e.message.type === "control_response" && e.message.response.request_id === "view-init"), "viewer initialized")
  const viewInit = viewer.find((e) => e.kind === "agent" && e.message.type === "control_response" && e.message.response.request_id === "view-init") as any
  assert.equal(viewInit.message.response.subtype, "success", JSON.stringify(viewInit.message.response))
  assert.ok(viewer.some((e) => e.kind === "user" && JSON.stringify(e.content).includes("THREAD_STOP")), "the viewer sees the running turn's prompt")
  console.log("PASS opening a thread that runs without a window attaches to its running turn")
  say(`COORD_STOP ${stoppable}`)
  await wait(() => coordinatorTurns.some((t) => t.includes("tool_result") && t.includes("Stopped \\\"Stoppable thread\\\"")), "stop_session result")
  await wait(async () => !(await fetch(`http://127.0.0.1:${port}/api/runs`).then((r) => r.json() as Promise<any[]>)).some((r) => r.sessionId === stoppable && r.busy), "thread stopped")
  console.log("PASS stop_session interrupts a running thread")

  say("COORD_WT")
  await wait(() => threadTurns.some((t) => t.includes("THREAD_TASK_WT")), "worktree thread started")
  let worktreeThread: any
  await wait(async () => !!(worktreeThread = (await api("/api/sessions")).find((s: any) => s.title === "Worktree thread")), "worktree thread listed")
  assert.ok(worktreeThread.cwd?.startsWith(join(config, "worktrees")), `worktree thread runs in a managed worktree: ${worktreeThread.cwd}`)
  console.log("PASS start_session with worktree runs the thread in a new worktree listed with the project")

  say("COORD_SLOW")
  await wait(() => threadTurns.some((t) => t.includes("THREAD_SLOW")), "slow thread started")
  await wait(() => replies().filter((t) => t === "COORD_ACK").length > 0 && coordinatorTurns.at(-1)!.includes("Started thread"), "coordinator answered the start")
  socket.close()
  await wait(async () => !(await fetch(`http://127.0.0.1:${port}/api/runs`).then((r) => r.json() as Promise<any[]>)).some((r) => r.sessionId === coordinator), "coordinator released after the window closed")
  await wait(() => coordinatorTurns.some((t) => t.includes("tool_result") && t.includes("Slow work finished")), "resumed coordinator used its tools", 40000)
  console.log("PASS with its window closed, the coordinator resumes on a relay and still has its session tools")
} catch (error) {
  bridge.kill("SIGTERM")
  console.error(await new Response(bridge.stderr).text().catch(() => ""))
  throw error
} finally {
  for (const socket of sockets) socket.close()
  bridge.kill("SIGTERM")
  await bridge.exited
  provider.stop(true)
  rmSync(directory, { recursive: true, force: true })
}
