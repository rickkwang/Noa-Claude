import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Folder, GitBranch } from "../lib/icons"

const OPEN_DELAY_MS = 250
const CLOSE_DELAY_MS = 100
// Gap between the row and the card, and the minimum distance kept from the window edge.
const SIDE_OFFSET = 2
const EDGE_PADDING = 8

export function ageLabel(updatedAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`
}

export type SessionCardInfo = { title: string; updatedAt?: number; project?: string; worktree?: string }

// Hover handlers for a row plus the card they open: right of the row, top aligned, opened after a short
// delay and kept open while the pointer is on the card.
export function useSessionHoverCard(info: SessionCardInfo, enabled: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clear = useCallback(() => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current) }, [])
  const close = useCallback(() => { clear(); setRect(null) }, [clear])
  useEffect(() => clear, [clear])
  useEffect(() => { if (!enabled) close() }, [enabled, close])
  useEffect(() => {
    if (!rect) return
    // Scrolling or resizing moves the row out from under the card.
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close) }
  }, [rect, close])

  const scheduleOpen = (element: HTMLElement) => {
    clear()
    openTimer.current = setTimeout(() => setRect(element.getBoundingClientRect()), OPEN_DELAY_MS)
  }
  const scheduleClose = () => {
    clear()
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS)
  }

  const triggerProps = {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      if (enabled && event.pointerType !== "touch") scheduleOpen(event.currentTarget)
    },
    onPointerLeave: scheduleClose,
    // Keyboard focus shows the same details a pointer would.
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      if (enabled && event.target === event.currentTarget && event.currentTarget.matches(":focus-visible")) scheduleOpen(event.currentTarget)
    },
    onBlur: scheduleClose,
    onPointerDown: close,
  }
  const card = rect ? <SessionHoverCard info={info} anchor={rect} onEnter={() => clearTimeout(closeTimer.current)} onLeave={scheduleClose} /> : null
  return { triggerProps, card }
}

function SessionHoverCard({ info, anchor, onEnter, onLeave }: { info: SessionCardInfo; anchor: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>()
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    const top = Math.min(Math.max(anchor.top, EDGE_PADDING), window.innerHeight - height - EDGE_PADDING)
    const width = ref.current?.offsetWidth ?? 0
    const left = Math.min(anchor.right + SIDE_OFFSET, window.innerWidth - width - EDGE_PADDING)
    setPosition({ left: Math.max(EDGE_PADDING, left), top })
  }, [anchor])
  return createPortal(
    <div ref={ref} role="tooltip" className="noa-session-card font-ui" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="noa-session-card-title">{info.title}</span>
        {info.updatedAt !== undefined && <span className="shrink-0 text-xs leading-5 text-[var(--text-tertiary)]">{ageLabel(info.updatedAt)}</span>}
      </div>
      {info.project && <CardRow icon={<Folder size={16} />}>{info.project}</CardRow>}
      {info.worktree && <CardRow icon={<GitBranch size={16} />}>{info.worktree}</CardRow>}
    </div>,
    document.body,
  )
}

function CardRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-5 min-w-0 items-center gap-2 leading-5">
      <span className="flex size-4 shrink-0 items-center justify-center text-[var(--text-tertiary)]" aria-hidden="true">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}
