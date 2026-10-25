import type { ReactNode } from "react"
import { useEffect, useState } from "react"

// Animates height by grid-template-rows (0fr ↔ 1fr), as in Claude's expand panels.
// Keep the closing animation, then release expensive content; inert blocks focus.
export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
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
      className="grid transition-[grid-template-rows] ease-[cubic-bezier(.19,1,.22,1)]"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", transitionDuration: open ? "300ms" : "150ms" }}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{rendered ? children : null}</div>
    </div>
  )
}
