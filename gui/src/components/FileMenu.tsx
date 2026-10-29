import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { query } from "../api"
import { ChevronRight } from "../lib/icons"

export type Editor = { type: string; name: string }
type Item = { label: string; separatorBefore?: boolean; onSelect?: () => void; items?: Item[] }

// One request per app run: installed editors rarely change while the GUI is open.
let editorsRequest: Promise<Editor[]> | undefined
export function loadEditors(cwd: string): Promise<Editor[]> {
  editorsRequest ??= fetch(`/api/editors${query(cwd)}`).then((r) => r.json()).then((body) => (body.editors ?? []) as Editor[]).catch(() => { editorsRequest = undefined; return [] })
  return editorsRequest
}

const isMac = navigator.platform.includes("Mac")
const isWindows = navigator.platform.startsWith("Win")
export const revealLabel = isMac ? "Show in Finder" : isWindows ? "Show in Explorer" : "Show in file manager"

// Opens a project path in an editor ("vscode", …) or reveals it in the file manager ("finder").
export function openPath(cwd: string, path: string, target: string): Promise<void> {
  return fetch(`/api/open-in${query(cwd)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, target }) })
    .then(async (response) => { if (!response.ok) throw new Error((await response.json()).error ?? "Couldn’t open this") })
}

export type FileMenuTarget = { x: number; y: number; path: string; directory: boolean; gone?: boolean }

// Claude Code's file row menu: Attach as context, Copy ▸, Open in ▸ (installed editors), and reveal in
// the system file manager. "Reveal in file tree" is offered where the row is not already in the tree.
export function FileMenu({ cwd, target, onClose, onReference, onRevealInTree, onError }: {
  cwd: string
  target: FileMenuTarget
  onClose: () => void
  onReference: (path: string) => void
  onRevealInTree?: (path: string) => void
  onError: (message: string) => void
}) {
  const [editors, setEditors] = useState<Editor[]>([])
  const [open, setOpen] = useState<number>()
  const [position, setPosition] = useState({ left: target.x, top: target.y })
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { void loadEditors(cwd).then(setEditors) }, [cwd])

  const absolute = target.path ? `${cwd.replace(/\/$/, "")}/${target.path}` : cwd
  const copy = (text: string) => { navigator.clipboard.writeText(text).catch((e) => onError(`Copy failed: ${e.message}`)); onClose() }
  const openIn = (where: string) => {
    onClose()
    openPath(cwd, target.path, where).catch((e) => onError(e.message))
  }
  const items: Item[] = [
    ...(!target.gone ? [{ label: "Attach as context", onSelect: () => { onReference(target.path); onClose() } }] : []),
    { label: "Copy", items: [
      { label: "Absolute path", onSelect: () => copy(absolute) },
      ...(target.path ? [{ label: "Relative path", onSelect: () => copy(target.path) }] : []),
      { label: "Filename", onSelect: () => copy(absolute.split("/").pop() ?? absolute) },
    ] },
    ...(!target.gone && editors.length ? [{ label: "Open in", separatorBefore: true, items: editors.map((editor) => ({ label: editor.name, onSelect: () => openIn(editor.type) })) }] : []),
    ...(!target.gone ? [{ label: revealLabel, separatorBefore: !editors.length, onSelect: () => openIn("finder") }] : []),
    ...(!target.gone && onRevealInTree ? [{ label: "Reveal in file tree", onSelect: () => { onRevealInTree(target.path); onClose() } }] : []),
  ]

  // Keep the menu inside the window, as a native context menu does.
  useLayoutEffect(() => {
    const menu = root.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({ left: Math.max(4, Math.min(target.x, window.innerWidth - width - 4)), top: Math.max(4, Math.min(target.y, window.innerHeight - height - 4)) })
    // Focus the menu itself, as a native context menu does: arrow keys then move into the items.
    menu.querySelector<HTMLElement>('[role="menu"]')?.focus()
  }, [target.x, target.y, editors.length])
  // The panel hugs the window's right edge, so a submenu that would overflow opens to the left.
  useLayoutEffect(() => {
    const submenu = root.current?.querySelector<HTMLElement>(".is-submenu")
    if (!submenu) return
    submenu.removeAttribute("data-flip")
    const rect = submenu.getBoundingClientRect()
    if (rect.right > window.innerWidth - 4) submenu.setAttribute("data-flip", "")
    if (rect.bottom > window.innerHeight - 4) submenu.style.top = `${window.innerHeight - 4 - rect.bottom - 4}px`
  }, [open, editors.length])
  useEffect(() => {
    const press = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose() }
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose() } }
    window.addEventListener("pointerdown", press, true)
    window.addEventListener("keydown", key, true)
    window.addEventListener("blur", onClose)
    window.addEventListener("resize", onClose)
    return () => {
      window.removeEventListener("pointerdown", press, true)
      window.removeEventListener("keydown", key, true)
      window.removeEventListener("blur", onClose)
      window.removeEventListener("resize", onClose)
    }
  }, [onClose])

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [...(event.currentTarget.querySelectorAll<HTMLElement>(':scope > .noa-context-menu-entry > [role="menuitem"]'))]
    const index = entries.indexOf(document.activeElement as HTMLElement)
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation()
      entries[index < 0 ? (event.key === "ArrowDown" ? 0 : entries.length - 1) : (index + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length]?.focus()
    }
  }
  const list = (entries: Item[], nested: boolean) => <div role="menu" tabIndex={-1} className={`noa-context-menu noa-floating-panel${nested ? " is-submenu" : ""}`} onKeyDown={onKey}>
    {entries.map((item, i) => <div key={item.label} role="none" className="noa-context-menu-entry" onPointerEnter={() => !nested && setOpen(item.items ? i : undefined)}>
      {item.separatorBefore && i > 0 && <div role="separator" className="noa-context-menu-separator" />}
      <button type="button" role="menuitem" aria-haspopup={item.items ? "menu" : undefined} aria-expanded={item.items ? open === i : undefined}
        onClick={() => item.items ? setOpen(open === i ? undefined : i) : item.onSelect?.()}
        onKeyDown={(event) => {
          if (item.items && (event.key === "ArrowRight" || event.key === "Enter")) {
            event.preventDefault(); event.stopPropagation(); setOpen(i)
            requestAnimationFrame(() => event.currentTarget.parentElement?.querySelector<HTMLElement>('.is-submenu [role="menuitem"]')?.focus())
          } else if (nested && event.key === "ArrowLeft") {
            event.preventDefault(); event.stopPropagation(); setOpen(undefined)
            root.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus()
          }
        }}>
        <span>{item.label}</span>{item.items && <ChevronRight size={12} />}
      </button>
      {item.items && open === i && list(item.items, true)}
    </div>)}
  </div>
  // Portaled: the right panel clips overflow, and a flipped submenu reaches past its left edge.
  return createPortal(<div ref={root} className="noa-context-menu-root font-ui" style={position} onContextMenu={(event) => event.preventDefault()}>{list(items, false)}</div>, document.body)
}
