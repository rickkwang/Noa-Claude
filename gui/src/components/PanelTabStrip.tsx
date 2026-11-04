import type { ComponentType, CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react"
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

// The bottom and right panels' tab strip: tabs share the width between 90px and 240px and scroll past that,
// with the new-tab button kept in view after them.
export function PanelTabStrip({ tabs, activeKey, label, onSelect, onClose, onContextMenu, onNew, newLabel, trailing, className = "", style, controlStyle }: PanelTabStripProps) {
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
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="hide-scrollbar flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto ps-2">
        {tabs.map((tab) => {
          const selected = tab.key === activeKey
          const Icon = tab.icon
          return (
            <div
              key={tab.key}
              className="group/tab relative flex h-8 shrink-0 items-center rounded-lg"
              style={{ width: `clamp(90px, calc((100% - 36px) / ${tabs.length}), 240px)`, ...controlStyle }}
              onContextMenu={onContextMenu ? (event) => { event.preventDefault(); onContextMenu(tab.key, event) } : undefined}
            >
              <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-0 rounded-md border-[0.5px] ${selected ? "border-[var(--border-default)] bg-[var(--bg-card)] shadow-[0_1px_2px_-1px_#00000014]" : "border-transparent group-hover/tab:bg-[var(--fill-hover)]"}`} />
              <button
                type="button"
                role="tab"
                data-tab={tab.key}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={tab.title}
                onClick={() => onSelect(tab.key)}
                onAuxClick={(event) => { if (event.button === 1) onClose(tab.key) }}
                className={`relative z-10 flex h-full min-w-0 flex-1 items-center gap-2 rounded-md py-1 ps-2.5 pe-1 text-[length:var(--text-chat-sm)] group-hover/tab:pe-6 group-focus-within/tab:pe-6 ${selected ? "text-[var(--text-primary,#2D2D2B)]" : "text-[var(--text-tertiary,#A3A19B)]"}`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="min-w-0 truncate">{tab.title}</span>
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
          )
        })}
        <button
          type="button"
          aria-label={newLabel}
          title={newLabel}
          onClick={onNew}
          style={controlStyle}
          className="noa-terminal-action sticky end-0 flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface-page,#F9F9F7)]"
        >
          <Plus size={16} />
        </button>
      </div>
      {trailing}
    </div>
  )
}
