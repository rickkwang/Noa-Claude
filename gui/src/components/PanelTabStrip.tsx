import { useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { ChevronDown, Plus, X } from "../lib/icons"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "./PopupMenu"

export interface PanelTab {
  key: string
  title: string
  icon: ComponentType<{ size?: number; className?: string }>
}

interface PanelTabStripProps {
  tabs: PanelTab[]
  activeKey?: string
  label: string
  onSelect: (key: string) => void
  onClose: (key: string) => void
  onContextMenu?: (key: string, event: MouseEvent) => void
  onNew: (button: HTMLElement) => void
  newLabel: string
  // Panel controls after the strip; they never shrink with the tabs.
  trailing?: ReactNode
  className?: string
  style?: CSSProperties
  // Interactive parts opt out of a window-drag strip.
  controlStyle?: CSSProperties
  // Dragging a tab onto another moves it to that tab's place.
  onReorder?: (from: string, to: string) => void
}

// Fitting tabs into the strip: a title stops at TITLE_MAX; around it a tab has 14px + 16px icon + 6px before the title,
// a 30px close seat and a 3px gap; long tabs shrink to TAB_FLOOR. The row keeps 3px + 8px of inset and 32px for each control.
const TITLE_MAX = 140
const TAB_CHROME = 14 + 16 + 6 + 30 + 3
const TAB_FLOOR = 112
const ROW_INSET = 3 + 8
const CONTROL_WIDTH = 28 + 4
const measureCanvas = document.createElement("canvas")

// The bottom and right panels' tab strip: each tab is as wide as its icon, title and close button (always shown on
// the selected tab, on hover elsewhere). Tabs that don't fit go into a "More tabs" menu; the new-tab button follows
// the last visible tab. The selected tab is a raised plate.
export function PanelTabStrip({ tabs, activeKey, label, onSelect, onClose, onContextMenu, onNew, newLabel, trailing, className = "", style, controlStyle, onReorder }: PanelTabStripProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const shown = tabs.filter((tab) => !hidden.includes(tab.key))
  const [moreMenu, setMoreMenu] = useState<{ anchor: PopupMenuAnchor; trigger: Element }>()
  // Pointer drag along the strip: the held tab follows the pointer, the others slide aside, and the order commits on release.
  const [drag, setDrag] = useState<{ key: string; dx: number; target: number; settling?: boolean }>()
  const dragStart = useRef<{ key: string; x: number; index: number; lefts: number[]; widths: number[]; moved: boolean }>(undefined)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>, key: string) => {
    if (!onReorder || event.button !== 0 || (event.target as HTMLElement).closest(".noa-tab-close")) return
    const items = [...(listRef.current?.children ?? [])] as HTMLElement[]
    dragStart.current = { key, x: event.clientX, index: shown.findIndex((tab) => tab.key === key), lefts: items.map((item) => item.offsetLeft), widths: items.map((item) => item.offsetWidth), moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    if (!start || drag?.settling) return
    // A press released off the strip never reached onPointerUp.
    if (event.buttons === 0 && !start.moved) { dragStart.current = undefined; return }
    let dx = event.clientX - start.x
    if (!start.moved) {
      if (Math.abs(dx) < 4) return
      start.moved = true
      // The held tab is shown while it moves.
      if (start.key !== activeKey) onSelect(start.key)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const { index, lefts, widths } = start
    const last = lefts.length - 1
    dx = Math.max(lefts[0]! - lefts[index]!, Math.min(lefts[last]! + widths[last]! - widths[index]! - lefts[index]!, dx))
    // A neighbor gives way once the held tab's leading edge passes its middle, so the ends are reachable.
    const left = lefts[index]! + dx
    const right = left + widths[index]!
    const middle = (i: number) => lefts[i]! + widths[i]! / 2
    const target = index + lefts.filter((_, i) => i > index && right > middle(i)).length - lefts.filter((_, i) => i < index && left < middle(i)).length
    setDrag({ key: start.key, dx, target })
  }
  const onPointerUp = () => {
    const start = dragStart.current
    if (drag?.settling) return
    dragStart.current = undefined
    if (!start?.moved || !drag) return
    // The held tab glides into its slot before the order commits.
    const { index, lefts } = start
    const slot = drag.target > index ? lefts[drag.target]! + start.widths[drag.target]! - start.widths[index]! - lefts[index]! : lefts[drag.target]! - lefts[index]!
    dragStart.current = { ...start, moved: true }
    setDrag({ ...drag, dx: slot, settling: true })
    window.setTimeout(() => {
      dragStart.current = undefined
      setDrag(undefined)
      if (drag.target !== index) onReorder?.(start.key, shown[drag.target]!.key)
    }, 180)
  }
  // The shift a tab takes while another is dragged across it.
  const shiftOf = (index: number) => {
    const start = dragStart.current
    if (!drag || !start) return 0
    if (index === start.index) return drag.dx
    const width = start.widths[start.index]!
    if (start.index < index && index <= drag.target) return -width
    if (drag.target <= index && index < start.index) return width
    return 0
  }
  // Tabs shrink to their floor first; those that still don't fit move into the "More tabs" menu, never the selected one.
  useLayoutEffect(() => {
    const row = rowRef.current
    const list = listRef.current
    if (!row || !list) return
    const fit = () => {
      const title = list.querySelector<HTMLElement>(".noa-tab-title")
      const context = measureCanvas.getContext("2d")
      if (!title || !context || row.clientWidth === 0) return
      context.font = getComputedStyle(title).font
      // A tab's floor: its whole width when that is under 7rem, else 7rem; each includes the 3px gap after it.
      const least = tabs.map((tab) => Math.min(Math.ceil(Math.min(context.measureText(tab.title).width, TITLE_MAX)) + TAB_CHROME, TAB_FLOOR))
      const room = row.clientWidth - ROW_INSET - CONTROL_WIDTH
      const total = least.reduce((sum, width) => sum + width, 0)
      let next: string[] = []
      if (total > room) {
        const space = room - CONTROL_WIDTH
        const visible: number[] = []
        let used = 0
        for (const [index, width] of least.entries()) {
          if (used + width > space) break
          visible.push(index)
          used += width
        }
        const active = tabs.findIndex((tab) => tab.key === activeKey)
        if (active >= 0 && !visible.includes(active)) {
          while (visible.length > 0 && used + least[active]! > space) used -= least[visible.pop()!]!
          visible.push(active)
        }
        next = tabs.filter((_, index) => !visible.includes(index)).map((tab) => tab.key)
      }
      setHidden((current) => current.join("\n") === next.join("\n") ? current : next)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(row)
    return () => observer.disconnect()
  }, [activeKey, tabs.map((tab) => `${tab.key}\t${tab.title}`).join("\n")])
  // A title cut off by its maximum width or by a shrunken tab fades out at the end.
  useLayoutEffect(() => {
    for (const title of listRef.current?.querySelectorAll<HTMLElement>(".noa-tab-title") ?? []) title.toggleAttribute("data-overflow", title.scrollWidth > title.clientWidth)
  })
  // Arrow keys move between tabs, as in a WAI-ARIA tablist.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || tabs.length === 0) return
    event.preventDefault()
    const index = Math.max(0, tabs.findIndex((tab) => tab.key === activeKey))
    const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
    if (!next) return
    onSelect(next.key)
    // A tab from the "More tabs" menu joins the strip on the next render, so focus waits a frame.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.key)}"]`)?.focus({ preventScroll: true }))
  }
  return (
    <div className={`flex shrink-0 items-center gap-1.5 select-none ${className}`} style={style}>
      {/* With the list's 4px inline padding the first plate sits 7px from the panel edge. */}
      <div ref={rowRef} className="flex h-full min-w-0 flex-1 items-center ps-[3px]">
        {/* The 4px inline padding keeps the plate's shadow inside the list, which clips it. */}
        <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex h-full min-w-0 flex-initial items-center overflow-hidden px-1">
          {shown.map((tab, index) => {
            const selected = tab.key === activeKey
            const Icon = tab.icon
            return (
              // The wrapper keeps 3px between tabs. Long tabs shrink to 7rem before any move to the menu; shorter ones keep their width.
              <div
                key={tab.key}
                className="relative isolate flex min-w-[7rem] items-center data-[short]:min-w-max"
                ref={(element) => {
                  const title = element?.querySelector<HTMLElement>(".noa-tab-title")
                  if (element && title) element.toggleAttribute("data-short", element.offsetWidth - title.clientWidth + title.scrollWidth <= 112)
                }}
                onPointerDown={(event) => onPointerDown(event, tab.key)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onClickCapture={(event) => { if (drag) event.stopPropagation() }}
                style={{
                  transform: drag ? `translateX(${shiftOf(index)}px)` : undefined,
                  transition: drag && (drag.key !== tab.key || drag.settling) ? "transform 180ms cubic-bezier(0.2, 0, 0, 1)" : undefined,
                  zIndex: drag?.key === tab.key ? 20 : undefined,
                }}
              >
                <div className="flex min-w-0 flex-1 items-center pe-[3px]">
                  <div
                    className="group/tab relative flex h-8 min-w-0 flex-1 items-center rounded-lg"
                    style={controlStyle}
                    onContextMenu={onContextMenu ? (event) => { event.preventDefault(); onContextMenu(tab.key, event) } : undefined}
                  >
                    <div aria-hidden="true" data-selected={selected || undefined} className="noa-tab-plate pointer-events-none absolute inset-0 z-0 rounded-[inherit] border border-transparent group-hover/tab:bg-[var(--fill-hover)]" />
                    <button
                      type="button"
                      role="tab"
                      data-tab={tab.key}
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      title={tab.title}
                      onClick={() => onSelect(tab.key)}
                      onAuxClick={(event) => { if (event.button === 1) onClose(tab.key) }}
                      className={`relative z-10 flex h-full min-w-0 flex-1 items-center rounded-[inherit] ps-[14px] pe-[30px] text-start text-[length:var(--text-chat-sm)] ${selected ? "text-[var(--text-primary,#2D2D2B)]" : "text-[var(--text-secondary,#60605E)] hover:text-[var(--text-primary,#2D2D2B)]"}`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <Icon size={16} className="shrink-0" />
                        <span className="noa-tab-title">{tab.title}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Close ${tab.title} tab`}
                      onClick={() => onClose(tab.key)}
                      className={`noa-tab-close absolute end-[5px] top-1/2 z-30 flex size-[22px] -translate-y-1/2 items-center justify-center rounded-md ${selected ? "" : "pointer-events-none opacity-0"} group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hidden.length > 0 && (
            <button
              type="button"
              aria-label="More tabs"
              title="More tabs"
              aria-haspopup="menu"
              aria-expanded={!!moreMenu}
              onClick={(event) => setMoreMenu(moreMenu ? undefined : { anchor: anchorBelow(event.currentTarget), trigger: event.currentTarget })}
              style={controlStyle}
              className="noa-terminal-action flex size-7 shrink-0 items-center justify-center rounded-[10px]"
            >
              <ChevronDown size={16} />
            </button>
          )}
          <button
            type="button"
            aria-label={newLabel}
            title={newLabel}
            onClick={(event) => onNew(event.currentTarget)}
            style={controlStyle}
            className="noa-terminal-action flex size-7 shrink-0 items-center justify-center rounded-[10px]"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {trailing}
      {moreMenu && (
        <PopupMenu
          anchor={moreMenu.anchor}
          trigger={moreMenu.trigger}
          label="More tabs"
          minWidth={180}
          onClose={() => setMoreMenu(undefined)}
          entries={tabs.filter((tab) => hidden.includes(tab.key)).map((tab) => ({ key: tab.key, label: tab.title, icon: tab.icon, onSelect: () => onSelect(tab.key), onRemove: () => { if (hidden.length === 1) setMoreMenu(undefined); onClose(tab.key) }, removeLabel: `Close ${tab.title} tab` }))}
        />
      )}
    </div>
  )
}
