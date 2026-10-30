import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

// Replaces window.confirm with an in-app dialog. The promise settles on confirm,
// cancel, Escape or a backdrop click, so callers await a single boolean.
export function useConfirm() {
  const pendingRef = useRef<PendingConfirm | undefined>(undefined)
  const [pending, setPending] = useState<PendingConfirm>()

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false)
        const next = { ...options, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    pendingRef.current = undefined
    setPending(undefined)
    current?.resolve(confirmed)
  }, [])

  return {
    confirm,
    dialog: pending ? (
      <ConfirmDialog {...pending} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
    ) : null,
  }
}

function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  const titleId = useId()
  const descriptionId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Destructive dialogs start on Cancel, so Enter cannot discard work by reflex.
  useEffect(() => {
    ;(danger ? cancelRef.current : confirmRef.current)?.focus()
  }, [danger])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key !== "Tab") return
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  // Portalled to body so a masked/overflow-hidden panel cannot clip the dialog.
  return createPortal(
    <div
      className="noa-confirm-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={onKeyDown}
        className="noa-confirm-dialog w-full max-w-[440px] rounded-2xl bg-[var(--bg-card)] p-5 font-ui"
      >
        <h2 id={titleId} className="m-0 text-balance text-[length:var(--font-text-md-size)] font-medium text-[var(--text-primary)]">
          {title}
        </h2>
        {description && (
          <div id={descriptionId} className="mt-2 text-body leading-relaxed text-[var(--sidebar-text)]">
            {description}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="noa-confirm-btn h-7 rounded-md border border-[var(--divider-subtle)] px-3 text-body noa-press"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`noa-confirm-btn h-7 rounded-md px-3 text-body text-white noa-press ${
              danger ? "border border-transparent bg-[#D45555]" : "border border-transparent bg-[var(--accent-color)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
