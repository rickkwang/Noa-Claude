import type { ReactNode } from "react"

// Animates height by grid-template-rows (0fr ↔ 1fr), as in Claude's expand panels.
// Closed content stays mounted but inert, so it is hidden from keyboard focus too.
export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] ease-[cubic-bezier(.19,1,.22,1)]"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", transitionDuration: open ? "300ms" : "150ms" }}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
