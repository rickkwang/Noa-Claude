import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronRight, Search, X } from "../lib/icons"

// The sidebar and composer dropdown: optional leading icons, section headings,
// a trailing check for the chosen option, and submenus that open beside their row.
type PopupMenuEntry =
  | {
      kind?: "item"
      key?: string
      label: ReactNode
      leading?: ReactNode
      searchText?: string
      icon?: ComponentType<{ size?: number; className?: string }>
      checked?: boolean
      disabled?: boolean
      danger?: boolean
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
  scrollable,
  minWidth,
  searchable,
  searchPlaceholder,
}: {
  anchor: PopupMenuAnchor
  entries: PopupMenuEntry[]
  label: string
  onClose: () => void
  // The button that opened the menu: pressing it again toggles the menu instead of reopening it.
  trigger?: Element | null
  scrollable?: boolean
  minWidth?: number
  searchable?: boolean
  searchPlaceholder?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: anchor.left, top: anchor.top })
  const [open, setOpen] = useState<number>()
  const [query, setQuery] = useState("")
  const queryRef = useRef("")
  queryRef.current = query
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = searchable && normalizedQuery
    ? entries.filter((entry) => {
        if (entry.kind === "separator" || entry.kind === "heading") return false
        const haystack = (entry.searchText ?? (typeof entry.label === "string" ? entry.label : "")).toLowerCase()
        return haystack.includes(normalizedQuery)
      })
    : entries

  // Below the trigger when it fits, otherwise above it; never past the window's edges.
  useLayoutEffect(() => {
    const menu = root.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    const below = anchor.top + height <= window.innerHeight - 8
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
    setPosition(
      below
        ? { left, top: anchor.top }
        : { left, bottom: Math.max(8, window.innerHeight - anchor.bottom) },
    )
    const checkedItem = menu.querySelector<HTMLElement>('[aria-checked="true"]')
    if ((scrollable || searchable) && checkedItem) checkedItem.scrollIntoView({ block: "nearest" })
    if (searchable) searchInputRef.current?.focus()
    else menu.querySelector<HTMLElement>('[role="menu"]')?.focus()
  }, [anchor, scrollable, searchable])

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
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      event.stopPropagation()
      if (searchable && queryRef.current) {
        setQuery("")
        searchInputRef.current?.focus()
        return
      }
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
  }, [trigger, searchable])

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    if (searchable && document.activeElement === searchInputRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const hasScrollContainer = !event.currentTarget.classList.contains("is-submenu") && !!event.currentTarget.querySelector(":scope > .noa-popup-menu-scroll")
    const selector = hasScrollContainer
      ? ':scope > .noa-popup-menu-scroll > .noa-context-menu-entry > [role^="menuitem"]:not(:disabled)'
      : ':scope > .noa-context-menu-entry > [role^="menuitem"]:not(:disabled)'
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (searchable && event.key === "ArrowUp" && index === 0) {
      searchInputRef.current?.focus()
      return
    }
    const step = event.key === "ArrowDown" ? 1 : items.length - 1
    items[index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1) : (index + step) % items.length]?.focus()
  }

  const list = (items: PopupMenuEntry[], nested: boolean): ReactNode => {
    const renderedItems = items.map((entry, index) => {
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
            data-danger={entry.danger ? "" : undefined}
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
            {entry.leading}
            <span className="noa-popup-menu-label">{entry.label}</span>
            {entry.checked && <Check size={14} className="noa-popup-menu-trailing" />}
            {hasSubmenu && <ChevronRight size={14} className="noa-popup-menu-trailing noa-popup-menu-chevron" />}
          </button>
          {hasSubmenu && open === index && list(entry.submenu!, true)}
        </div>
      )
    })

    const useScroll = !nested && (scrollable || searchable)

    return (
      <div
        role="menu"
        aria-label={nested ? undefined : label}
        tabIndex={-1}
        style={!nested && minWidth ? { minWidth } : undefined}
        className={`noa-context-menu noa-popup-menu noa-floating-panel${nested ? " is-submenu" : ""}`}
        onKeyDown={onKey}
      >
        {!nested && searchable && (
          <div className="mb-1 flex items-center gap-1.5 border-b border-[var(--divider-subtle)] px-2 py-1.5">
            <Search size={13} className="shrink-0 text-[var(--sidebar-text-muted)]" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              placeholder={searchPlaceholder ?? "Search…"}
              aria-label={searchPlaceholder ?? "Search options"}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  event.stopPropagation()
                  root.current?.querySelector<HTMLElement>('.noa-popup-menu-scroll > .noa-context-menu-entry > [role^="menuitem"]:not(:disabled)')?.focus()
                } else if (event.key === "Enter") {
                  const first = items.find(
                    (entry): entry is Extract<PopupMenuEntry, { kind?: "item" }> =>
                      entry.kind !== "separator" && entry.kind !== "heading" && !entry.disabled && !entry.submenu,
                  )
                  if (first) {
                    event.preventDefault()
                    event.stopPropagation()
                    onClose()
                    first.onSelect?.()
                  }
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-caption text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => {
                  setQuery("")
                  searchInputRef.current?.focus()
                }}
                className="flex size-4 shrink-0 items-center justify-center rounded text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
        {useScroll ? (
          <div className={`noa-popup-menu-scroll${searchable ? " is-searchable" : ""}`}>
            {renderedItems.length ? renderedItems : (
              <div className="px-2 py-2 text-caption text-[var(--sidebar-text-muted)]">No matches</div>
            )}
          </div>
        ) : (
          renderedItems
        )}
      </div>
    )
  }

  return createPortal(
    <div ref={root} className="noa-context-menu-root font-ui" style={position} onContextMenu={(event) => event.preventDefault()}>
      {list(filteredEntries, false)}
    </div>,
    document.body,
  )
}
