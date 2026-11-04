// Drives the bridge's /terminal socket the way the terminal panel does: create, type, resize, reattach, close.
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = await mkdtemp(join(tmpdir(), "noa-gui-terminal-"))
const config = await mkdtemp(join(tmpdir(), "noa-gui-terminal-config-"))
const outside = await mkdtemp(join(tmpdir(), "noa-gui-terminal-outside-"))
const token = crypto.randomUUID()

async function freePort() {
  const reservation = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const port = reservation.port!
  await reservation.stop(true)
  return port
}

async function startBridge(env: Record<string, string>) {
  const port = await freePort()
  const proc = Bun.spawn([process.execPath, "run", "server/main.ts"], {
    cwd: resolve(import.meta.dir, ".."),
    // A plain shell keeps prompts predictable; the bridge must still strip its own token from the child.
    env: { ...process.env, SHELL: "/bin/sh", PS1: "$ ", NOA_GUI_PORT: String(port), CLAUDE_CONFIG_DIR: config, ...env },
    stdout: "ignore",
    stderr: "inherit",
  })
  const origin = `http://127.0.0.1:${port}`
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(`${origin}/api/info`, { headers: { authorization: `Bearer ${token}` } })
      break
    } catch {
      if (attempt === 100) throw new Error("Bridge startup timed out")
      await Bun.sleep(50)
    }
  }
  return { proc, origin }
}

type Message = { type: string; data?: string; buffer?: string; code?: number; message?: string }

