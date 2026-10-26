import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import type { ImageBlock, QueuedMessage } from "../agent/protocol"
import { ArrowRight, ArrowUpDown, Edit2, X } from "../lib/icons"
import { Lightbox, type LightboxItem } from "./Lightbox"

interface QueuedMessagesProps {
  messages: QueuedMessage[]
  busy: boolean
  paused: boolean
  editing?: boolean
  onMove: (id: string, toIndex: number) => void
  onRemove: (id: string) => void
  onEdit: (message: QueuedMessage) => void
  onSteer: (id: string) => void
  onRetry: (id: string) => void
  onRun: () => void
  onPaused: (paused: boolean) => void
}

function parts(message: QueuedMessage) {
  if (typeof message.content === "string") return { text: message.content, images: [] as ImageBlock[] }
  return {
    text: message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"),
    images: message.content.filter((block): block is ImageBlock => block.type === "image"),
  }
}

export function QueuedMessages({
  messages,
  busy,
  paused,
  editing,
  onMove,
  onRemove,
  onEdit,
  onSteer,
  onRetry,
  onRun,
  onPaused,
}: QueuedMessagesProps) {
  const [dragId, setDragId] = useState<string>()
  const [exiting, setExiting] = useState<Record<string, { message: QueuedMessage; beforeId?: string }>>({})
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number }>()
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
  }, [])

  function remove(message: QueuedMessage, index: number) {
    if (timers.current.has(message.id)) return
    setExiting((items) => ({
      ...items,
      [message.id]: { message, beforeId: messages[index + 1]?.id },
    }))
    onRemove(message.id)
    timers.current.set(message.id, setTimeout(() => {
      timers.current.delete(message.id)
      setExiting((items) => {
        const next = { ...items }
        delete next[message.id]
        return next
      })
    }, 180))
  }

  const visible = mergeExitingMessages(messages, exiting)

  function drop(event: DragEvent, index: number) {
    event.preventDefault()
    if (dragId) onMove(dragId, index)
    setDragId(undefined)
  }

  function keyboard(event: KeyboardEvent, index: number) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
    event.preventDefault()
    const next = index + (event.key === "ArrowUp" ? -1 : 1)
    if (next >= 0 && next < messages.length) onMove(messages[index]!.id, next)
  }

  return (
    <section aria-label="Queued messages" className="flex max-h-[30dvh] flex-col overflow-hidden rounded-panel border border-[var(--divider-subtle)] bg-[var(--bg-card)]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--divider-subtle)] px-3 text-caption text-[var(--sidebar-text-muted)]">
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {visible.length} queued · {paused ? "paused" : busy ? "sends after this turn" : "ready to send"}
        </span>
        {(busy || paused) && (
          <button
            type="button"
            disabled={editing}
            onClick={() => {
              if (paused) {
                onPaused(false)
                if (!busy) onRun()
              } else onPaused(true)
            }}
            className="rounded px-1.5 py-0.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] hover:text-[var(--text-primary)]"
          >
            {paused ? "Resume" : "Pause"}
          </button>
        )}
        {!busy && !paused && (
          <button type="button" disabled={editing} onClick={onRun} className="rounded px-1.5 py-0.5 text-[var(--accent-color)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
            Send next
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {visible.map((message, index) => {
          const content = parts(message)
          const images = content.images.map((image, imageIndex) => ({
            src: `data:${image.source.media_type};base64,${image.source.data}`,
            alt: `Queued image ${imageIndex + 1}`,
          }))
          return (
            <div
              key={message.id}
              draggable
              onDragStart={() => setDragId(message.id)}
              onDragEnd={() => setDragId(undefined)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, index)}
              onKeyDown={(event) => keyboard(event, index)}
              tabIndex={0}
              data-exiting={exiting[message.id] ? true : undefined}
              className={`group/queue flex min-h-9 items-start gap-2 rounded-md px-2 py-1.5 text-body outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] ${dragId === message.id ? "opacity-50" : "hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"}`}
            >
              <ArrowUpDown size={13} className="mt-1 shrink-0 cursor-grab text-[var(--sidebar-text-muted)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {content.text && <p className="m-0 line-clamp-2 whitespace-pre-wrap break-words">{content.text}</p>}
                {!!images.length && (
                  <div className="mt-1 flex gap-1 overflow-x-auto">
                    {images.map((image, imageIndex) => (
                      <button
                        key={imageIndex}
                        type="button"
                        aria-label={`Preview ${image.alt}`}
                        onClick={() => setPreview({ items: images, index: imageIndex })}
                        className="size-9 shrink-0 overflow-hidden rounded-md border border-[var(--divider-subtle)] cursor-zoom-in"
                      >
                        <img src={image.src} alt={image.alt} className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/queue:opacity-100 group-focus-within/queue:opacity-100">
                {busy && (
                  <button type="button" disabled={editing} aria-label="Steer current turn with queued message" title="Steer now" onClick={() => onSteer(message.id)} className="rounded p-1 hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]">
                    <ArrowRight size={13} />
                  </button>
                )}
                <button type="button" aria-label="Edit queued message" title="Edit" onClick={() => onEdit(message)} className="rounded p-1 hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]">
                  <Edit2 size={13} />
                </button>
                <button type="button" disabled={editing} aria-label="Send queued message next" title="Send next" onClick={() => onRetry(message.id)} className="rounded px-1 py-0.5 text-caption hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]">
                  Send next
                </button>
                <button type="button" aria-label="Delete queued message" title="Delete" onClick={() => remove(message, index)} className="rounded p-1 hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]">
                  <X size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {preview && <Lightbox items={preview.items} index={preview.index} onIndex={(index) => setPreview({ ...preview, index })} onClose={() => setPreview(undefined)} />}
    </section>
  )
}

function mergeExitingMessages(
  messages: QueuedMessage[],
  exiting: Record<string, { message: QueuedMessage; beforeId?: string }>,
) {
  const rows = [...messages]
  const pending = new Map(Object.entries(exiting).filter(([id]) => !messages.some((message) => message.id === id)))
  while (pending.size > 0) {
    let inserted = false
    for (const [id, entry] of pending) {
      const index = entry.beforeId === undefined
        ? rows.length
        : rows.findIndex((message) => message.id === entry.beforeId)
      if (index === -1) continue
      rows.splice(index, 0, entry.message)
      pending.delete(id)
      inserted = true
    }
    if (!inserted) {
      for (const entry of pending.values()) rows.push(entry.message)
      break
    }
  }
  return rows
}
