import { useEffect, useRef, type ComponentType, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
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
}

// The bottom and right panels' tab strip: tabs share the width between 90px and 240px and scroll past that.
// The new-tab button follows the last tab outside the scroller, and a hairline divides two unselected tabs.
export function PanelTabStrip({ tabs, activeKey, label, onSelect, onClose, onContextMenu, onNew, newLabel, trailing, className = "", style, controlStyle }: PanelTabStripProps) {
  const listRef = useRef<HTMLDivElement>(null)
  // A tab that becomes active scrolls fully into view when the strip overflows. Only the strip scrolls:
  // scrollIntoView would also scroll clipped ancestors, shifting the whole app while a panel is hidden.
  useEffect(() => {
    const list = listRef.current
    const tab = activeKey ? list?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(activeKey)}"]`) : null
    if (!list || !tab) return
    const start = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft
    const end = start + tab.offsetWidth
    if (start < list.scrollLeft) list.scrollLeft = start
    else if (end > list.scrollLeft + list.clientWidth) list.scrollLeft = end - list.clientWidth
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
      <div className="@container flex h-full min-w-0 flex-1 items-center ps-2">
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
                style={{ width: `clamp(90px, calc((100cqw - 34px) / ${tabs.length}), 240px)` }}
              >
                <div className="flex min-w-0 flex-1 items-center pe-0.5">
                  <div
                    className="group/tab relative flex h-8 min-w-0 flex-1 items-center rounded-lg"
                    style={controlStyle}
                    onContextMenu={onContextMenu ? (event) => { event.preventDefault(); onContextMenu(tab.key, event) } : undefined}
                  >
                    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-0 rounded-md border-[0.5px] ${selected ? "noa-panel-tab-selected border-[var(--border-default)] shadow-[0_1px_2px_-1px_#00000014]" : "border-transparent group-hover/tab:bg-[var(--fill-hover)]"}`} />
                    <button
                      type="button"
                      role="tab"
                      data-tab={tab.key}
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      title={tab.title}
                      onClick={() => onSelect(tab.key)}
                      onAuxClick={(event) => { if (event.button === 1) onClose(tab.key) }}
                      className={`relative z-10 flex h-full min-w-0 flex-1 items-center rounded-md py-1 ps-2.5 pe-1 text-start text-[length:var(--text-chat-sm)] ${selected ? "text-[var(--text-primary,#2D2D2B)]" : "text-[var(--text-tertiary,#A3A19B)]"}`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2 group-focus-within/tab:pe-5 group-hover/tab:pe-5">
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