class Client {
  readonly messages: Message[] = []
  output = ""
  closed?: number
  private constructor(readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as Message
      this.messages.push(message)
      if (message.type === "data") this.output += message.data
    }
    socket.onclose = (event) => { this.closed = event.code }
  }
  static async open(origin: string, cwd: string, id: string, cols = 80, rows = 24) {
    const url = `${origin.replace("http", "ws")}/terminal?${new URLSearchParams({ cwd, id, cols: String(cols), rows: String(rows) })}`
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } } as unknown as string[])
    const client = new Client(socket)
    await client.until(() => client.messages.some((m) => m.type === "attached"), "attached")
    return client
  }
  send(message: unknown) { this.socket.send(JSON.stringify(message)) }
  type(text: string) { this.send({ type: "input", data: text }) }
  async until(done: () => boolean, label: string, timeout = 10_000) {
    const start = Date.now()
    while (!done()) {
      if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}; output: ${JSON.stringify(this.output.slice(-400))}`)
      await Bun.sleep(25)
    }
  }
  attached() { return this.messages.findLast((m) => m.type === "attached")! }
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true } catch { return false }
}

let passed = 0
function check(name: string) {
  passed++
  console.log(`PASS ${name}`)
}

// An app launched from an agent session carries that session's variables; the user's own toggles stay.
const secure = await startBridge({ NOA_GUI_TOKEN: token, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "parent-session", CLAUDE_CODE_USE_BEDROCK: "kept" })
const insecure = await startBridge({ NOA_GUI_INSECURE: "1" })
try {
  const added = await fetch(`${secure.origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: root, sources: [root] }),
  })
  assert.equal(added.status, 200)

  const refused = new WebSocket(`${insecure.origin.replace("http", "ws")}/terminal?${new URLSearchParams({ cwd: root, id: crypto.randomUUID() })}`)
  const refusal = await new Promise<{ message: Message; code: number }>((done, fail) => {
    let message: Message | undefined
    refused.onmessage = (event) => { message = JSON.parse(String(event.data)) }
    refused.onclose = (event) => message ? done({ message, code: event.code }) : fail(new Error(`closed ${event.code} without a reason`))
  })
  assert.equal(refusal.message.type, "error")
  assert.match(refusal.message.message ?? "", /NOA_GUI_TOKEN/)
  assert.equal(refusal.code, 4003)
  check("a bridge without a token refuses to open shells and says why")

  const unlisted = await fetch(`${secure.origin}/terminal?${new URLSearchParams({ cwd: outside, id: crypto.randomUUID() })}`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(unlisted.status, 403)
  const anonymous = await fetch(`${secure.origin}/terminal?${new URLSearchParams({ cwd: root, id: crypto.randomUUID() })}`)
  assert.equal(anonymous.status, 401)
  check("shells open only in listed projects and only with the token")

  const id = crypto.randomUUID()
  const first = await Client.open(secure.origin, root, id, 100, 30)
  first.type("echo cwd=$(pwd) term=$TERM program=$TERM_PROGRAM color=$COLORTERM token=${NOA_GUI_TOKEN:-none} session=${CLAUDECODE:-none}/${CLAUDE_CODE_SESSION_ID:-none} toggle=$CLAUDE_CODE_USE_BEDROCK; stty size\n")
  await first.until(() => /cwd=.* token=\w+/.test(first.output) && /\b30 100\b/.test(first.output), "environment line")
  assert.match(first.output, new RegExp(`cwd=(/private)?${root}`))
  assert.match(first.output, /term=xterm-256color program=noa color=truecolor token=none session=none\/none toggle=kept/)
  check("the shell starts in the project with terminal variables, without the bridge token or an inherited agent session")

  first.send({ type: "resize", cols: 132, rows: 40 })
  first.type("stty size\n")
  await first.until(() => /\b40 132\b/.test(first.output), "resized stty")
  check("resize reaches the PTY")

  // A device-status query in the output must not be replayed: the panel would answer it as typed input.
  first.type("printf 'replay-\\033[6nmarker\\n'\n")
  await first.until(() => first.output.includes("marker"), "replay marker")
  first.socket.close()
  await first.until(() => first.closed !== undefined, "first socket close")
  const second = await Client.open(secure.origin, root, id)
  const replay = second.attached().buffer ?? ""
  assert.ok(replay.includes("replay-marker"), replay.slice(-200))
  assert.ok(!replay.includes("\x1b[6n"))
  check("reattaching replays recent output without terminal queries")

  // A full-screen program started early: the whole stream replays as it came, so the shell output before it
  // stays on the main screen it was written to.
  const earlyId = crypto.randomUUID()
  const early = await Client.open(secure.origin, root, earlyId)
  early.type("printf 'pre''marker\\n\\033[?1049hinside\\n'\n")
  await early.until(() => early.output.includes("premarker") && early.output.includes("\x1b[?1049h"), "early full-screen output")
  early.socket.close()
  await early.until(() => early.closed !== undefined, "early socket close")
  const earlyBack = await Client.open(secure.origin, root, earlyId)
  const earlyReplay = earlyBack.attached().buffer ?? ""
  assert.ok(!earlyReplay.startsWith("\x1b[?"), JSON.stringify(earlyReplay.slice(0, 40)))
  assert.ok(earlyReplay.indexOf("premarker") < earlyReplay.indexOf("\x1b[?1049h"), JSON.stringify(earlyReplay.slice(-120)))
  earlyBack.send({ type: "close" })
  check("reattaching early in a shell replays its output in order, without a mode preamble")

  // A full-screen program whose mode switch has scrolled out of the replay buffer.
  const fullId = crypto.randomUUID()
  const full = await Client.open(secure.origin, root, fullId, 80, 24)
  await Bun.write(join(root, "fullscreen.sh"), [
    `trap 'printf "redrawn\\n"' WINCH`,
    `printf '\\033[?1049h\\033[?2004h'`,
    `i=0; while [ $i -lt 400 ]; do printf '%050d\\n' $i; i=$((i+1)); done`,
    `echo filldone`,
    `while :; do sleep 0.1; done`,
  ].join("\n"))
  full.type("sh fullscreen.sh\n")
  await full.until(() => full.output.includes("filldone"), "full-screen fill", 20_000)
  full.socket.close()
  await full.until(() => full.closed !== undefined, "full-screen socket close")
  const back = await Client.open(secure.origin, root, fullId, 80, 24)
  const restored = back.attached().buffer ?? ""
  assert.ok(restored.startsWith("\x1b[?1049h") && restored.includes("\x1b[?2004h"), JSON.stringify(restored.slice(0, 80)))
  await back.until(() => back.output.includes("redrawn"), "redraw after reattach")
  back.send({ type: "close" })
  check("reattaching to a full-screen program restores its modes and makes it redraw")

  const third = await Client.open(secure.origin, root, id)
  await second.until(() => second.closed !== undefined, "displaced socket close")
  assert.equal(second.closed, 4002)
  check("a second attach takes the shell over from the first")

  // Interactive bash (macOS /bin/sh) expands "!" from history, before a same-line `set +H` applies.
  third.type("set +H\nsleep 600 & echo bg=$!; echo shell=$$\n")
  await third.until(() => /bg=\d+/.test(third.output) && /shell=\d+/.test(third.output), "background job")
  const background = Number(third.output.match(/bg=(\d+)/)![1])
  const shell = Number(third.output.match(/shell=(\d+)/)![1])
  assert.ok(alive(background) && alive(shell))
  third.send({ type: "close" })
  await third.until(() => !alive(background) && !alive(shell), "process tree exit")
  check("closing a tab kills the shell and its background jobs")

  const exiting = await Client.open(secure.origin, root, crypto.randomUUID())
  exiting.type("exit 3\n")
  await exiting.until(() => exiting.messages.some((m) => m.type === "exit"), "exit message")
  assert.equal(exiting.messages.find((m) => m.type === "exit")!.code, 3)
  check("a shell that exits reports its exit code")

  const orphan = await Client.open(secure.origin, root, crypto.randomUUID())
  orphan.type("echo shell=$$\n")
  await orphan.until(() => /shell=\d+/.test(orphan.output), "orphan pid")
  const orphanPid = Number(orphan.output.match(/shell=(\d+)/)![1])
  secure.proc.kill("SIGTERM")
  await secure.proc.exited
  const start = Date.now()
  while (alive(orphanPid) && Date.now() - start < 5000) await Bun.sleep(50)
  assert.ok(!alive(orphanPid))
  check("stopping the bridge stops its shells")

  console.log(`${passed} terminal E2E scenarios passed`)
} finally {
  secure.proc.kill()
  insecure.proc.kill()
  await Promise.all([secure.proc.exited, insecure.proc.exited])
  await rm(root, { recursive: true, force: true })
  await rm(config, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}
