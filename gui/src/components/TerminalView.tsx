import { useEffect, useLayoutEffect, useRef } from "react"
import "@xterm/xterm/css/xterm.css"
import { restartTerminal, terminalSession, type TerminalSnapshot } from "../lib/terminalSessions"

const STATUS: Record<string, string> = {
  connecting: "Opening terminal…",
  reconnecting: "Reconnecting…",
}

// One terminal's screen and connection status; the bottom and right panels both show terminals through it.
export function TerminalView({ cwd, terminal, visible, focusKey }: { cwd: string; terminal: TerminalSnapshot; visible: boolean; focusKey?: number }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const { id } = terminal

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!visible || !body) return
    const session = terminalSession(cwd, id)
    session.mount(body)
    const observer = new ResizeObserver(() => session.resize())
    observer.observe(body)
    return () => observer.disconnect()
  }, [visible, cwd, id])

  useEffect(() => {
    if (visible) terminalSession(cwd, id).focus()
  }, [visible, cwd, id, focusKey])

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden ps-4 pt-2 pb-3">
      <div ref={bodyRef} className="relative h-full w-full overflow-hidden" onMouseDown={() => terminalSession(cwd, id).focus()} />
      {terminal.status !== "ready" && (
        <div role="status" className="pointer-events-none absolute inset-x-4 bottom-3 z-10 flex">
          <div className="pointer-events-auto flex items-center gap-3 text-[length:var(--text-chat-sm)] text-[var(--text-secondary,#7B7974)]">
            <span>{STATUS[terminal.status] ?? terminal.message ?? "Shell exited"}</span>
            {terminal.status !== "connecting" && terminal.status !== "reconnecting" && (
              <button type="button" className="text-[var(--text-primary,#2D2D2B)] underline-offset-2 hover:underline" onClick={() => (terminal.status === "failed" ? terminalSession(cwd, id).reconnect() : restartTerminal(cwd, id))}>
                {terminal.status === "failed" ? "Retry" : "Open new terminal"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
