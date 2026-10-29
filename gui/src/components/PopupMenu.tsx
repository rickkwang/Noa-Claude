import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronRight } from "../lib/icons"

// The sidebar and composer dropdown: optional leading icons, section headings,
// a trailing check for the chosen option, and submenus that open beside their row.
export type PopupMenuEntry =
  | {
      kind?: "item"
      key?: string
      label: ReactNode
      icon?: ComponentType<{ size?: number; className?: string }>
      checked?: boolean
      disabled?: boolean
      onSelect?: () => void
      submenu?: PopupMenuEntry[]
    }
  | { kind: "separator"; key?: string }
  | { kind: "heading"; key?: string; label: ReactNode }

export type PopupMenuAnchor = { left: number; top: number; bottom: number }

export function anchorBelow(element: Element): PopupMenuAnchor {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.bottom + 4, bottom: rect.top - 4 }
}

export function PopupMenu({
  anchor,
  entries,
  label,
  onClose,
  trigger,
}: {
  anchor: PopupMenuAnchor
  entries: PopupMenuEntry[]
  label: string
  onClose: () => void
  // The button that opened the menu: pressing it again toggles the menu instead of reopening it.
  trigger?: Element | null
}) {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.top })
  const [open, setOpen] = useState<number>()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Below the trigger when it fits, otherwise above it; never past the window's edges.
  useLayoutEffect(() => {
    const menu = root.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    const below = anchor.top + height <= window.innerHeight - 8
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
      top: below ? anchor.top : Math.max(8, anchor.bottom - height),
    })
    menu.querySelector<HTMLElement>('[role="menu"]')?.focus()
  }, [anchor])

  useLayoutEffect(() => {
    const submenu = root.current?.querySelector<HTMLElement>(".is-submenu")
    if (!submenu) return
    submenu.removeAttribute("data-flip")
    if (submenu.getBoundingClientRect().right > window.innerWidth - 8) submenu.setAttribute("data-flip", "")
  }, [open])

  useEffect(() => {
    const press = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !trigger?.contains(target)) closeRef.current()
    }
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
    const close = () => closeRef.current()
    window.addEventListener("pointerdown", press, true)
    window.addEventListener("keydown", key, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("pointerdown", press, true)
      window.removeEventListener("keydown", key, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [trigger])

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    event.stopPropagation()
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(':scope > .noa-context-menu-entry > [role^="menuitem"]:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const step = event.key === "ArrowDown" ? 1 : items.length - 1
    items[index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1) : (index + step) % items.length]?.focus()
  }

  const list = (items: PopupMenuEntry[], nested: boolean): ReactNode => (
    <div role="menu" aria-label={nested ? undefined : label} tabIndex={-1} className={`noa-context-menu noa-popup-menu noa-floating-panel${nested ? " is-submenu" : ""}`} onKeyDown={onKey}>
      {items.map((entry, index) => {
        if (entry.kind === "separator") return <div key={entry.key ?? `separator-${index}`} role="separator" className="noa-context-menu-separator" />
        if (entry.kind === "heading") return <div key={entry.key ?? `heading-${index}`} role="presentation" className="noa-popup-menu-heading">{entry.label}</div>
        const Icon = entry.icon
        const hasSubmenu = !!entry.submenu
        return (
          <div
            key={entry.key ?? index}
            role="none"
            className="noa-context-menu-entry"
            onPointerEnter={() => !nested && setOpen(hasSubmenu ? index : undefined)}
          >
            <button
              type="button"
              role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={entry.checked}
              aria-haspopup={hasSubmenu ? "menu" : undefined}
              aria-expanded={hasSubmenu ? open === index : undefined}
              disabled={entry.disabled}
              onClick={() => {
                if (hasSubmenu) setOpen(open === index ? undefined : index)
                else {
                  onClose()
                  entry.onSelect?.()
                }
              }}
              onKeyDown={(event) => {
                if (hasSubmenu && (event.key === "ArrowRight" || event.key === "Enter")) {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(index)
                  const row = event.currentTarget.parentElement
                  requestAnimationFrame(() => row?.querySelector<HTMLElement>('.is-submenu [role^="menuitem"]')?.focus())
                } else if (nested && event.key === "ArrowLeft") {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(undefined)
                  root.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus()
                }
              }}
            >
              {Icon && <Icon size={16} className="noa-popup-menu-icon" />}
              <span className="noa-popup-menu-label">{entry.label}</span>
              {entry.checked && <Check size={14} className="noa-popup-menu-trailing" />}
              {hasSubmenu && <ChevronRight size={14} className="noa-popup-menu-trailing noa-popup-menu-chevron" />}
            </button>
            {hasSubmenu && open === index && list(entry.submenu!, true)}
          </div>
        )
      })}
    </div>
  )

  return createPortal(
    <div ref={root} className="noa-context-menu-root font-ui" style={position} onContextMenu={(event) => event.preventDefault()}>
      {list(entries, false)}
    </div>,
    document.body,
  )
}
