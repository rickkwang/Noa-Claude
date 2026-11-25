import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { Edit2, Queue, Steer, X } from "../lib/icons"
import { askSideChat, clearSideChat, sendQueuedSideChatNow, sideChat, sideChatVersion, stopSideChat, subscribeSideChat, takeQueuedSideChat, type SideChatRequest } from "../lib/sideChat"
import { Markdown } from "./Markdown"
import { UserBubble, Working } from "./MessageList"

const CLEAR_COMMAND = /^\/(?:clear|reset|new)(?:\s|$)/i

// A side conversation about the session: Noa answers from the session's context without tools,
// and nothing here is added to the session.
// Until the session can answer (`ready`), questions wait in the queue.
export function SideChat({ chatKey, ready, draftKey, request, focusKey }: { chatKey: string; ready: boolean; draftKey: string; request: SideChatRequest; focusKey?: number }) {
  useSyncExternalStore(subscribeSideChat, sideChatVersion, sideChatVersion)
  const chat = sideChat(chatKey)
  const [text, setText] = useState("")
  // A draft belongs to the session it was typed in; it survives the session getting its id.
  const [shownDraftKey, setShownDraftKey] = useState(draftKey)
  if (shownDraftKey !== draftKey) {
    setShownDraftKey(draftKey)
    setText("")
  }
  const [composing, setComposing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // After the main composer's own refocus, which runs in the next frame once a command clears it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focusKey])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length, chat.thinking])

  function submit() {
    const question = text.trim()
    if (!question) return
    setText("")
    if (CLEAR_COMMAND.test(question)) clearSideChat(chatKey)
    else askSideChat(chatKey, question, ready ? request : undefined)
  }
  const stop = () => stopSideChat(chatKey, request)
  // A queued question goes back into the composer, after any draft already there.
  function edit(index: number) {
    const question = takeQueuedSideChat(chatKey, index)
    if (question === undefined) return
    setText((draft) => draft.trim() ? `${draft}\n${question}` : question)
    inputRef.current?.focus()
  }

  const started = chat.messages.length > 0
  return (
    <div role="group" aria-label="Side chat" className="flex h-full min-h-0 flex-col pt-3 font-ui">
      {started ? (
        <div ref={scrollRef} className="noa-agent-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-6">
          {chat.messages.map((message, index) => message.role === "user"
            ? <div key={index} className="flex flex-col items-end"><UserBubble text={message.text} /></div>
            : <div key={index} className="noa-selectable min-w-0"><Markdown text={message.text} /></div>)}
          {chat.thinking && <Working />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2">
          <p className="mt-auto px-2 text-caption text-pretty text-[var(--sidebar-text-muted)]">
            {ready
              ? "Chat about this session without touching the main thread. Noa sees the full context, and nothing here is added to the session."
              : "Side chat is available once this session starts. Send your first message to start it."}
          </p>
        </div>
      )}
      {chat.error && <p className="shrink-0 px-5 pb-1.5 text-caption text-[var(--text-danger)] select-text">{chat.error}</p>}
      <div className="shrink-0 px-3 pb-3">
        {chat.queued.length > 0 && (
          <section aria-label="Queued side questions" className="mb-2 flex max-h-[30dvh] flex-col overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-[length:var(--text-chat-sm)] leading-5 text-[var(--text-secondary)]">
            {chat.queued.map((question, index) => (
              <div key={index} className="flex min-h-9 items-center gap-2">
                <Queue size={16} className="shrink-0 text-[var(--text-tertiary)]" />
                <p title={question} className="m-0 min-w-0 flex-1 truncate">{question}</p>
                {ready && <button type="button" aria-label="Send queued question now" title={chat.thinking ? "Stop the current answer and send this now" : "Send now"} onClick={() => sendQueuedSideChatNow(chatKey, index, request)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--fill-hover)]"><Steer size={14} /></button>}
                <button type="button" aria-label="Edit queued question" title="Edit" onClick={() => edit(index)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--fill-hover)]"><Edit2 size={14} /></button>
                <button type="button" aria-label="Remove queued question" onClick={() => takeQueuedSideChat(chatKey, index)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--fill-hover)]"><X size={14} /></button>
              </div>
            ))}
            {!ready && <p className="m-0 pb-1 text-caption text-[var(--sidebar-text-muted)]">Sends when the side chat is ready</p>}
          </section>
        )}
        <div className="noa-agent-input relative flex items-end">
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            onChange={(event) => setText(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && chat.thinking) {
                event.preventDefault()
                event.stopPropagation()
                stop()
                return
              }
              if (event.key !== "Enter" || event.shiftKey || composing || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit()
            }}
            placeholder={started ? "Follow up…" : "Ask a quick question…"}
            aria-label="Side chat message"
            className="noa-scroll-fade [field-sizing:content] max-h-[min(25dvh,240px)] min-h-[40px] w-full resize-none border-none bg-transparent pt-[10px] pb-[8px] pl-3 pr-[42px] text-[length:var(--transcript-text-size,var(--text-body))] leading-[1.45] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <button
            type="button"
            onClick={chat.thinking && !text.trim() ? stop : submit}
            disabled={!chat.thinking && !text.trim()}
            aria-label={chat.thinking && !text.trim() ? "Stop side chat (Esc)" : "Send to side chat"}
            className="noa-press absolute right-2 bottom-1.5 flex size-7 items-center justify-center rounded-[7px] text-[var(--sidebar-text,#52514E)] hover:bg-[var(--fill-hover)] disabled:opacity-60"
          >
            {chat.thinking && !text.trim()
              ? <span aria-hidden="true" className="block size-[11px] rounded-[1.25px] bg-current" />
              : <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 7 3 10 6 13" />
                <path d="M13 4v4a2 2 0 0 1-2 2H3" />
              </svg>}
          </button>
        </div>
      </div>
    </div>
  )
}
