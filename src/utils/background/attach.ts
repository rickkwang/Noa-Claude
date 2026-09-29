/**
 * Attach the current terminal to a background session's PTY host until the
 * session asks to detach (DETACH_SEQUENCE) or exits. The caller must have
 * released the terminal first (Ink.enterAlternateScreen).
 */
import { connect } from 'net'
import { getJobSocketPath } from './jobs.js'
import {
  createFrameDecoder,
  DETACH_SEQUENCE,
  encodeControl,
  encodeFrame,
  FRAME_CONTROL,
  FRAME_DATA,
  type HostControl,
} from './ptyProtocol.js'

export type AttachOutcome = 'detached' | 'exited' | 'unavailable'

/**
 * Terminal modes a session may have switched on that must not leak into the
 * agents view once it takes the screen back: mouse tracking, focus events,
 * bracketed paste, kitty keyboard, modifyOtherKeys, alt screen, hidden cursor.
 */
const RESET_MODES =
  '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l' +
  '\x1b[?1004l\x1b[?2004l\x1b[<u\x1b[>4m\x1b[?1049l\x1b[0m\x1b[?25h'

export function attachToJob(short: string): Promise<AttachOutcome> {
  return new Promise(resolve => {
    const stdin = process.stdin
    const stdout = process.stdout
    const socket = connect(getJobSocketPath(short))
    let connected = false
    let settled = false
    // The replay may hold the detach sequence of an earlier visit; only a
    // sequence written after the replay means "detach now".
    let live = false
    // Tail kept back from stdout in case it holds the start of a split
    // DETACH_SEQUENCE.
    let held = ''

    // Same paused-mode 'readable' reading Ink uses: switching the stream to
    // flowing mode ('data') and back drops the first keypress after detach.
    const onInput = (): void => {
      let chunk: Buffer | null
      while ((chunk = stdin.read() as Buffer | null) !== null) {
        socket.write(encodeFrame(FRAME_DATA, chunk))
      }
    }
    const sendSize = (): void => {
      socket.write(
        encodeControl({
          t: 'resize',
          cols: stdout.columns || 120,
          rows: stdout.rows || 40,
        }),
      )
    }

    function finish(outcome: AttachOutcome): void {
      if (settled) return
      settled = true
      stdin.off('readable', onInput)
      stdout.off('resize', sendSize)
      socket.destroy()
      // Clear before RESET_MODES leaves the alt screen, so the shell's screen survives.
      if (connected) stdout.write('\x1b[2J\x1b[H' + RESET_MODES)
      resolve(outcome)
    }

    function writeOutput(data: Buffer): void {
      let text = held + data.toString('latin1')
      held = ''
      if (!live) {
        stdout.write(Buffer.from(text.split(DETACH_SEQUENCE).join(''), 'latin1'))
        return
      }
      const at = text.indexOf(DETACH_SEQUENCE)
      if (at !== -1) {
        stdout.write(Buffer.from(text.slice(0, at), 'latin1'))
        finish('detached')
        return
      }
      // Hold back a suffix that could be the start of the sequence.
      for (let k = Math.min(DETACH_SEQUENCE.length - 1, text.length); k > 0; k--) {
        if (DETACH_SEQUENCE.startsWith(text.slice(-k))) {
          held = text.slice(-k)
          text = text.slice(0, -k)
          break
        }
      }
      if (text) stdout.write(Buffer.from(text, 'latin1'))
    }

    socket.on('connect', () => {
      connected = true
      stdout.write('\x1b[2J\x1b[H')
      if (stdin.isTTY) stdin.setRawMode(true)
      stdin.on('readable', onInput)
      stdout.on('resize', sendSize)
      sendSize()
    })
    socket.on(
      'data',
      createFrameDecoder((type, payload) => {
        if (settled) return
        if (type === FRAME_DATA) {
          writeOutput(payload)
        } else if (type === FRAME_CONTROL) {
          const msg = JSON.parse(payload.toString('utf8')) as HostControl
          if (msg.t === 'live') live = true
          else if (msg.t === 'exit') finish('exited')
        }
      }),
    )
    socket.on('error', () => finish(connected ? 'exited' : 'unavailable'))
    socket.on('close', () => finish(connected ? 'exited' : 'unavailable'))
  })
}

/**
 * The recent output a job's host keeps for replay, read without attaching:
 * connect, take everything up to the end of the replay, hang up.
 */
export function readJobOutput(short: string, timeoutMs = 3000): Promise<string | null> {
  return new Promise(resolve => {
    const socket = connect(getJobSocketPath(short))
    const chunks: Buffer[] = []
    let done = false
    const finish = (value: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => finish(chunks.length ? Buffer.concat(chunks).toString('utf8') : null), timeoutMs)
    socket.on(
      'data',
      createFrameDecoder((type, payload) => {
        if (type === FRAME_DATA) chunks.push(Buffer.from(payload))
        else if (type === FRAME_CONTROL) {
          const msg = JSON.parse(payload.toString('utf8')) as HostControl
          if (msg.t === 'live' || msg.t === 'exit') finish(Buffer.concat(chunks).toString('utf8'))
        }
      }),
    )
    socket.on('error', () => finish(null))
    socket.on('close', () => finish(chunks.length ? Buffer.concat(chunks).toString('utf8') : null))
  })
}
