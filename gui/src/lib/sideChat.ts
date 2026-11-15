import type { ControlRequest } from "../agent/protocol"

// Side questions asked about a session. Answers never enter the session; each ask
// sends the earlier exchanges so the CLI replays exactly what this chat shows.
export interface SideChatMessage {
  role: "user" | "assistant"
  text: string
  // Set on real answers only; notices written by the CLI are not replayed as history.
  question?: string
}
export interface SideChat {
  messages: SideChatMessage[]
  thinking: boolean
  error?: string
  // Asked while an answer is pending or before the session can answer; sent in order.
  queued: string[]
}
export type SideChatRequest = (request: ControlRequest, options?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<any>

const EMPTY: SideChat = { messages: [], thinking: false, queued: [] }
// A side question can wait behind a busy main turn, so it gets longer than other requests.
const ASK_TIMEOUT_MS = 120_000
const chats = new Map<string, SideChat>()
// The pending ask per chat; replaced or removed when it is stopped, so its late settle is ignored.
const pending = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let version = 0

function set(key: string, chat: SideChat) {
  chats.set(key, chat)
  version++
  for (const listener of listeners) listener()
}

function withdraw(key: string): string | undefined {
  const controller = pending.get(key)
  if (!controller) return undefined
  pending.delete(key)
  controller.abort()
  const chat = sideChat(key)
  const last = chat.messages.at(-1)
  const question = last?.role === "user" ? last.text : undefined
  set(key, { ...chat, messages: question === undefined ? chat.messages : chat.messages.slice(0, -1), thinking: false })
  return question
}

export function subscribeSideChat(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function sideChatVersion() {
  return version
}
export function sideChat(key: string): SideChat {
  return chats.get(key) ?? EMPTY
}

export function clearSideChat(key: string) {
  withdraw(key)
  set(key, EMPTY)
}

// Queue a question; it is sent now when a request is given and nothing is pending.
export function askSideChat(key: string, question: string, request?: SideChatRequest) {
  const chat = sideChat(key)
  set(key, { ...chat, error: undefined, queued: [...chat.queued, question] })
  if (request) pumpSideChat(key, request)
}

// Take a queued question out, to drop it or edit it in the composer.
export function takeQueuedSideChat(key: string, index: number): string | undefined {
  const chat = sideChat(key)
  const question = chat.queued[index]
  if (question !== undefined) set(key, { ...chat, queued: chat.queued.filter((_, at) => at !== index) })
  return question
}

// Send a queued question next; a pending answer is stopped and its question asked again after it.
export function sendQueuedSideChatNow(key: string, index: number, request: SideChatRequest) {
  const question = takeQueuedSideChat(key, index)
  if (question === undefined) return
  const interrupted = withdraw(key)
  const chat = sideChat(key)
  set(key, { ...chat, error: undefined, queued: [question, ...interrupted === undefined ? [] : [interrupted], ...chat.queued] })
  pumpSideChat(key, request)
}

// Stop the pending answer; its question is dropped and the queue moves on.
export function stopSideChat(key: string, request: SideChatRequest) {
  if (withdraw(key) !== undefined) pumpSideChat(key, request)
}

// The session was left while a question was pending: its answer can no longer arrive here,
// so the question goes back to the front of the queue and is sent when the session is back.
export function abandonSideChat(key: string) {
  const question = withdraw(key)
  if (question === undefined) return
  const chat = sideChat(key)
  set(key, { ...chat, queued: [question, ...chat.queued] })
}

// Questions queued before the session had an id move to it once it does.
export function moveSideChat(from: string, to: string) {
  const queued = sideChat(from).queued
  chats.delete(from)
  if (queued.length) set(to, { ...sideChat(to), queued: [...sideChat(to).queued, ...queued] })
}

export function pumpSideChat(key: string, request: SideChatRequest) {
  const chat = sideChat(key)
  if (chat.thinking || chat.error || !chat.queued.length) return
  const [question, ...queued] = chat.queued as [string, ...string[]]
  const history = chat.messages.flatMap((message) => message.role === "assistant" && message.question !== undefined ? [{ question: message.question, response: message.text }] : [])
  const controller = new AbortController()
  pending.set(key, controller)
  set(key, { messages: [...chat.messages, { role: "user", text: question }], thinking: true, queued })
  request({ subtype: "side_question", question, history }, { timeoutMs: ASK_TIMEOUT_MS, signal: controller.signal })
    .then((result: { response: string | null; synthetic?: boolean }) => {
      if (pending.get(key) !== controller) return
      pending.delete(key)
      const current = sideChat(key)
      if (result.response === null) {
        set(key, { ...current, thinking: false, error: "Noa didn’t answer. Try again." })
        return
      }
      set(key, { ...current, messages: [...current.messages, { role: "assistant", text: result.response, ...(!result.synthetic && { question }) }], thinking: false })
      if (!result.synthetic) pumpSideChat(key, request)
    }, (error: Error) => {
      if (pending.get(key) !== controller) return
      pending.delete(key)
      set(key, { ...sideChat(key), thinking: false, error: error.message })
    })
}
