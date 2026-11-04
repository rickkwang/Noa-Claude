import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react"

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
  // "horizontal" sits on a top or bottom edge and resizes height; `width` and `grow` then refer to that height.
  orientation?: "vertical" | "horizontal"
}

// An 8px strip on a panel edge with a grip that appears on hover, as in Noa. Keyboard arrows nudge it.
export function ResizeHandle({ label, grow, width, defaultWidth, onResize, onDraggingChange, style, orientation = "vertical" }: ResizeHandleProps) {
  const rows = orientation === "horizontal"
  // A drag that loses its pointer (window blur, unmount) must not leave the resize cursor stuck on the page,
  // nor the owner believing a drag is still running: a resize can unmount its own handle (dragging a panel shut).
  const dragging = useRef(onDraggingChange)
  const active = useRef(false)
  dragging.current = onDraggingChange
  useEffect(() => () => {
    delete document.body.dataset.paneDragging
    if (active.current) dragging.current(false)
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const start = rows ? event.clientY : event.clientX
    const startWidth = width
    handle.dataset.resizing = "true"
    document.body.dataset.paneDragging = rows ? "row" : "true"
    active.current = true
    onDraggingChange(true)

    function move(e: globalThis.PointerEvent) {
      onResize(startWidth + grow * ((rows ? e.clientY : e.clientX) - start))
    }
    function end() {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      window.removeEventListener("keydown", cancel)
      delete handle.dataset.resizing
      delete document.body.dataset.paneDragging
      active.current = false
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
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={defaultWidth === undefined ? undefined : "Drag to resize · Double-click to reset"}
      onPointerDown={onPointerDown}
      onDoubleClick={() => { if (defaultWidth !== undefined) onResize(defaultWidth) }}
      onKeyDown={(e) => {
        const [less, more] = rows ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"]
        if (e.key !== less && e.key !== more) return
        e.preventDefault()
        onResize(width + (e.key === more ? 16 : -16) * grow)
      }}
      className={`group absolute z-30 touch-none outline-none ${rows ? "inset-x-0 h-2 cursor-row-resize" : "top-0 bottom-0 w-2 cursor-col-resize"}`}
      style={{ WebkitAppRegion: "no-drag", ...style } as CSSProperties}
    >
      <span aria-hidden="true" className="noa-resize-indicator" />
    </div>
  )
}
