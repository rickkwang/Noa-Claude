import type { ComponentType } from "react"
import { Globe, X } from "../lib/icons"

export interface NewTabTool {
  id: string
  title: string
  icon: ComponentType<{ size?: number; className?: string }>
  keys?: string[]
}

// A shortcut as separate key glyphs with a little space between them.
export function ShortcutKeys({ keys }: { keys: string[] }) {
  return <span className="flex shrink-0 items-center gap-[3px] text-[length:var(--text-chat-sm)] text-[var(--text-secondary,#60605E)]">{keys.map((key, index) => <span key={index}>{key}</span>)}</span>
}

// An empty panel: the tools that can open as a tab, as one centered list with each tool's shortcut.
export function NewTabPage({ groups, onSelect, suggested = [], onOpenUrl, onDismissUrl }: { groups: NewTabTool[][]; onSelect: (id: string) => void; suggested?: string[]; onOpenUrl?: (url: string) => void; onDismissUrl?: (url: string) => void }) {
  return (
    <div className="noa-new-tab-page @container flex h-full min-h-0 flex-col overflow-y-auto px-3 py-8 select-none">
      <nav aria-label="Tools" className="m-auto flex w-full max-w-[220px] flex-col">
        {groups.flat().map((tool) => {
          const Icon = tool.icon
          return (
            <button key={tool.id} type="button" onClick={() => onSelect(tool.id)} className="noa-new-tab-row flex h-8 w-full min-w-0 items-center gap-1 rounded-lg px-2 text-start text-[length:var(--text-chat-sm)] text-[var(--text-primary,#2D2D2B)]">
              <Icon size={16} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{tool.title}</span>
              {tool.keys?.length ? <ShortcutKeys keys={tool.keys} /> : null}
            </button>
          )
        })}
      </nav>
      {suggested.length > 0 && <section className="mx-auto mt-8 flex w-full max-w-3xl flex-col gap-4" aria-label="Suggested websites">
        <h3 className="m-0 ps-2 text-[length:var(--text-chat-sm)] font-normal text-[var(--text-primary)]">Suggested</h3>
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
    </div>
  )
}
