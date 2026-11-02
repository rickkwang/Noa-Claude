import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import type { ImageBlock, QueuedMessage } from "../agent/protocol"
import { ArrowUpDown, Edit2, MoreHorizontal, Queue, Steer, Trash2 } from "../lib/icons"
import { Lightbox, type LightboxItem } from "./Lightbox"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "./PopupMenu"

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
  const [menu, setMenu] = useState<{ id: string; anchor: PopupMenuAnchor; trigger: Element }>()
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
    <section aria-label="Queued messages" className="noa-queued-messages flex max-h-[30dvh] flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)]">
      <span className="sr-only">{messages.length} queued</span>
      {paused && <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-[var(--divider-subtle)] px-3 text-[length:var(--text-chat-sm)]">
        <Queue size={16} className="shrink-0 text-[var(--text-tertiary)]" />
        <span className="min-w-0 flex-1">Queue paused</span>
        <button type="button" disabled={editing} onClick={() => { onPaused(false); if (!busy) onRun() }} className="rounded-md px-2 py-1 hover:bg-[var(--fill-hover)] disabled:opacity-40">Resume</button>
      </div>}
      <div className="scrollbar-on-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-1">
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
              className={`group/queue flex min-h-9 items-center gap-2 rounded-md py-0.5 text-[length:var(--text-chat-sm)] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] ${dragId === message.id ? "opacity-50" : ""}`}
            >
              <span className="relative flex size-5 shrink-0 cursor-grab items-center justify-center text-[var(--text-tertiary)]">
                <Queue size={16} className="group-hover/queue:opacity-0 group-focus-within/queue:opacity-0" />
                <ArrowUpDown size={13} className="absolute opacity-0 group-hover/queue:opacity-100 group-focus-within/queue:opacity-100" />
              </span>
              <div className="min-w-0 flex-1">
                {content.text && <p title={content.text} className="m-0 truncate">{content.text}</p>}
                {!!images.length && (
                  <div className="mt-1 flex gap-1 overflow-x-auto">
                    {images.map((image, imageIndex) => (
                      <button
                        key={imageIndex}
                        type="button"
                        aria-label={`Preview ${image.alt}`}
                        onClick={() => setPreview({ items: images, index: imageIndex })}
                        className="size-9 shrink-0 overflow-hidden rounded-md border border-[var(--border-default)] cursor-zoom-in"
                      >
                        <img src={image.src} alt={image.alt} className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" disabled={editing} aria-label={busy ? "Steer current turn with queued message" : "Send queued message now"} title={busy ? "Submit without interrupting the model" : "Send now"} onClick={() => busy ? onSteer(message.id) : onRetry(message.id)} className="flex h-7 items-center gap-1 rounded-md px-2 hover:bg-[var(--fill-hover)] disabled:opacity-40">
                  <Steer size={14} />{busy ? "Steer" : "Send now"}
                </button>
                <button type="button" aria-label="Delete queued message" title="Delete" onClick={() => remove(message, index)} className="flex size-6 items-center justify-center rounded-md hover:bg-[var(--fill-hover)]">
                  <Trash2 size={14} />
                </button>
                <button type="button" aria-label="More queued message actions" aria-haspopup="menu" aria-expanded={menu?.id === message.id} onClick={event => setMenu(menu?.id === message.id ? undefined : { id: message.id, anchor: anchorBelow(event.currentTarget), trigger: event.currentTarget })} className="flex size-6 items-center justify-center rounded-md hover:bg-[var(--fill-hover)]">
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {menu && messages.some(message => message.id === menu.id) && <PopupMenu anchor={menu.anchor} trigger={menu.trigger} label="Queued message actions" onClose={() => setMenu(undefined)} entries={[
        { key: "edit", label: "Edit", icon: Edit2, onSelect: () => onEdit(messages.find(message => message.id === menu.id)!) },
        { key: "next", label: "Send next", disabled: editing, onSelect: () => onRetry(menu.id) },
        { key: "pause", label: paused ? "Resume queue" : "Pause queue", disabled: editing, onSelect: () => { onPaused(!paused); if (paused && !busy) onRun() } },
      ]} />}
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
