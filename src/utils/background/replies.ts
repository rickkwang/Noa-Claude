import { randomUUID, type UUID } from 'crypto'
import { watch, type FSWatcher } from 'fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../debug.js'
import { enqueue, getCommandQueue } from '../messageQueueManager.js'
import { flushSessionStorage, recordTranscript } from '../sessionStorage.js'
import { getBgJobShort } from './bgJob.js'
import { getJobDir, readJob } from './jobs.js'

type Reply = { uuid: UUID; text: string; createdAt: string }
const REPLY_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/

/** The reply is durable before the host is started or woken. */
export async function queueJobReply(short: string, text: string): Promise<UUID> {
  if (!text.trim()) throw new Error('reply cannot be empty')
  if (!(await readJob(short))) throw new Error('background session no longer exists')
  const dir = join(getJobDir(short), 'inbox')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const uuid = randomUUID()
  const temp = join(dir, `.${uuid}.tmp`)
  try {
    await writeFile(temp, JSON.stringify({ uuid, text, createdAt: new Date().toISOString() }), { mode: 0o600 })
    await rename(temp, join(dir, `${uuid}.json`))
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
  return uuid
}

/** Background only: watch inbox changes; acknowledge after the user message is durable. */
export function watchJobReplies(getMessages: () => readonly Message[]): { sync: () => void; close: () => void } {
  const short = getBgJobShort()
  let closed = false
  let watcher: FSWatcher | undefined
  let recoveryTimer: ReturnType<typeof setInterval> | undefined
  let scanning = false
  let requested = false
  const queued = new Set<UUID>()
  const sync = (): void => {
    if (!short || closed) return
    requested = true
    if (scanning) return
    scanning = true
    void (async () => {
      const dir = join(getJobDir(short), 'inbox')
      try {
        while (requested && !closed) {
          requested = false
          const files = (await readdir(dir)).filter(name => REPLY_FILE.test(name))
          const replies: Reply[] = []
          for (const file of files) {
            try {
              const reply = JSON.parse(await readFile(join(dir, file), 'utf8')) as Reply
              if (`${reply.uuid}.json` === file && typeof reply.text === 'string' && typeof reply.createdAt === 'string') replies.push(reply)
            } catch { /* Another acknowledgment may have removed it. */ }
          }
          replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uuid.localeCompare(b.uuid))
          const messages = [...getMessages()]
          const delivered = replies.filter(reply => messages.some(m =>
            (m.type === 'user' && m.uuid === reply.uuid) ||
            (m.type === 'attachment' && m.attachment.type === 'queued_command' && m.attachment.source_uuid === reply.uuid),
          ))
          if (delivered.length) {
            for (const reply of delivered) queued.add(reply.uuid)
            await recordTranscript(messages)
            await flushSessionStorage()
            for (const reply of delivered) {
              await rm(join(dir, `${reply.uuid}.json`), { force: true })
              queued.delete(reply.uuid)
            }
          }
          for (const reply of replies) {
            if (closed || delivered.includes(reply) || queued.has(reply.uuid) || getCommandQueue().some(cmd => cmd.uuid === reply.uuid)) continue
            queued.add(reply.uuid)
            enqueue({ value: reply.text, uuid: reply.uuid, mode: 'prompt', priority: 'next', skipSlashCommands: true, backgroundReply: true })
          }
        }
      } catch (e) {
        logForDebugging(`[background reply] ${String(e)}`)
      } finally {
        scanning = false
      }
    })()
  }
  if (short) void (async () => {
    const dir = join(getJobDir(short), 'inbox')
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      if (closed) return
      watcher = watch(dir, sync)
      watcher.on('error', e => logForDebugging(`[background reply] ${String(e)}`))
      // Bun can miss directory rename events on macOS; check only the directory stamp.
      let stamp = (await stat(dir)).mtimeMs
      if (closed) return
      let checking = false
      recoveryTimer = setInterval(() => {
        if (closed || checking) return
        checking = true
        void stat(dir).then(info => {
          if (info.mtimeMs !== stamp) { stamp = info.mtimeMs; sync() }
        }).catch(() => {}).finally(() => { checking = false })
      }, 1000)
      recoveryTimer.unref()
      sync()
    } catch (e) {
      logForDebugging(`[background reply] ${String(e)}`)
    }
  })()
  return {
    sync: () => { if (queued.size) sync() },
    close: () => { closed = true; watcher?.close(); if (recoveryTimer) clearInterval(recoveryTimer) },
  }
}
