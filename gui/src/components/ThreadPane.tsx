import { useRef, useState } from "react"
import { useAgent } from "../agent/useAgent"
import { ArrowUpRight } from "../lib/icons"
import { ElicitationCard } from "./ElicitationCard"
import { MessageList } from "./MessageList"
import { PermissionCard } from "./PermissionCard"

// A thread opened beside the project chat: its conversation, any question or approval it waits on, and a reply box.
// It attaches to the thread's own run, so answering here is the same as answering in the thread.
export function ThreadPane({ thread, onOpenFull }: { thread: { id: string; cwd: string }; onOpenFull: () => void }) {
  const [runtimeId] = useState(() => crypto.randomUUID())
  const { state, sendMessage, interrupt, answerPermission, answerElicitation, loadEarlier } = useAgent({ cwd: thread.cwd, resume: thread.id, sessionKey: 0, runtimeId, persistPreview: false })
  const [text, setText] = useState("")
  const [composing, setComposing] = useState(false)
  const drafts = useRef(new Map<string, unknown>())
  const ready = state.connection === "ready"
  const sending = useRef(false)
  const [sendUnconfirmed, setSendUnconfirmed] = useState(false)
  async function submit() {
    const message = text.trim()
    if (!message || !ready || sending.current) return
    sending.current = true
    let confirmed: boolean
    try {
      confirmed = await sendMessage(message)
    } finally {
      sending.current = false
    }
    setSendUnconfirmed(!confirmed)
    if (confirmed) setText(current => current === text ? "" : current)
  }
  return (
    <div role="group" aria-label="Thread" className="flex h-full min-h-0 flex-col font-ui">
      <div className="flex h-8 shrink-0 items-center justify-end px-2">
        <button type="button" onClick={onOpenFull} className="flex h-6 items-center gap-1 rounded-md px-1.5 text-caption text-[var(--text-tertiary)] hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary)]">
          <ArrowUpRight size={12} />Open full view
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList
          turns={state.turns}
          cwd={thread.cwd}
          sessionId={thread.id}
          busy={state.busy}
          result={state.result}
          readingWidth={640}
          tasks={state.tasks}
          historyBefore={state.historyBefore}
          historyLoading={state.historyLoading}
          onLoadEarlier={loadEarlier}
        />
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
        {(state.permissions.length > 0 || state.elicitations.length > 0) && (
          <div className="flex min-h-0 max-h-[50vh] flex-col gap-2 overflow-y-auto p-px">
            {state.permissions.map((permission) => (
              <PermissionCard key={permission.requestId} permission={permission} onAnswer={answerPermission} draft={drafts.current.get(permission.requestId) as never} onDraftChange={(draft) => drafts.current.set(permission.requestId, draft)} />
            ))}
            {state.elicitations.map((request) => <ElicitationCard key={request.requestId} request={request} onAnswer={answerElicitation} draft={drafts.current.get(request.requestId) as never} onDraftChange={(draft) => drafts.current.set(request.requestId, draft)} />)}
          </div>
        )}
        {sendUnconfirmed && <p role="status" className="text-caption">Noa did not confirm this message. Check the thread before resending.</p>}
        <div className="noa-agent-input relative flex items-end">
          <textarea
            value={text}
            rows={1}
            placeholder={ready ? "Reply to this thread…" : "Connecting…"}
            aria-label="Reply to this thread"
            onChange={(event) => setText(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || composing || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit()
            }}
            className="noa-scroll-fade [field-sizing:content] max-h-[min(25dvh,240px)] min-h-[40px] w-full resize-none border-none bg-transparent pt-[10px] pb-[8px] pl-3 pr-[42px] text-[length:var(--transcript-text-size,var(--text-body))] leading-[1.45] outline-none placeholder:text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)]"
          />
          <button
            type="button"
            onClick={state.busy && !text.trim() ? interrupt : submit}
            disabled={!ready || (!state.busy && !text.trim())}
            aria-label={state.busy && !text.trim() ? "Stop the thread" : "Send to the thread"}
            className="noa-press absolute right-2 bottom-1.5 flex size-7 items-center justify-center rounded-[7px] text-[var(--sidebar-text,#52514E)] hover:bg-[var(--fill-hover)] disabled:opacity-60"
          >
            {state.busy && !text.trim()
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
