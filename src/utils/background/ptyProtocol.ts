/**
 * Wire format between a PTY host and an attached agents view:
 * `[type:u8][length:u32be][payload]`. DATA frames carry raw terminal bytes
 * (host → client: session output; client → host: keystrokes); CONTROL frames
 * carry one JSON message.
 */

/** Marks a session as background job `<short>` (set by dispatch.ts). */
export const BG_JOB_ENV = 'NOA_CLAUDE_BG_JOB'

export const FRAME_DATA = 0
export const FRAME_CONTROL = 1

/**
 * `live` ends the replay of recent output that opens every attach; anything
 * after it is new. `exit` means the session ended.
 */
export type HostControl = { t: 'live' } | { t: 'exit'; code: number | null }
export type ClientControl =
  | { t: 'resize'; cols: number; rows: number }
  | { t: 'kill' }

/**
 * Written by a background session to its own stdout to ask the attached
 * client to let go of the terminal (left arrow on an empty prompt, /exit…).
 * An APC string: terminals that see it unfiltered ignore it.
 */
export const DETACH_SEQUENCE = '\x1b_noa-detach\x1b\\'

export function encodeFrame(type: number, payload: Uint8Array | string): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload
  const frame = Buffer.allocUnsafe(5 + body.length)
  frame.writeUInt8(type, 0)
  frame.writeUInt32BE(body.length, 1)
  frame.set(body, 5)
  return frame
}

export function encodeControl(msg: HostControl | ClientControl): Buffer {
  return encodeFrame(FRAME_CONTROL, JSON.stringify(msg))
}

/** Incremental decoder: feed socket chunks, get whole frames back. */
export function createFrameDecoder(
  onFrame: (type: number, payload: Buffer) => void,
): (chunk: Buffer) => void {
  let pending: Buffer = Buffer.alloc(0)
  return chunk => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    while (pending.length >= 5) {
      const length = pending.readUInt32BE(1)
      if (pending.length < 5 + length) break
      const type = pending.readUInt8(0)
      const payload = pending.subarray(5, 5 + length)
      pending = pending.subarray(5 + length)
      onFrame(type, payload)
    }
  }
}
