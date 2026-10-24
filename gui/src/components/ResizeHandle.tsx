import { useEffect, type CSSProperties, type PointerEvent } from "react"

interface ResizeHandleProps {
  label: string
  // +1 when dragging right widens the panel (its right edge), -1 when dragging left widens it (its left edge).
  grow: 1 | -1
  width: number
  // Double-click restores this width, as in Claude's split panes.
  defaultWidth?: number
  onResize: (width: number) => void
  onDraggingChange: (dragging: boolean) => void
  style?: CSSProperties
}

// An 8px strip on a panel edge with a grip that appears on hover, as in Noa. Keyboard arrows nudge it.
export function ResizeHandle({ label, grow, width, defaultWidth, onResize, onDraggingChange, style }: ResizeHandleProps) {
  // A drag that loses its pointer (window blur, unmount) must not leave the resize cursor stuck on the page.
  useEffect(() => () => { delete document.body.dataset.paneDragging }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = width
    handle.dataset.resizing = "true"
    document.body.dataset.paneDragging = "true"
    onDraggingChange(true)

    function move(e: globalThis.PointerEvent) {
      onResize(startWidth + grow * (e.clientX - startX))
    }
    function end() {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      window.removeEventListener("keydown", cancel)
      delete handle.dataset.resizing
      delete document.body.dataset.paneDragging
      onDraggingChange(false)
    }
    function cancel(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return
      e.preventDefault()
      onResize(startWidth)
      end()
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
    window.addEventListener("keydown", cancel)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={defaultWidth === undefined ? undefined : "Drag to resize · Double-click to reset"}
      onPointerDown={onPointerDown}
      onDoubleClick={() => { if (defaultWidth !== undefined) onResize(defaultWidth) }}
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
