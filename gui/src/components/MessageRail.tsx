import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { Bookmark, BookmarkFilled } from "../lib/icons"
import { Markdown } from "./Markdown"

export interface MessageRailItem {
  id: string
  label: string
  preview: string
}

interface MessageRailProps {
  items: MessageRailItem[]
  activeIds: string[]
  sessionId?: string
  onJump: (id: string, behavior: ScrollBehavior) => void
}

// Codex shows the rail from four user messages on, opens the preview after a
// short hover delay, and keeps it open while the pointer crosses into the card.
const OPEN_DELAY = 110
const CLOSE_DELAY = 140
const RAIL_MARGIN = 8
const NEIGHBOR_PROGRESS = [1, 0.7, 0.4, 0.2]

function escapeId(id: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"')
}

function readBookmarks(storageKey: string | undefined): Set<string> {
  if (!storageKey) return new Set()
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    if (Array.isArray(parsed)) return new Set(parsed.filter((value): value is string => typeof value === "string"))
  } catch {}
  return new Set()
}

export function MessageRail({ items, activeIds, sessionId, onJump }: MessageRailProps) {
  // User ids are shared by the live bridge and the persisted transcript.
  const storageKey = sessionId ? `noa-agent.bookmarks.v2.${sessionId}` : undefined
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => readBookmarks(storageKey))
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [hotId, setHotId] = useState<string | null>(null)
  const [anchorY, setAnchorY] = useState(0)
  const [cardTop, setCardTop] = useState<number>()
  const [scrubbing, setScrubbing] = useState(false)
  const [scrollable, setScrollable] = useState(false)
  const layerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const scrubRef = useRef<{ pointerId: number; itemId: string } | undefined>(undefined)
  const scrubbed = useRef(false)
  const ignoreClick = useRef(false)

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify([...bookmarks]))
    } catch {}
  }, [bookmarks, storageKey])

  useEffect(() => () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }, [])

  function clearTimers() {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    openTimer.current = undefined
    closeTimer.current = undefined
  }

  function anchorFor(id: string) {
    const layer = layerRef.current
    const button = listRef.current?.querySelector<HTMLElement>(`[data-message-rail-item="${escapeId(id)}"]`)
    if (!layer || !button) return
    const layerRect = layer.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setAnchorY(buttonRect.top + buttonRect.height / 2 - layerRect.top)
  }

  function openPreview(id: string) {
    clearTimers()
    setHotId(id)
    setPreviewId(id)
    anchorFor(id)
  }

  function scheduleClose() {
    clearTimers()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined
      setPreviewId(null)
      setHotId(null)
    }, CLOSE_DELAY)
  }

  function closeNow() {
    clearTimers()
    setPreviewId(null)
    setHotId(null)
  }

  function hoverItem(id: string) {
    setHotId(id)
    if (previewId != null) {
      clearTimers()
      setPreviewId(id)
      anchorFor(id)
      return
    }
    clearTimers()
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined
      setPreviewId(id)
      anchorFor(id)
    }, OPEN_DELAY)
  }

  function leaveList() {
    if (scrubRef.current) return
    setHotId(null)
    scheduleClose()
  }

  function itemUnderPointer(clientY: number): HTMLElement | null {
    const list = listRef.current
    if (!list) return null
    const rect = list.getBoundingClientRect()
    const element = document.elementFromPoint(
      rect.left + rect.width / 2,
      Math.max(rect.top, Math.min(clientY, rect.bottom - 1)),
    )
    return element instanceof Element ? element.closest<HTMLElement>("[data-message-rail-item]") : null
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const item = (event.target instanceof Element ? event.target.closest<HTMLElement>("[data-message-rail-item]") : null)
    const id = item?.dataset.messageRailItem
    if (!id) return
    scrubbed.current = false
    scrubRef.current = { pointerId: event.pointerId, itemId: id }
    listRef.current?.setPointerCapture?.(event.pointerId)
    setScrubbing(true)
    openPreview(id)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const scrub = scrubRef.current
    if (!scrub) return
    const id = itemUnderPointer(event.clientY)?.dataset.messageRailItem
    if (!id || id === scrub.itemId) return
    scrubRef.current = { ...scrub, itemId: id }
    scrubbed.current = true
    setHotId(id)
    setPreviewId(id)
    anchorFor(id)
    onJump(id, "auto")
  }

  function endScrub() {
    const scrub = scrubRef.current
    if (!scrub) return
    scrubRef.current = undefined
    const list = listRef.current
    if (list?.hasPointerCapture?.(scrub.pointerId)) list.releasePointerCapture?.(scrub.pointerId)
    setScrubbing(false)
    // Pointer capture retargets the click to the list, so a press without a drag
    // jumps here; the button's click handler stays for keyboard activation.
    if (!scrubbed.current) {
      ignoreClick.current = true
      onJump(scrub.itemId, "smooth")
      window.setTimeout(() => { ignoreClick.current = false }, 0)
    }
  }

  const effectiveId = hotId ?? activeIds[0]
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !effectiveId) return
    const button = list.querySelector<HTMLElement>(`[data-message-rail-item="${escapeId(effectiveId)}"]`)
    if (!button) return
    const top = button.offsetTop
    if (top < list.scrollTop) list.scrollTop = top
    else if (top + button.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + button.offsetHeight - list.clientHeight + 1
    }
  }, [effectiveId, items.length])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const update = () => setScrollable((current) => {
      const next = list.scrollHeight > list.clientHeight + 1
      return current === next ? current : next
    })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(list)
    return () => observer.disconnect()
  }, [items.length])

  useLayoutEffect(() => {
    const card = cardRef.current
    const layer = layerRef.current
    if (!card || !layer) return
    const height = card.offsetHeight
    const max = Math.max(RAIL_MARGIN, layer.clientHeight - height - RAIL_MARGIN)
    const next = Math.min(max, Math.max(RAIL_MARGIN, anchorY - height / 2))
    setCardTop((current) => current === next ? current : next)
  })

  if (items.length < 4) return null

  const active = new Set(activeIds)
  const hotIndex = hotId == null ? -1 : items.findIndex((item) => item.id === hotId)
  const preview = previewId == null ? undefined : items.find((item) => item.id === previewId)
  const previewBookmarked = preview ? bookmarks.has(preview.id) : false

  function onLayerBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeNow()
  }

  function onLayerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || previewId == null) return
    event.stopPropagation()
    closeNow()
  }

  return (
    <div ref={layerRef} className="noa-message-rail-layer" onBlur={onLayerBlur} onKeyDown={onLayerKeyDown}>
      <nav aria-label="User messages" className="noa-message-rail">
        <div
          ref={listRef}
          className="noa-message-rail-list"
          data-scrubbing={scrubbing ? "true" : undefined}
          data-scrollable={scrollable ? "true" : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onLostPointerCapture={endScrub}
          onPointerLeave={leaveList}
          onScroll={() => { if (previewId != null) anchorFor(previewId) }}
        >
          {items.map((item, index) => {
            const distance = hotIndex === -1 ? -1 : Math.abs(index - hotIndex)
            const progress = NEIGHBOR_PROGRESS[distance] ?? 0
            const bookmarked = bookmarks.has(item.id)
            return (
              <button
                key={item.id}
                type="button"
                data-message-rail-item={item.id}
                aria-current={active.has(item.id) ? "true" : undefined}
                aria-label={bookmarked ? `Jump to user message ${index + 1}, bookmarked turn` : `Jump to user message ${index + 1}`}
                className="noa-message-rail-item"
                onPointerEnter={() => hoverItem(item.id)}
                onFocus={() => openPreview(item.id)}
                onClick={() => {
                  if (scrubbed.current) {
                    scrubbed.current = false
                    return
                  }
                  if (ignoreClick.current) {
                    ignoreClick.current = false
                    return
                  }
                  openPreview(item.id)
                  onJump(item.id, "smooth")
                }}
              >
                <span
                  className="noa-message-rail-marker"
                  data-active={active.has(item.id) && hotIndex === -1 ? "true" : undefined}
                  data-hot={item.id === hotId ? "true" : undefined}
                  data-bookmarked={bookmarked ? "true" : undefined}
                  style={{ "--marker-progress": progress } as CSSProperties}
                >
                  <span className="noa-message-rail-line" />
                  {bookmarked ? <span className="noa-message-rail-dot" aria-hidden="true" /> : null}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
      {preview ? (
        <div
          ref={cardRef}
          className="noa-message-rail-card"
          style={{ top: cardTop ?? anchorY }}
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleClose}
        >
          <div className="noa-message-rail-card-head">
            <span className="noa-message-rail-card-title">{preview.label}</span>
            <button
              type="button"
              aria-label={previewBookmarked ? "Remove bookmark" : "Bookmark turn"}
              aria-pressed={previewBookmarked}
              className="noa-message-rail-bookmark"
              onClick={(event) => {
                event.stopPropagation()
                setBookmarks((current) => {
                  const next = new Set(current)
                  if (next.has(preview.id)) next.delete(preview.id)
                  else next.add(preview.id)
                  return next
                })
              }}
            >
              {previewBookmarked ? <BookmarkFilled size={16} /> : <Bookmark size={16} />}
            </button>
          </div>
          {preview.preview ? <Markdown className="noa-message-rail-preview" text={preview.preview} /> : null}
        </div>
      ) : null}
    </div>
  )
}
