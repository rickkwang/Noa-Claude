import type { CSSProperties, PointerEvent } from "react"

interface ResizeHandleProps {
  label: string
  // +1 when dragging right widens the panel (its right edge), -1 when dragging left widens it (its left edge).
  grow: 1 | -1
  width: number
  onResize: (width: number) => void
  onDraggingChange: (dragging: boolean) => void
  style?: CSSProperties
}

// An 8px strip on a panel edge with a grip that appears on hover, as in Noa. Keyboard arrows nudge it.
export function ResizeHandle({ label, grow, width, onResize, onDraggingChange, style }: ResizeHandleProps) {
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = width
    handle.dataset.resizing = "true"
    onDraggingChange(true)

    const move = (e: globalThis.PointerEvent) => onResize(startWidth + grow * (e.clientX - startX))
    const end = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      delete handle.dataset.resizing
      onDraggingChange(false)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
        e.preventDefault()
        onResize(width + (e.key === "ArrowRight" ? 16 : -16) * grow)
      }}
      className="group absolute top-0 bottom-0 z-30 w-2 cursor-col-resize touch-none outline-none"
      style={{ WebkitAppRegion: "no-drag", ...style } as CSSProperties}
    >
      <span aria-hidden="true" className="noa-resize-indicator" />
    </div>
  )
}
