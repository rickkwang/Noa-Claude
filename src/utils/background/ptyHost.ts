/**
 * PTY host: one detached process per background session.
 *
 *   noa --bg-pty-host <short> <cols> <rows> -- <file> [args...]
 *
 * Runs the session inside a pseudo-terminal, keeps the recent output so a
 * client attaching later can rebuild the screen, and serves attach clients
 * over a unix socket. The session outlives any terminal: closing the agents
 * view, or the window it ran in, leaves the host and its session running.
 */
import { unlinkSync } from 'fs'
import { createServer, type Socket } from 'net'
import {
  ensureJobSocketDir,
  getJobSocketPath,
  patchJob,
  readJob,
  writeHostPid,
} from './jobs.js'
import {
  createFrameDecoder,
  encodeControl,
  encodeFrame,
  FRAME_CONTROL,
  FRAME_DATA,
  type ClientControl,
} from './ptyProtocol.js'

/** Output kept for replay on attach. Ink redraws on the resize that follows. */
const REPLAY_BYTES = 1024 * 1024
/** A client this far behind is dropped rather than buffered without bound. */
const MAX_CLIENT_BACKLOG = 4 * 1024 * 1024
const MAX_DIMENSION = 1000

export async function runPtyHost(argv: string[]): Promise<never> {
  const sep = argv.indexOf('--')
  const [short, colsArg, rowsArg] = argv
  if (!short || sep < 3 || sep === argv.length - 1) {
    process.stderr.write(
      'usage: --bg-pty-host <short> <cols> <rows> -- <file> [args...]\n',
    )
    process.exit(2)
  }
  const cols = Number(colsArg) || 120
  const rows = Number(rowsArg) || 40
  const command = argv.slice(sep + 1)

  await writeHostPid(short, process.pid)

  const replay: Buffer[] = []
  let replayBytes = 0
  const clients = new Set<Socket>()
  let exited = false

  function broadcast(frame: Buffer): void {
    for (const client of clients) {
      if (client.destroyed || client.writableLength > MAX_CLIENT_BACKLOG) {
        client.destroy()
        clients.delete(client)
        continue
      }
      client.write(frame)
    }
  }

  const terminal = new Bun.Terminal({
    cols,
    rows,
    data(_term, data) {
      const chunk = Buffer.from(data)
      replay.push(chunk)
      replayBytes += chunk.length
      while (replayBytes > REPLAY_BYTES && replay.length > 1) {
        replayBytes -= replay.shift()!.length
      }
      if (clients.size) broadcast(encodeFrame(FRAME_DATA, chunk))
    },
  })

  /** A session that never started must not stay listed as working. */
  const failBeforeStart = async (e: unknown): Promise<never> => {
    const detail = e instanceof Error ? e.message : String(e)
    await patchJob(short, {
      state: 'failed',
      tempo: 'idle',
      needs: undefined,
      exitCode: 1,
      detail: `failed to start: ${detail}`.slice(0, 200),
    }).catch(() => {})
    process.exit(1)
  }

  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn(command, {
      cwd: process.cwd(),
      env: childEnv(),
      terminal,
    })
  } catch (e) {
    return failBeforeStart(e)
  }
  try {
    await writeHostPid(short, process.pid, child.pid)
  } catch (e) {
    child.kill('SIGTERM')
    terminal.close()
    return failBeforeStart(e)
  }

  function handleControl(msg: ClientControl): void {
    if (exited) return
    if (msg.t === 'resize') {
      const c = Math.floor(msg.cols)
      const r = Math.floor(msg.rows)
      if (c > 0 && c <= MAX_DIMENSION && r > 0 && r <= MAX_DIMENSION) {
        terminal.resize(c, r)
        // Same-size resizes raise no SIGWINCH; send one anyway so a
        // re-attaching client always gets a full redraw.
        try {
          child.kill('SIGWINCH')
        } catch {
          // exiting
        }
      }
    } else if (msg.t === 'kill') {
      stopSession()
    }
  }

  const socketPath = ensureJobSocketDir(short)
  try {
    unlinkSync(socketPath)
  } catch {
    // no stale socket
  }
  const server = createServer(socket => {
    socket.on('error', () => socket.destroy())
    socket.once('close', () => clients.delete(socket))
    for (const chunk of replay) socket.write(encodeFrame(FRAME_DATA, chunk))
    socket.write(encodeControl({ t: 'live' }))
    if (exited) {
      socket.end(encodeControl({ t: 'exit', code: child.exitCode }))
      return
    }
    clients.add(socket)
    socket.on(
      'data',
      createFrameDecoder((type, payload) => {
        if (type === FRAME_DATA) {
          if (!exited) terminal.write(payload)
        } else if (type === FRAME_CONTROL) {
          try {
            handleControl(JSON.parse(payload.toString('utf8')) as ClientControl)
          } catch {
            // malformed control frame
          }
        }
      }),
    )
  })
  server.listen(socketPath)

  function stopSession(): void {
    try {
      child.kill('SIGTERM')
    } catch {
      return
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // gone
      }
    }, 5000).unref()
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, stopSession)
  }

  let code: number
  try {
    code = await child.exited
  } catch (e) {
    // Spawn failure (e.g. the self binary vanished): child.exited rejects.
    return failBeforeStart(e)
  }
  exited = true

  // A session that ends without reporting its own outcome (crash, kill)
  // must not stay listed as working or needing input.
  const record = await readJob(short)
  if (record) {
    const stopped = record.stopRequested === true
    const clean = stopped || record.state === 'done' || code === 0
    await patchJob(short, {
      state: clean ? 'done' : 'failed',
      tempo: 'idle',
      needs: undefined,
      exitCode: code,
      detail: stopped ? 'stopped' : clean ? record.detail : lastLine(replay) ?? `exited with code ${code}`,
    }).catch(() => {})
  }

  broadcast(encodeControl({ t: 'exit', code }))
  for (const client of clients) client.end()
  terminal.close()
  server.close()
  try {
    unlinkSync(getJobSocketPath(short))
  } catch {
    // already removed
  }
  process.exit(0)
}

/** Last visible line of the session's output, e.g. why it failed to start. */
function lastLine(chunks: Buffer[]): string | undefined {
  const tail = Buffer.concat(chunks.slice(-8)).toString('utf8')
  const lines = tail
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[_P^][^\x1b]*\x1b\\|\x1b./g, '')
    .split(/\r?\n|\r/)
    .map(l => l.trim())
    .filter(Boolean)
  const line = lines.at(-1)
  return line ? line.slice(0, 200) : undefined
}

/**
 * The session runs in a PTY that any terminal can attach to later, so it must
 * not carry the launcher's tmux marker: that clamps colors to 256 for the
 * session's whole life (the brand orange turns salmon) even when it is
 * reopened from a truecolor terminal.
 */
function childEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, TERM: process.env.TERM || 'xterm-256color' }
  delete env.TMUX
  delete env.TMUX_PANE
  return env
}
