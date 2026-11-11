import type { ReactNode } from "react"
import { useEffect, useState } from "react"

// Animates height by grid-template-rows (0fr ↔ 1fr), as in Claude's expand panels.
// Keep the closing animation, then release expensive content; inert blocks focus.
// `duration` sets the closing time; `fade` also fades opacity (used by the sidebar sections).
export function Collapsible({ open, children, duration = 150, fade = false }: {
  open: boolean
  children: ReactNode
  duration?: number
  fade?: boolean
}) {
  const [rendered, setRendered] = useState(open)
  useEffect(() => {
    if (open) setRendered(true)
    else {
      const timer = setTimeout(() => setRendered(false), 300)
      return () => clearTimeout(timer)
    }
  }, [open])
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] ease-[cubic-bezier(.19,1,.22,1)]"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: fade && !open ? 0 : 1,
        transitionDuration: `${open ? 300 : duration}ms`,
      }}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{rendered ? children : null}</div>
    </div>
  )
}
