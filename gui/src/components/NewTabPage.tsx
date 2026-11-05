import { useState, type ComponentType } from "react"
import { Globe, MoreHorizontal, PanelBottom, X } from "../lib/icons"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "./PopupMenu"

export interface NewTabTool {
  id: string
  title: string
  icon: ComponentType<{ size?: number; className?: string }>
  shortcut?: string
}

// A panel's New tab page: the tools that can open as a tab, one row each with its shortcut.
// The terminal row also offers the bottom terminal, as its own menu.
export function NewTabPage({ tools, onSelect, onOpenBottomTerminal, suggested = [], onOpenUrl, onDismissUrl }: { tools: NewTabTool[]; onSelect: (id: string) => void; onOpenBottomTerminal: () => void; suggested?: string[]; onOpenUrl?: (url: string) => void; onDismissUrl?: (url: string) => void }) {
  const [menu, setMenu] = useState<{ anchor: PopupMenuAnchor; trigger: Element }>()
  return (
    <div className="noa-new-tab-page @container h-full min-h-0 overflow-y-auto px-4 py-8 select-none">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h3 className="m-0 text-[length:var(--text-chat-sm)] font-medium text-[var(--text-primary,#2D2D2B)]">Tools</h3>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 @md:grid-cols-2">
          {tools.map((tool) => {
            const Icon = tool.icon
            return (
              <div key={tool.id} className="noa-new-tab-row flex w-full min-w-0 items-center rounded-md">
                <button type="button" onClick={() => onSelect(tool.id)} className="flex min-h-10 w-full min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-start">
                  <span className="flex shrink-0 items-center justify-center text-[var(--text-secondary,#7B7974)]"><Icon size={16} /></span>
                  <span className="min-w-0 flex-1 truncate text-[length:var(--text-chat-sm)] text-[var(--text-primary,#2D2D2B)]">{tool.title}</span>
                  {tool.shortcut && <kbd className="noa-new-tab-key ms-auto shrink-0">{tool.shortcut}</kbd>}
                </button>
                {tool.id === "terminal" && (
                  <div className="shrink-0 pe-2.5">
                    <button
                      type="button"
                      aria-label="Terminal options"
                      aria-haspopup="menu"
                      aria-expanded={!!menu}
                      onClick={(event) => setMenu(menu ? undefined : { anchor: anchorBelow(event.currentTarget), trigger: event.currentTarget })}
                      className="noa-terminal-action flex size-7 items-center justify-center rounded-[10px]"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
      {suggested.length > 0 && <section className="mx-auto mt-8 flex w-full max-w-3xl flex-col gap-4" aria-label="Suggested websites">
        <h3 className="m-0 text-[length:var(--text-chat-sm)] font-normal text-[var(--text-primary)]">Suggested</h3>
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
          {suggested.map(url => <div key={url} className="noa-suggested-site relative min-w-0 rounded-xl">
            <button type="button" title={url} onClick={() => onOpenUrl?.(url)} className="flex min-h-28 w-full flex-col items-center justify-center gap-4 rounded-xl px-8 py-5 text-[length:var(--text-chat-sm)] text-[var(--text-primary)]">
              <Globe size={28} className="text-[var(--text-secondary)]" />
              <span className="max-w-full truncate">{new URL(url).host}</span>
            </button>
            <button type="button" aria-label={`Dismiss ${new URL(url).host} suggestion`} onClick={() => onDismissUrl?.(url)} className="noa-terminal-action absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-[var(--text-tertiary)]"><X size={14} /></button>
          </div>)}
        </div>
      </section>}
      {menu && (
        <PopupMenu
          anchor={menu.anchor}
          trigger={menu.trigger}
          label="Terminal options"
          onClose={() => setMenu(undefined)}
          entries={[{ key: "bottom", label: <span className="flex w-full items-center justify-between gap-6">Open bottom terminal<span className="text-[var(--text-tertiary,#A3A19B)]">⌘J</span></span>, icon: PanelBottom, onSelect: onOpenBottomTerminal }]}
        />
      )}
    </div>
  )
}
