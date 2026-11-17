import { useEffect, useRef, useState, type ComponentType, type PointerEvent, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Plus, X } from "../lib/icons"

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
  onNew: () => void
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

// The bottom and right panels' tab strip: tabs share the width between 90px and 240px and scroll past that.
// The new-tab button follows the last tab outside the scroller, and a hairline divides two unselected tabs.
export function PanelTabStrip({ tabs, activeKey, label, onSelect, onClose, onContextMenu, onNew, newLabel, trailing, className = "", style, controlStyle, onReorder }: PanelTabStripProps) {
  const listRef = useRef<HTMLDivElement>(null)
  // Pointer drag along the strip: the held tab follows the pointer, the others slide aside, and the order commits on release.
  const [drag, setDrag] = useState<{ key: string; dx: number; target: number; settling?: boolean }>()
  const dragStart = useRef<{ key: string; x: number; index: number; lefts: number[]; widths: number[]; moved: boolean }>(undefined)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>, key: string) => {
    if (!onReorder || event.button !== 0 || (event.target as HTMLElement).closest(".noa-tab-close")) return
    const items = [...(listRef.current?.children ?? [])] as HTMLElement[]
    dragStart.current = { key, x: event.clientX, index: tabs.findIndex((tab) => tab.key === key), lefts: items.map((item) => item.offsetLeft), widths: items.map((item) => item.offsetWidth), moved: false }
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
      if (drag.target !== index) onReorder?.(start.key, tabs[drag.target]!.key)
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
  // A tab that becomes active scrolls fully into view (clear of the 28px edge-fade mask) when
  // the strip overflows, and the fade mask ramps strictly from actual scrollLeft/maxScroll.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const FADE_PAD = 28
    const updateFade = () => {
      const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth)
      const left = maxScroll <= 0 ? 0 : Math.min(1, Math.max(0, list.scrollLeft / FADE_PAD))
      const right = maxScroll <= 0 ? 0 : Math.min(1, Math.max(0, (maxScroll - list.scrollLeft) / FADE_PAD))
      list.style.setProperty("--noa-fade-left", String(left))
      list.style.setProperty("--noa-fade-right", String(right))
    }
    const ensureActiveVisible = () => {
      const tab = activeKey ? list.querySelector<HTMLElement>(`[data-tab="${CSS.escape(activeKey)}"]`) : null
      if (tab && list.clientWidth > 0) {
        const start = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft
        const end = start + tab.offsetWidth
        const padLeft = start > 0 ? FADE_PAD : 0
        const padRight = end < list.scrollWidth ? FADE_PAD : 0
        if (start - padLeft < list.scrollLeft) list.scrollLeft = Math.max(0, start - padLeft)
        else if (end + padRight > list.scrollLeft + list.clientWidth) list.scrollLeft = Math.min(list.scrollWidth - list.clientWidth, end + padRight - list.clientWidth)
      }
      updateFade()
    }
    ensureActiveVisible()
    list.addEventListener("scroll", updateFade, { passive: true })
    const observer = new ResizeObserver(ensureActiveVisible)
    observer.observe(list)
    return () => {
      list.removeEventListener("scroll", updateFade)
      observer.disconnect()
    }
  }, [activeKey, tabs.length])
  // Arrow keys move between tabs, as in a WAI-ARIA tablist.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || tabs.length === 0) return
    event.preventDefault()
    const index = Math.max(0, tabs.findIndex((tab) => tab.key === activeKey))
    const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
    if (!next) return
    onSelect(next.key)
    const element = event.currentTarget.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.key)}"]`)
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
  }
  return (
    <div className={`flex shrink-0 items-center gap-1.5 select-none ${className}`} style={style}>
      <div className="@container flex h-full min-w-0 flex-1 items-center ps-3">
        <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="noa-edge-fade-x hide-scrollbar flex h-full min-w-0 flex-initial items-center overflow-x-auto">
          {tabs.map((tab, index) => {
            const selected = tab.key === activeKey
            const divided = index < tabs.length - 1 && !selected && tabs[index + 1]!.key !== activeKey
            const Icon = tab.icon
            return (
              // The width wrapper keeps 2px after each tab, where the divider sits.
              <div
                key={tab.key}
                className="relative flex shrink-0 items-center"
                onPointerDown={(event) => onPointerDown(event, tab.key)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onClickCapture={(event) => { if (drag) event.stopPropagation() }}
                style={{
                  width: `clamp(90px, calc((100cqw - 34px) / ${tabs.length}), 240px)`,
                  transform: drag ? `translateX(${shiftOf(index)}px)` : undefined,
                  transition: drag && (drag.key !== tab.key || drag.settling) ? "transform 180ms cubic-bezier(0.2, 0, 0, 1)" : undefined,
                  zIndex: drag?.key === tab.key ? 20 : undefined,
                }}
              >
                <div className="flex min-w-0 flex-1 items-center pe-0.5">
                  <div
                    className="group/tab relative flex h-8 min-w-0 flex-1 items-center rounded-lg"
                    style={controlStyle}
                    onContextMenu={onContextMenu ? (event) => { event.preventDefault(); onContextMenu(tab.key, event) } : undefined}
                  >
                    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-0 rounded-lg border-[0.5px] ${selected ? "border-transparent bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]" : "border-transparent group-hover/tab:bg-[var(--fill-hover)]"}`} />
                    <button
                      type="button"
                      role="tab"
                      data-tab={tab.key}
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      title={tab.title}
                      onClick={() => onSelect(tab.key)}
                      onAuxClick={(event) => { if (event.button === 1) onClose(tab.key) }}
                      className={`relative z-10 flex h-full min-w-0 flex-1 items-center rounded-md py-1 ps-[9px] pe-1 text-start text-[length:var(--text-chat-sm)] ${selected ? "text-[var(--text-primary,#2D2D2B)]" : "text-[var(--text-tertiary,#A3A19B)]"}`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 group-focus-within/tab:pe-5 group-hover/tab:pe-5">
                        <Icon size={14} className="shrink-0" />
                        <span className="noa-tab-title">{tab.title}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Close ${tab.title} tab`}
                      onClick={() => onClose(tab.key)}
                      className="noa-tab-close pointer-events-none absolute end-[7px] top-1/2 z-30 flex size-5 -translate-y-1/2 items-center justify-center rounded-md opacity-0 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <span aria-hidden="true" className={`absolute end-0 h-3 w-px bg-[var(--border-default)] ${divided ? "opacity-100" : "opacity-0"}`} />
              </div>
            )
          })}
        </div>
        <div className={`flex shrink-0 items-center ${tabs.length > 0 ? "ps-1.5" : "ps-1"}`}>
          <button
            type="button"
            aria-label={newLabel}
            title={newLabel}
            onClick={onNew}
            style={controlStyle}
            className="noa-terminal-action flex size-7 shrink-0 items-center justify-center rounded-[10px]"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {trailing}
    </div>
  )
}
