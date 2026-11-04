import { useEffect, useState, useSyncExternalStore } from "react"
import { ChevronDown, PanelRight, Terminal } from "../lib/icons"
import {
  closeTerminal,
  moveTerminal,
  openTerminal,
  restyleTerminals,
  selectTerminal,
  snapshotTerminals,
  subscribeTerminals,
  terminalsVersion,
  terminalTabs,
} from "../lib/terminalSessions"
import { PanelTabStrip } from "./PanelTabStrip"
import { PopupMenu, type PopupMenuAnchor } from "./PopupMenu"
import { ResizeHandle } from "./ResizeHandle"
import { TerminalView } from "./TerminalView"

export const TERMINAL_PANEL_DEFAULT_HEIGHT = 280
export const TERMINAL_PANEL_MIN_HEIGHT = 160

interface TerminalPanelProps {
  cwd: string
  open: boolean
  height: number
  // The chat column's height: the panel never takes more than half of it.
  available: number
  // Changes whenever appearance settings do, so terminals pick up a new font or theme.
  styleKey: string
  focusKey: number
  onHeight: (height: number) => void
  onHide: () => void
  onDraggingChange: (dragging: boolean) => void
  // A tab moved to the right panel; the owner shows it there.
  onMovedToRight: () => void
}

export function clampTerminalHeight(height: number, available: number): number {
  return Math.round(Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.min(height, available * 0.5)))
}

export function TerminalPanel({ cwd, open, height, available, styleKey, focusKey, onHeight, onHide, onDraggingChange, onMovedToRight }: TerminalPanelProps) {
  useSyncExternalStore(subscribeTerminals, terminalsVersion, terminalsVersion)
  const tabs = snapshotTerminals(cwd)
  const activeId = terminalTabs(cwd).active ?? tabs[0]?.id
  const active = tabs.find((tab) => tab.id === activeId)
  const shown = clampTerminalHeight(height, available)
  const [menu, setMenu] = useState<{ id: string; anchor: PopupMenuAnchor }>()

  // Opening the panel (or switching to a project) without a shell starts one, as the toggle shortcut promises.
  // Closing or moving away the last tab hides the panel instead of starting another.
  useEffect(() => {
    if (open && terminalTabs(cwd).ids.length === 0) openTerminal(cwd)
  }, [open, cwd])
  const close = (id: string) => {
    if (tabs.length === 1) onHide()
    closeTerminal(cwd, id)
  }
  const moveRight = (id: string) => {
    if (tabs.length === 1) onHide()
    moveTerminal(cwd, id, "right")
    onMovedToRight()
  }

  useEffect(restyleTerminals, [styleKey])

  return (
    <div
      data-terminal-panel=""
      inert={!open ? true : undefined}
      className="relative z-30 min-h-0 w-full shrink-0 transition-[height,opacity] duration-300 ease-out"
      style={{ height: open ? shown : 0, opacity: open ? 1 : 0 }}
    >
      {open && (
        <ResizeHandle
          label="Resize terminal"
          orientation="horizontal"
          grow={-1}
          width={shown}
          defaultWidth={TERMINAL_PANEL_DEFAULT_HEIGHT}
          // Dragging below the minimum hides the panel; its tabs stay open.
          onResize={(next) => (next < TERMINAL_PANEL_MIN_HEIGHT ? onHide() : onHeight(clampTerminalHeight(next, available)))}
          onDraggingChange={onDraggingChange}
          style={{ top: -4 }}
        />
      )}
      <div className="noa-terminal-panel absolute inset-x-0 top-0 flex min-h-0 flex-col overflow-hidden border-t border-[var(--border-default)] bg-[var(--surface-page,#F9F9F7)]" style={{ height: shown }}>
        <PanelTabStrip
          className="h-10 border-b border-[var(--border-default)] pe-1.5"
          label="Terminal tabs"
          tabs={tabs.map((tab) => ({ key: tab.id, title: tab.title, icon: Terminal }))}
          activeKey={activeId}
          onSelect={(id) => selectTerminal(cwd, id)}
          onClose={close}
          onContextMenu={(id, event) => setMenu({ id, anchor: { left: event.clientX, top: event.clientY, bottom: event.clientY } })}
          onNew={() => openTerminal(cwd)}
          newLabel="New terminal"
          trailing={
            <button type="button" aria-label="Hide bottom panel" title="Hide bottom panel" onClick={onHide} className="noa-terminal-action flex size-7 shrink-0 items-center justify-center rounded-[10px]">
              <ChevronDown size={16} />
            </button>
          }
        />
        {active && <TerminalView key={active.id} cwd={cwd} terminal={active} visible={open} focusKey={focusKey} />}
      </div>
      {menu && (
        <PopupMenu
          anchor={menu.anchor}
          label="Terminal tab"
          onClose={() => setMenu(undefined)}
          entries={[{ key: "move-right", label: "Move to right pane", icon: PanelRight, onSelect: () => moveRight(menu.id) }]}
        />
      )}
    </div>
  )
}
