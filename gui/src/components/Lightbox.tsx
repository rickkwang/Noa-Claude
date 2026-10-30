import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Download, RotateCcw, X, ZoomIn, ZoomOut } from "../lib/icons"

export interface LightboxItem {
  src: string
  alt?: string
  name?: string
}

interface Transform {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 8
// Pointer travel before a press becomes a pan, so a click still closes the viewer.
const DRAG_DEADZONE = 4
// Wheel delta is exponential: one notch is a ~13% step, a trackpad gesture stays smooth.
const WHEEL_SENSITIVITY = 0.0015
const RESET: Transform = { scale: 1, x: 0, y: 0 }

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

// The image is centred in the stage, so it may travel half of the scaled overflow in each direction.
function clampOffset(value: number, base: number, viewport: number, scale: number) {
  const limit = Math.max(0, (base * scale - viewport) / 2)
  return Math.min(limit, Math.max(-limit, value))
}

export function Lightbox({ items, index, onIndex, onClose }: {
  items: LightboxItem[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const item = items[index]
  const [transform, setTransform] = useState<Transform>(RESET)
  const [dragging, setDragging] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const scaleRef = useRef(1)
  const movedRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | undefined>(undefined)

  useEffect(() => { scaleRef.current = transform.scale }, [transform.scale])
  useEffect(() => { setTransform(RESET) }, [index])

  // Lock the page behind the viewer and hand focus back when it closes.
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current!
    dialog.showModal()
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      restoreFocus.current?.focus?.({ preventScroll: true })
    }
  }, [])

  const clampTransform = useCallback((next: Transform): Transform => {
    const image = imageRef.current
    if (!image) return next
    // offsetWidth is the untransformed layout size, so this is the scale-1 base.
    const stage = stageRef.current
    const viewportWidth = stage?.clientWidth ?? image.offsetWidth
    const viewportHeight = stage?.clientHeight ?? image.offsetHeight
    return {
      scale: next.scale,
      x: clampOffset(next.x, image.offsetWidth, viewportWidth, next.scale),
      y: clampOffset(next.y, image.offsetHeight, viewportHeight, next.scale),
    }
  }, [])

  // Zoom around the pointer so the content under the cursor stays put.
  const applyZoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setTransform((current) => {
      const image = imageRef.current
      const scale = clampScale(current.scale * factor)
      if (!image || clientX === undefined || clientY === undefined) {
        return clampTransform({ scale, x: scale === MIN_SCALE ? 0 : current.x, y: scale === MIN_SCALE ? 0 : current.y })
      }
      const rect = image.getBoundingClientRect()
      const ratio = scale / current.scale
      return clampTransform({
        scale,
        x: current.x + (clientX - (rect.left + rect.width / 2)) * (1 - ratio),
        y: current.y + (clientY - (rect.top + rect.height / 2)) * (1 - ratio),
      })
    })
  }, [clampTransform])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      applyZoom(Math.exp(-event.deltaY * WHEEL_SENSITIVITY), event.clientX, event.clientY)
    }
    stage.addEventListener("wheel", onWheel, { passive: false })
    return () => stage.removeEventListener("wheel", onWheel)
  }, [applyZoom])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); applyZoom(1.25); return }
      if (event.key === "-") { event.preventDefault(); applyZoom(0.8); return }
      if (event.key === "0") { event.preventDefault(); setTransform(RESET); return }
      if (items.length < 2 || scaleRef.current > MIN_SCALE) return
      if (event.key === "ArrowLeft") { event.preventDefault(); onIndex((index - 1 + items.length) % items.length) }
      else if (event.key === "ArrowRight") { event.preventDefault(); onIndex((index + 1) % items.length) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [applyZoom, index, items.length, onClose, onIndex])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    // A new press always starts a fresh click/pan discrimination, including at scale 1.
    movedRef.current = false
    if (transform.scale <= MIN_SCALE) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: transform.x, originY: transform.y }
    setDragging(true)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!movedRef.current && Math.hypot(dx, dy) < DRAG_DEADZONE) return
    movedRef.current = true
    setTransform((current) => clampTransform({ ...current, x: drag.originX + dx, y: drag.originY + dy }))
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    setDragging(false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
  }

  return createPortal(
    <dialog ref={dialogRef}
      onCancel={event => { event.preventDefault(); onClose() }}
      className="noa-lightbox fixed inset-0 z-[100] m-0 flex h-screen max-h-none w-screen max-w-none flex-col border-0 bg-[rgba(20,20,19,0.9)] p-0 text-white backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={item?.name ?? "Image preview"}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        <span className="min-w-0 flex-1 truncate text-caption text-white/70">{item?.name ?? item?.alt ?? "Image"}</span>
        {items.length > 1 && <span className="px-2 font-mono text-caption tabular-nums text-white/50">{index + 1} / {items.length}</span>}
        <LightboxButton label="Zoom out" onClick={() => applyZoom(0.8)}><ZoomOut size={16} /></LightboxButton>
        <LightboxButton label="Zoom in" onClick={() => applyZoom(1.25)}><ZoomIn size={16} /></LightboxButton>
        <LightboxButton label="Reset zoom" onClick={() => setTransform(RESET)}><RotateCcw size={15} /></LightboxButton>
        {item && /^(?:data:image\/|blob:|\/api\/)/i.test(item.src) && <LightboxButton label="Save copy" onClick={() => { const link = document.createElement("a"); link.href = item.src; link.download = item.name ?? "image"; link.click() }}><Download size={16} /></LightboxButton>}
        <LightboxButton label="Close" onClick={onClose} ref={closeRef}><X size={17} /></LightboxButton>
      </div>

      <div
        ref={stageRef}
        className="noa-lightbox-stage relative min-h-0 flex-1 overflow-hidden"
        data-dragging={dragging || undefined}
        data-zoomed={transform.scale > MIN_SCALE || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => { if (event.target === event.currentTarget && !movedRef.current) onClose() }}
        onDoubleClick={(event) => {
          if (transform.scale > MIN_SCALE) setTransform(RESET)
          else applyZoom(2.5, event.clientX, event.clientY)
        }}
      >
        {item && (
          <img
            ref={imageRef}
            src={item.src}
            alt={item.alt ?? ""}
            draggable={false}
            className="noa-lightbox-img absolute left-1/2 top-1/2 max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-2rem)] select-none object-contain"
            style={{ transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) scale(${transform.scale})` }}
          />
        )}
        {items.length > 1 && (
          <>
            <LightboxArrow side="left" onClick={() => onIndex((index - 1 + items.length) % items.length)} />
            <LightboxArrow side="right" onClick={() => onIndex((index + 1) % items.length)} />
          </>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center justify-center px-3 text-caption text-white/45">
        Scroll to zoom · Drag to pan · Esc to close
      </div>
    </dialog>,
    document.body,
  )
}

function LightboxButton({ label, onClick, children, ref }: {
  label: string
  onClick: () => void
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white noa-press"
    >
      {children}
    </button>
  )
}

function LightboxArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous image" : "Next image"}
      onClick={(event) => { event.stopPropagation(); onClick() }}
      className={`absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/75 backdrop-blur-sm transition-colors hover:bg-black/55 hover:text-white noa-press ${side === "left" ? "left-3" : "right-3"}`}
    >
      <Icon size={20} />
    </button>
  )
}
