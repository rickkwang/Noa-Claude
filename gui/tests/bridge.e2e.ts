import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { initialState, reducer } from "../src/agent/reducer"
import type { ControlRequest, Envelope, Outgoing } from "../src/agent/protocol"

const runtimeRoot = resolve(process.argv[2] ?? join(import.meta.dir, "../.."))
const bridgeEntry = existsSync(join(runtimeRoot, "gui/server/main.ts")) ? "server/main.ts" : "server/main.js"
const directory = realpathSync(mkdtempSync(join(tmpdir(), "noa-gui-runtime-")))
const cwd = join(directory, "workspace")
const aliasCwd = join(directory, "workspace-alias")
const plainCwd = join(directory, "plain")
const extraCwd = join(directory, "extra-source")
const config = join(directory, "config")
mkdirSync(cwd)
symlinkSync(cwd, aliasCwd)
mkdirSync(plainCwd)
mkdirSync(extraCwd)
mkdirSync(config)
writeFileSync(join(extraCwd, "shared.txt"), "ADDED_SOURCE_CONTENT\n")
writeFileSync(
  join(config, "settings.json"),
  JSON.stringify({
    model: "claude-sonnet-4-6",
    permissions: { defaultMode: "default" },
    enableAllProjectMcpServers: true,
    hooks: { PreToolUse: [{ matcher: "^NeverMatchesSettingsFixture$", hooks: [{ type: "command", command: "printf CLI_CONFIG_HOOK" }] }] },
  }),
)
writeFileSync(
  join(config, "gui-projects.json"),
  JSON.stringify({ projects: [{ path: cwd, sources: [cwd, extraCwd] }, { path: plainCwd }, { path: aliasCwd }] }),
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
let sawAdditionalSource = false
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
    // The task's AI title request; answered apart from the conversation fixtures.
    if (JSON.stringify(body.system ?? "").includes("sentence-case title"))
      return Response.json({ id: `msg_${crypto.randomUUID()}`, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify({ title: "GUI fixture title" }) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } })
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
    const readAdditional = !hasResult && JSON.stringify(last).includes("GUI_ADD_DIR")
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
    if (JSON.stringify(body.messages).includes("ADDED_SOURCE_CONTENT") && JSON.stringify(body.messages).includes("GUI_ADD_DIR"))
      sawAdditionalSource = true
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
          : readAdditional
            ? {
                type: "tool_use",
                id: `read_${calls}`,
                name: "Read",
                input: { file_path: join(extraCwd, "shared.txt") },
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
const settingsPath = join(config, "settings.json")
writeFileSync(settingsPath, JSON.stringify({
  ...JSON.parse(readFileSync(settingsPath, "utf8")),
  env: { ANTHROPIC_API_KEY: "local-fixture", ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.port}` },
}))
if (process.env.NOA_GUI_BROWSER_FIXTURE === "1") {
  writeFileSync(settingsPath, JSON.stringify({
    ...JSON.parse(readFileSync(settingsPath, "utf8")),
    hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "printf SETTINGS_HOOK" }] }] },
    permissions: {
      defaultMode: "default",
      allow: [...Array.from({ length: 40 }, (_, i) => `WebFetch(domain:settings-probe-${i}.invalid)`), `Bash(echo ${"long-path/".repeat(120)})`],
      deny: ["Read(/settings-private/**)"],
    },
  }))
  const skillDir = join(cwd, ".noa", "skills", "settings-probe")
  mkdirSync(skillDir, { recursive: true })
  const description = "Settings integration fixture. " + "A deliberately long description to verify compact lists and full details. ".repeat(18)
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: settings-probe\ndescription: ${description}\n---\nOnly reply SETTINGS_SKILL.\n`)
}
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const port = reservation.port!
reservation.stop(true)
const bridge = Bun.spawn([process.execPath, "run", bridgeEntry], {
  cwd: join(runtimeRoot, "gui"),
  env: {
    ...process.env,
    NOA_GUI_PORT: String(port),
    NOA_GUI_INSECURE: "1",
    NOA_GUI_TOKEN: "",
    NOA_GUI_DEFAULT_CWD: cwd,
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
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_BASE_URL: "",
    ANTHROPIC_MODEL: "claude-sonnet-4-6",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_TOOL_SEARCH: "false",
  },
  stdout: "pipe",
  stderr: "pipe",
})
const sockets: WebSocket[] = []
const wait = async (predicate: () => boolean | Promise<boolean>, label: string, timeout = 20000) => {
  const deadline = Date.now() + timeout
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await Bun.sleep(25)
  }
}
function connect(runtime: string, resume?: string, workdir = cwd, outputStyle?: string) {
  const events: Envelope[] = []
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/ws?${new URLSearchParams({ cwd: workdir, runtime, ...(resume ? { resume } : {}), ...(outputStyle ? { outputStyle } : {}) })}`,
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
  const request = async (request: ControlRequest) => {
    const requestId = crypto.randomUUID()
    send({ type: "control_request", request_id: requestId, request })
    await wait(() => events.some((event) => event.kind === "agent" && event.message.type === "control_response" && event.message.response.request_id === requestId), request.subtype)
    const event = events.find((event) => event.kind === "agent" && event.message.type === "control_response" && event.message.response.request_id === requestId) as any
    assert.equal(event.message.response.subtype, "success", JSON.stringify(event.message.response))
    return event.message.response.response
  }
  const results = () => events.filter((e) => e.kind === "agent" && e.message.type === "result")
  return { socket, events, send, initialize, request, results }
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
  const settings = await first.request({ subtype: "get_settings" })
  assert.equal(settings.effective.permissions.defaultMode, "default")
  assert.ok(settings.sources.some((source: any) => source.source === "userSettings" && source.settings.permissions?.defaultMode === "default"))
  assert.ok(settings.applied.model)
  assert.ok(settings.hooks.items.some((hook: any) => hook.text === "printf CLI_CONFIG_HOOK" && hook.source === "User"))
  assert.equal(settings.hooks.restricted, false)
  await first.request({ subtype: "apply_flag_settings", settings: { disableAllHooks: true } } as any)
  assert.equal((await first.request({ subtype: "get_settings" })).hooks.restricted, true)
  await first.request({ subtype: "apply_flag_settings", settings: { disableAllHooks: null } } as any)
  assert.equal((await first.request({ subtype: "get_settings" })).hooks.restricted, false)
  await first.request({ subtype: "apply_flag_settings", settings: { outputStyle: "Explanatory" } } as any)
  assert.equal((await first.request({ subtype: "get_settings" })).effective.outputStyle, "Explanatory")
  await first.request({ subtype: "apply_flag_settings", settings: { outputStyle: null } } as any)
  assert.equal((await first.request({ subtype: "get_settings" })).effective.outputStyle, undefined)
  console.log("PASS output style set through flag settings is reported by get_settings and cleared by null")
  const styled = connect(crypto.randomUUID(), undefined, cwd, "Explanatory")
  await styled.initialize()
  assert.equal((await styled.request({ subtype: "get_settings" })).effective.outputStyle, "Explanatory")
  styled.socket.close()
  console.log("PASS a new chat starts with the outputStyle it was opened with")
  assert.ok(init.commands.some((command: any) => command.source === "bundled" && typeof command.rawDescription === "string" && command.description !== command.rawDescription))
  console.log("PASS CLI hook enumeration reports restrictions and command descriptions separate source metadata")

  console.log("PASS settings expose CLI effective values, applied model, and configuration sources")
  await wait(async () => (await first.request({ subtype: "mcp_status" })).mcpServers.some((server: any) => server.name === "fixture" && server.status === "connected"), "MCP settings initial connection")
  await first.request({ subtype: "mcp_toggle", serverName: "fixture", enabled: false })
  assert.equal((await first.request({ subtype: "mcp_status" })).mcpServers.find((server: any) => server.name === "fixture").status, "disabled")
  await first.request({ subtype: "mcp_toggle", serverName: "fixture", enabled: true })
  assert.equal((await first.request({ subtype: "mcp_status" })).mcpServers.find((server: any) => server.name === "fixture").status, "connected")
  await first.request({ subtype: "mcp_reconnect", serverName: "fixture" })
  assert.equal((await first.request({ subtype: "mcp_status" })).mcpServers.find((server: any) => server.name === "fixture").status, "connected")
  console.log("PASS MCP settings disable, enable, and reconnect through the real CLI")

  const rulesBefore = await first.request({ subtype: "configuration", action: "get", kind: "permissions", scope: "local" })
  const rulesSaved = await first.request({ subtype: "configuration", action: "save", kind: "permissions", scope: "local", revision: rulesBefore.revision, value: { allow: ["Read"], ask: ["Bash(git push:*)"], deny: ["Read(.env)"] } })
  assert.deepEqual(rulesSaved.value.allow, ["Read"])
  assert.deepEqual((await first.request({ subtype: "get_settings" })).effective.permissions.deny, ["Read(.env)"])
  await assert.rejects(first.request({ subtype: "configuration", action: "save", kind: "permissions", scope: "local", revision: rulesBefore.revision, value: { allow: [], ask: [], deny: [] } }), /changed outside/)
  await first.request({ subtype: "configuration", action: "save", kind: "permissions", scope: "local", revision: rulesSaved.revision, value: { allow: [], ask: [], deny: [] } })
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).permissions.defaultMode, "default")
  console.log("PASS scoped permission editing applies immediately and rejects stale saves without changing other settings")
  let editableMcp = await first.request({ subtype: "configuration", action: "get", kind: "mcp", scope: "project" })
  const originalMcp = readFileSync(join(cwd, ".noa", "mcp.json"), "utf8")
  editableMcp = await first.request({ subtype: "configuration", action: "save", kind: "mcp", scope: "project", revision: editableMcp.revision, name: "gui_edit", value: { type: "stdio", command: process.execPath, args: [mcpScript], env: { PRESERVED: "${PATH}" } } })
  assert.equal(editableMcp.value.gui_edit.env.PRESERVED, "${PATH}")
  editableMcp = await first.request({ subtype: "configuration", action: "save", kind: "mcp", scope: "project", revision: editableMcp.revision, name: "gui_edit", value: { ...editableMcp.value.gui_edit, args: [mcpScript, "edited"] } })
  assert.equal(editableMcp.value.gui_edit.env.PRESERVED, "${PATH}")
  await assert.rejects(first.request({ subtype: "configuration", action: "save", kind: "mcp", scope: "project", revision: editableMcp.revision, name: "bad", value: { type: "http" } }), /Invalid configuration/)
  editableMcp = await first.request({ subtype: "configuration", action: "remove", kind: "mcp", scope: "project", revision: editableMcp.revision, name: "gui_edit" })
  assert.ok(!editableMcp.value.gui_edit)
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".noa", "mcp.json"), "utf8")), JSON.parse(originalMcp))
  console.log("PASS MCP add, edit and remove use CLI validation and preserve environment references and other servers")

  first.send({ type: "user", message: { role: "user", content: "GUI_SLOW first" }, parent_tool_use_id: null })
  await wait(() => first.events.some((e) => e.kind === "user"), "user acknowledgement")
  assert.ok(!first.events.some(e => e.kind === "queue" && e.messages.some(message => message.content === "GUI_SLOW first")), "An idle send must not appear as queued while its snapshot is prepared")
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
  const acknowledged = second.events.find(event => event.kind === "user") as Extract<Envelope, { kind: "user" }>
  const diskResponse = await fetch(`http://127.0.0.1:${port}/api/sessions/${initMessage.message.session_id}?${new URLSearchParams({ cwd })}`)
  assert.equal(diskResponse.status, 200, "Task history must load from the runtime being tested")
  const diskHistory = await diskResponse.json() as any[]
  assert.ok(diskHistory.some(item => item.kind === "user" && item.id === acknowledged.id), "Live user identity must survive disk restoration")
  const titledId = initMessage.message.session_id as string
  const listedTitle = async () => ((await (await fetch(`http://127.0.0.1:${port}/api/sessions?${new URLSearchParams({ cwd })}`)).json()) as { id: string; title: string }[]).find((s) => s.id === titledId)?.title
  await wait(async () => (await listedTitle()) === "GUI fixture title", "AI title in the task list")
  const titledTranscript = readdirSync(join(config, "projects")).map((dir) => join(config, "projects", dir, `${titledId}.jsonl`)).find((file) => existsSync(file))!
  assert.ok(readFileSync(titledTranscript, "utf8").includes(`"type":"ai-title","aiTitle":"GUI fixture title"`), "The CLI persists the title the terminal resume picker reads")
  assert.ok(![...first.events, ...second.events].some((e) => e.kind === "agent" && e.message.type === "control_response" && JSON.stringify(e.message).includes("GUI fixture title")), "The title response is not relayed to clients")
  console.log("PASS a new task's first prompt names it with an AI title both the GUI and the CLI read")
  second.socket.close()

  // A terminal (another parent process) holding the task: the GUI follows its transcript read-only,
  // then attaches its own CLI once the terminal exits.
  const terminal = Bun.spawn([process.execPath, join(runtimeRoot, "run-noa.js"), "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", "claude-sonnet-4-6", "--resume", titledId], {
    cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: "local-fixture", ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.port}` }, stdin: "pipe", stdout: "ignore", stderr: "ignore",
  })
  const holderPid = () => existsSync(join(config, "sessions")) ? readdirSync(join(config, "sessions")).filter((file) => /^\d+\.json$/.test(file)).map((file) => JSON.parse(readFileSync(join(config, "sessions", file), "utf8"))).find((entry) => entry.sessionId === titledId && entry.pid === terminal.pid)?.pid as number | undefined : undefined
  try {
    await wait(() => holderPid() !== undefined, "terminal holder registered", 30000)
    const follower = connect(crypto.randomUUID(), titledId)
    let closeCode: number | undefined
    follower.socket.addEventListener("close", (event) => { closeCode = event.code })
    await wait(() => follower.events.some((e) => e.kind === "external" && e.pid === terminal.pid), "GUI follows a task a terminal holds", 30000)
    assert.ok(!follower.events.some((e) => e.kind === "agent" && e.message.type === "result"), "Following must not start a second CLI on the task")
    terminal.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "GUI_FROM_TERMINAL" }, parent_tool_use_id: null }) + "\n")
    terminal.stdin.flush()
    await wait(() => follower.events.some((e) => e.kind === "history" && JSON.stringify(e.items).includes("GUI_FROM_TERMINAL") && e.items.some(item => item.kind === "agent" && item.message.type === "assistant")) && JSON.stringify(follower.events.filter(e => e.kind === "history").at(-1)).match(/GUI_REPLY_\d+/) !== null, "terminal turn appears in the GUI", 30000)
    follower.send({ type: "history_before", before: 1 })
    await wait(() => follower.events.some((e) => e.kind === "history" && e.prepend === true), "earlier history pages while following")
    console.log("PASS a GUI view follows a task a terminal process writes, without a second writer")
    terminal.stdin.end()
    terminal.kill()
    await terminal.exited
    await wait(() => closeCode === 4000, "GUI is told the terminal released the task", 30000)
    const takeover = connect(crypto.randomUUID(), titledId)
    await takeover.initialize()
    takeover.send({ type: "user", message: { role: "user", content: "GUI_AFTER_TERMINAL" }, parent_tool_use_id: null })
    await wait(() => takeover.results().length === 1, "GUI continues the released task", 30000)
    takeover.socket.close()
    console.log("PASS once the terminal exits the GUI attaches its own CLI and continues the task")
  } finally {
    terminal.kill()
    await terminal.exited
  }
  const thirdRuntime = crypto.randomUUID()
  const third = connect(thirdRuntime, initMessage.message.session_id)
  await third.initialize()
  // Reopening during finalization reuses the CLI; after settling it is reclaimed.
  // Assert the resulting process is released, not an intermediate PID transition.
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
  const pendingRuns = await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json() as { runtimeId: string; waitingKinds?: string[] }[]
  assert.deepEqual(pendingRuns.find((run) => run.runtimeId === thirdRuntime)?.waitingKinds, ["question"], "A pending AskUserQuestion is reported as a question for desktop notifications")
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
  const addDirResultBase = third.results().length
  third.send({ type: "user", message: { role: "user", content: "GUI_ADD_DIR" }, parent_tool_use_id: null })
  await wait(() => third.results().length === addDirResultBase + 1, "additional source read")
  assert.ok(sawAdditionalSource, "CLI did not receive project source folders as --add-dir")
  console.log("PASS additional project folders are passed to the real CLI as --add-dir")
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

  await wait(async () => {
    const runs = await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json() as { busy: boolean; waiting: boolean }[]
    return runs.every((run) => !run.busy && !run.waiting)
  }, "workspace tasks idle")
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
  assert.ok(diffRun.events.some((event) => event.kind === "turn-diff" && event.diff.turnIndex === 1 && event.updateOnly === true), "Undo/Reapply must identify an update of an existing turn")
  console.log("PASS a turn diff can be undone and reapplied")

  const priorResults = diffRun.results().length
  diffRun.send({ type: "user", message: { role: "user", content: "GUI_SLOW" }, parent_tool_use_id: null })
  await wait(() => diffRun.events.some((e) => e.kind === "user" && e.content === "GUI_SLOW"), "slow turn started")
  const priorActions = diffRun.events.filter((e) => e.kind === "turn-diff-action").length
  diffRun.send({ type: "turn_diff_action", turnIndex: 1, action: "undo" })
  await wait(() => diffRun.events.filter((e) => e.kind === "turn-diff-action").length > priorActions, "busy undo refusal")
  const busyUndo = diffRun.events.findLast((e) => e.kind === "turn-diff-action") as Extract<Envelope, { kind: "turn-diff-action" }>
  assert.equal(busyUndo.result.ok, false, JSON.stringify(busyUndo.result))
  assert.match(busyUndo.result.error ?? "", /running tasks/)
  assert.equal(readFileSync(join(cwd, "turn-diff.txt"), "utf8"), "one\ntwo\n")
  await wait(() => diffRun.results().length > priorResults, "slow turn complete")
  console.log("PASS turn Undo is refused while a task is running")

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
  const crossProject = connect(crypto.randomUUID())
  await crossProject.initialize()
  crossProject.send({ type: "user", message: { role: "user", content: "GUI_SLOW cross-project" }, parent_tool_use_id: null })
  await wait(() => crossProject.events.some((e) => e.kind === "user" && e.content === "GUI_SLOW cross-project"), "other project running")
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
  await wait(() => third.events.filter((e) => e.kind === "user").length === thirdUserBase + 6, "interrupt turn started")
  third.send({
    type: "user",
    message: { role: "user", content: "Keep this queued after stop" },
    parent_tool_use_id: null,
  })
  await wait(() => third.events.some((e) => e.kind === "queue" && e.messages.length === 1), "queued before stop")
  third.send({ type: "control_request", request_id: crypto.randomUUID(), request: { subtype: "interrupt" } })
  await wait(
    async () => (await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json() as { runtimeId: string; interrupted?: boolean }[])
      .find((run) => run.runtimeId === thirdRuntime)?.interrupted === true,
    "stop flagged for notifications",
  )
  await wait(() => third.results().length > beforeInterrupt, "interrupted result")
  await Bun.sleep(100)
  assert.equal(third.events.filter((e) => e.kind === "user").length, thirdUserBase + 6)
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
  const preparing = connect(crypto.randomUUID())
  await preparing.initialize()
  preparing.send({ type: "user", message: { role: "user", content: "GUI_SLOW preparing first" }, parent_tool_use_id: null })
  preparing.send({ type: "user", message: { role: "user", content: "Follow up during snapshot" }, parent_tool_use_id: null, delivery: "steer" })
  await wait(() => preparing.events.some(e => e.kind === "queue" && e.messages.some(message => message.content === "Follow up during snapshot")), "follow-up waits for the first turn to start")
  await wait(() => preparing.results().length === 2, "both preparation-window messages complete")
  assert.deepEqual(preparing.events.filter(e => e.kind === "user").map(e => e.content), ["GUI_SLOW preparing first", "Follow up during snapshot"])
  assert.ok(!preparing.events.some(e => e.kind === "queue" && e.messages.some(message => message.content === "GUI_SLOW preparing first")))
  preparing.socket.close()
  console.log("PASS a steer submitted during snapshot preparation waits without overtaking or queueing the first message")
  const steerDelivery = connect(crypto.randomUUID())
  await steerDelivery.initialize()
  steerDelivery.send({ type: "user", message: { role: "user", content: "GUI_SLOW steer base" }, parent_tool_use_id: null })
  await wait(() => steerDelivery.events.some((e) => e.kind === "user" && e.content === "GUI_SLOW steer base"), "steer base turn started")
  const steerResultBase = steerDelivery.results().length
  steerDelivery.send({ type: "user", message: { role: "user", content: "STEER_FOLLOW_UP" }, parent_tool_use_id: null, delivery: "steer" })
  await wait(() => steerDelivery.events.some((e) => e.kind === "user" && e.content === "STEER_FOLLOW_UP"), "steer delivered")
  assert.ok(!steerDelivery.events.some(e => e.kind === "queue" && e.messages.some(message => message.content === "STEER_FOLLOW_UP")), "Direct steering must not flash in the queue")
  assert.equal(steerDelivery.results().length, steerResultBase, "Steer must land in the running turn, not after it")
  const lastQueue = steerDelivery.events.filter((e) => e.kind === "queue").at(-1) as any
  assert.ok(!lastQueue?.messages.some((m: any) => m.content === "STEER_FOLLOW_UP"), "Steered message must not stay in the queue")
  steerDelivery.socket.close()
  console.log("PASS steer delivery writes a follow-up into the running turn instead of queueing it")
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
  const crashHistory = await fetch(`http://127.0.0.1:${port}/api/sessions/${crashSession.message.session_id}?${new URLSearchParams({ cwd })}`).then(r => r.json())
  assert.ok(crashHistory.some((item: any) => item.kind === "turn-duration" && item.error?.includes("exited")), "Unexpected exit survives history reload")
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
  let runningId: string | undefined
  await wait(async () => {
    const runs = await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json() as { title?: string; sessionId?: string; busy: boolean }[]
    runningId = runs.find((run) => run.title === "GUI_STEER steering" && run.busy)?.sessionId
    return !!runningId
  }, "running task session id")
  for (const path of [cwd, aliasCwd]) {
    const url = `http://127.0.0.1:${port}/api/sessions/${runningId}?${new URLSearchParams({ cwd: path })}`
    assert.equal((await fetch(url, { method: "DELETE" })).status, 409, "Running tasks cannot be deleted through a directory alias")
    assert.equal((await fetch(url)).status, 200)
  }
  console.log("PASS deleting a running task is refused through both its real path and directory alias")
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
  const deleteId = commandResult.message.session_id as string
  const deleteUrl = `http://127.0.0.1:${port}/api/sessions/${deleteId}?${new URLSearchParams({ cwd })}`
  const leftovers = () => readdirSync(join(config, "projects")).flatMap((dir) => readdirSync(join(config, "projects", dir))).filter((name) => name.startsWith(deleteId))
  assert.ok(leftovers().includes(`${deleteId}.jsonl`))
  await wait(async () => !((await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json()) as { sessionId?: string; busy: boolean }[]).some((run) => run.sessionId === deleteId && run.busy), "task idle before delete")
  assert.equal((await fetch(deleteUrl, { method: "DELETE" })).status, 200)
  assert.deepEqual(leftovers(), [])
  assert.equal((await fetch(deleteUrl)).status, 404)
  assert.equal((await fetch(deleteUrl, { method: "DELETE" })).status, 400)
  console.log("PASS deleting a task removes its transcript and files")

  const rewindRun = connect(crypto.randomUUID())
  await rewindRun.initialize()
  rewindRun.send({ type: "user", message: { role: "user", content: "GUI_REWIND_KEEP" }, parent_tool_use_id: null })
  await wait(() => rewindRun.results().length === 1, "rewind first turn")
  rewindRun.send({ type: "user", message: { role: "user", content: "GUI_REWIND_REMOVE" }, parent_tool_use_id: null })
  await wait(() => rewindRun.results().length === 2, "rewind second turn")
  await wait(async () => !(await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json() as any[]).some(run => run.busy), "rewind idle")
  const rewindId = (rewindRun.results()[0] as any).message.session_id
  const removedMessage = rewindRun.events.find(event => event.kind === "user" && event.content === "GUI_REWIND_REMOVE") as Extract<Envelope, { kind: "user" }>
  const forked = await rewindRun.request({ subtype: "session_action", action: "fork" })
  assert.notEqual(forked.sessionId, rewindId)
  const historyUrl = (id: string) => `http://127.0.0.1:${port}/api/sessions/${id}?${new URLSearchParams({ cwd })}`
  assert.ok(JSON.stringify(await (await fetch(historyUrl(forked.sessionId))).json()).includes("GUI_REWIND_REMOVE"))
  console.log("PASS GUI fork creates a separate resumable conversation through the CLI")
  const otherFork = await rewindRun.request({ subtype: "session_action", action: "fork" })
  const forkResume = connect(crypto.randomUUID(), otherFork.sessionId)
  await forkResume.initialize()
  await forkResume.request({ subtype: "session_action", action: "rewind", user_message_id: removedMessage.id, mode: "conversation" })
  assert.ok(!JSON.stringify(await (await fetch(historyUrl(otherFork.sessionId))).json()).includes("GUI_REWIND_REMOVE"))
  forkResume.socket.close()
  console.log("PASS a resumed fork rewinds durably before sending its first new prompt")

  await assert.rejects(rewindRun.request({ subtype: "session_action", action: "rewind", user_message_id: crypto.randomUUID(), mode: "conversation" }), /no longer in the active context/)
  const preview = await rewindRun.request({ subtype: "session_action", action: "rewind", user_message_id: removedMessage.id, mode: "conversation", dry_run: true })
  assert.ok(preview.turnsRemoved >= 1)
  assert.ok(JSON.stringify(await (await fetch(historyUrl(rewindId))).json()).includes("GUI_REWIND_REMOVE"))
  await rewindRun.request({ subtype: "session_action", action: "rewind", user_message_id: removedMessage.id, mode: "conversation" })
  const rewoundHistory = await (await fetch(historyUrl(rewindId))).json()
  assert.ok(JSON.stringify(rewoundHistory).includes("GUI_REWIND_KEEP"))
  assert.ok(!JSON.stringify(rewoundHistory).includes("GUI_REWIND_REMOVE"), JSON.stringify(rewoundHistory))
  assert.ok(JSON.stringify(await (await fetch(historyUrl(forked.sessionId))).json()).includes("GUI_REWIND_REMOVE"))
  const rawRewindFile = readdirSync(join(config, "projects")).map(dir => join(config, "projects", dir, `${rewindId}.jsonl`)).find(file => existsSync(file))!
  assert.ok(readFileSync(rawRewindFile, "utf8").includes("GUI_REWIND_REMOVE"), "Rewind preserves original records on disk")
  rewindRun.socket.close()
  await Bun.sleep(100)
  const rewindResume = connect(crypto.randomUUID(), rewindId)
  await rewindResume.initialize()
  assert.ok(!JSON.stringify(rewindResume.events.filter(event => event.kind === "history")).includes("GUI_REWIND_REMOVE"))
  rewindResume.send({ type: "user", message: { role: "user", content: "GUI_REWIND_CONTINUE" }, parent_tool_use_id: null })
  await wait(() => rewindResume.results().length === 1, "rewind continuation")
  assert.ok(!JSON.stringify(await (await fetch(historyUrl(rewindId))).json()).includes("GUI_REWIND_REMOVE"))
  console.log("PASS conversation rewind previews safely, survives fresh CLI resume, preserves the fork and continues without removed history")
  await wait(async () => !(await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json() as any[]).some(run => run.busy), "all turns finalized before restoring files")
  await Bun.sleep(100)
  const writeUser = diffRun.events.find(event => event.kind === "user" && event.content === "GUI_WRITE") as Extract<Envelope, { kind: "user" }>
  const filesPreview = await diffRun.request({ subtype: "session_action", action: "rewind", user_message_id: writeUser.id, mode: "files", dry_run: true })
  assert.ok(filesPreview.filesChanged.some((file: string) => file.endsWith("turn-diff.txt")), JSON.stringify(filesPreview))
  assert.ok(existsSync(join(cwd, "turn-diff.txt")))
  rmSync(join(cwd, "turn-diff.txt"))
  mkdirSync(join(cwd, "turn-diff.txt"))
  await assert.rejects(diffRun.request({ subtype: "session_action", action: "rewind", user_message_id: writeUser.id, mode: "both" }), /Could not restore/)
  assert.ok(!diffRun.events.some(event => event.kind === "history" && !JSON.stringify(event).includes("GUI_WRITE")), "Failed file restoration must not trim conversation")
  rmSync(join(cwd, "turn-diff.txt"), { recursive: true })
  writeFileSync(join(cwd, "turn-diff.txt"), "one\ntwo\n")
  await diffRun.request({ subtype: "session_action", action: "rewind", user_message_id: writeUser.id, mode: "files" })
  assert.ok(!existsSync(join(cwd, "turn-diff.txt")))
  const filesOnlyHistory = diffRun.events.filter(event => event.kind === "history").at(-1) as any
  assert.ok(JSON.stringify(filesOnlyHistory).includes("GUI_WRITE"))
  await diffRun.request({ subtype: "session_action", action: "rewind", user_message_id: writeUser.id, mode: "both" })
  const bothHistory = diffRun.events.filter(event => event.kind === "history").at(-1) as any
  assert.ok(!JSON.stringify(bothHistory).includes("GUI_WRITE"), JSON.stringify(bothHistory))
  console.log("PASS file-only rewind restores the checkpoint without removing chat, and combined rewind restores files and conversation")
  const clearedId = (diffRun.results()[0] as any).message.session_id
  diffRun.socket.close()
  await Bun.sleep(100)
  const clearedResume = connect(crypto.randomUUID(), clearedId)
  await clearedResume.initialize()
  clearedResume.send({ type: "user", message: { role: "user", content: "GUI_AFTER_FULL_REWIND" }, parent_tool_use_id: null })
  await wait(() => clearedResume.results().length === 1, "continued after full rewind")
  console.log("PASS a fully rewound conversation resumes and accepts a new prompt")
  const currentUser = clearedResume.events.find(event => event.kind === "user") as Extract<Envelope, { kind: "user" }>
  await wait(async () => !(await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json() as any[]).some(run => run.busy), "idle before protocol validation")
  for (const request of [
    { subtype: "session_action", action: "rewind", user_message_id: currentUser.id, mode: "conversation_only", dry_run: true },
    { subtype: "session_action", action: "typo", user_message_id: currentUser.id, mode: "conversation", dry_run: true },
    { subtype: "configuration", kind: "mcp", scope: "bogus", action: "get" },
    { subtype: "configuration", kind: "bogus", scope: "project", action: "get" },
    { subtype: "configuration", kind: "mcp", scope: "project", action: "typo" },
  ]) await assert.rejects(clearedResume.request(request as any), /Invalid option/)
  console.log("PASS invalid session and configuration controls are rejected before mutation")

  const sessionToRestart = (clearedResume.results()[0] as any).message.session_id
  const observer = connect(crypto.randomUUID(), sessionToRestart)
  const beforeRestart = await observer.initialize()
  const mcpBeforeRestart = await observer.request({ subtype: "configuration", action: "get", kind: "mcp", scope: "local" })
  await observer.request({ subtype: "configuration", action: "save", kind: "mcp", scope: "local", revision: mcpBeforeRestart.revision, name: "gui_restart", value: { type: "stdio", command: process.execPath, args: [mcpScript] } })
  const restart = (sessionId?: string, runtimeId = crypto.randomUUID()) => fetch(`http://127.0.0.1:${port}/api/restart?${new URLSearchParams({ cwd })}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runtimeId, sessionId }) })
  assert.equal((await restart(sessionToRestart)).status, 200)
  await wait(() => observer.socket.readyState === WebSocket.CLOSED && clearedResume.socket.readyState === WebSocket.CLOSED, "all old clients disconnected")
  const replacement = connect(crypto.randomUUID(), sessionToRestart)
  const afterRestart = await replacement.initialize()
  assert.notEqual(afterRestart.pid, beforeRestart.pid)
  assert.ok((await replacement.request({ subtype: "mcp_status" })).mcpServers.some((server: any) => server.name === "gui_restart"))
  console.log("PASS explicit reconnect replaces the CLI even with multiple attached clients and loads saved MCP configuration")
  replacement.send({ type: "user", message: { role: "user", content: "GUI_SLOW restart refusal" }, parent_tool_use_id: null })
  await wait(() => replacement.events.some(event => event.kind === "user" && event.content === "GUI_SLOW restart refusal"), "restart refusal running turn")
  replacement.send({ type: "user", message: { role: "user", content: "GUI_RESTART_QUEUED" }, parent_tool_use_id: null })
  await wait(() => replacement.events.some(event => event.kind === "queue" && event.messages.some(message => message.content === "GUI_RESTART_QUEUED")), "restart refusal queue")
  assert.equal((await restart(sessionToRestart)).status, 409)
  assert.equal(replacement.socket.readyState, WebSocket.OPEN)
  process.kill(afterRestart.pid, 0)
  console.log("PASS reconnect refuses running and queued work without killing the CLI or losing messages")
  const emptyRuntime = crypto.randomUUID()
  const emptyReconnect = connect(emptyRuntime)
  const emptyBefore = await emptyReconnect.initialize()
  assert.equal((await restart(undefined, emptyRuntime)).status, 200)
  const emptyReplacement = connect(crypto.randomUUID())
  assert.notEqual((await emptyReplacement.initialize()).pid, emptyBefore.pid)
  console.log("PASS a new empty task reconnects before a session id exists")


} finally {
  for (const socket of sockets) socket.close()
  bridge.kill("SIGTERM")
  await bridge.exited
  provider.stop(true)
  rmSync(directory, { recursive: true, force: true })
}
