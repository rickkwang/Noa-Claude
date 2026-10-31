import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { createPortal, flushSync } from "react-dom"
import { query, type ProjectInfo, type SessionSummary } from "../api"
import { FileText, Folder, MessageCircle, SquarePen } from "../lib/icons"
import { recentFiles } from "../lib/recentFiles"
import { FileGlyph } from "./WorkspaceFiles"

const TABS = ["All", "Actions", "Tasks", "Files", "Text"] as const
type Tab = typeof TABS[number]
type FileMatch = { path: string; directory?: boolean }
type TextMatch = { path: string; line: number; preview: string }
type Result = { id: string; kind: "action" | "task" | "file" | "text"; label: string; detail?: string; path?: string; shortcut?: string; select: () => void }

export function SearchDialog({ cwd, projects, sessions, onNewSession, onOpenFolder, onSelectSession, onOpenFile, onClose }: {
  cwd: string
  projects: ProjectInfo[]
  sessions: Record<string, SessionSummary[]>
  onNewSession: () => void
  onOpenFolder: () => void
  onSelectSession: (cwd: string, id: string) => void
  onOpenFile: (path: string, line?: number) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [text, setText] = useState("")
  const [tab, setTab] = useState<Tab>("All")
  const [selected, setSelected] = useState<string>()
  const [openedFiles] = useState(() => recentFiles().filter(file => file.cwd === cwd))
  const [remote, setRemote] = useState<{ key: string; files: FileMatch[]; matches: TextMatch[]; error?: string }>()
  const needle = text.trim()
  const key = `${cwd}\0${tab}\0${needle}`
  const searchFiles = !!needle && (tab === "All" || tab === "Files")
  const searchText = !!needle && (tab === "All" || tab === "Text")
  const current = remote?.key === key ? remote : undefined
  const loading = (searchFiles || searchText) && !current
  const mac = navigator.platform.includes("Mac")
  const placeholder = tab === "All" ? "Search Noa" : `Search ${tab.toLowerCase()}`
  const projectName = projects.find(project => project.path === cwd || project.sources.includes(cwd))?.name ?? cwd.split("/").pop() ?? cwd

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    input.current?.focus()
    return () => { element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  useEffect(() => {
    setSelected(undefined)
    dialog.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [needle, tab])

  useEffect(() => {
    if (!searchFiles && !searchText) return
    const controller = new AbortController()
    const get = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { signal: controller.signal })
      if (!response.ok) throw new Error(`Search failed (HTTP ${response.status})`)
      return response.json() as Promise<T>
    }
    const timer = setTimeout(() => {
      void Promise.allSettled([
        searchFiles ? get<{ entries: FileMatch[] }>(`/api/files${query(cwd)}&${new URLSearchParams({ search: needle })}`) : Promise.resolve({ entries: [] }),
        searchText ? get<{ matches: TextMatch[] }>(`/api/grep${query(cwd)}&${new URLSearchParams({ q: needle, max: "20" })}`) : Promise.resolve({ matches: [] }),
      ]).then(([files, matches]) => {
        if (controller.signal.aborted) return
        setRemote({
          key,
          files: files.status === "fulfilled" ? files.value.entries.filter(file => !file.directory).slice(0, 20) : [],
          matches: matches.status === "fulfilled" ? matches.value.matches.slice(0, 20) : [],
          error: files.status === "rejected" || matches.status === "rejected" ? "Some search results could not be loaded. Try again." : undefined,
        })
      })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, cwd, needle, searchFiles, searchText])

  const groups: { label: string; items: Result[] }[] = []
  const contains = (value: string) => value.toLowerCase().includes(needle.toLowerCase())
  if (tab === "All" || tab === "Actions") {
    const actions: Result[] = [
      { id: "new", kind: "action", label: "New task", shortcut: mac ? "⌘N" : "Ctrl N", select: onNewSession },
      { id: "folder", kind: "action", label: "Open folder", select: onOpenFolder },
    ]
    groups.push({ label: needle ? "Actions" : "Quick actions", items: actions.filter(action => contains(action.label)) })
  }
  if (tab === "All" || tab === "Tasks") {
    const tasks = projects.flatMap(project => (sessions[project.path] ?? []).map(session => ({ project, session })))
      .filter(({ project, session }) => contains(session.title) || contains(project.name))
      .sort((a, b) => b.session.updatedAt - a.session.updatedAt)
      .slice(0, !needle && tab === "All" ? 5 : 30)
    groups.push({ label: "Tasks", items: tasks.map(({ project, session }) => ({ id: `task:${project.path}:${session.id}`, kind: "task", label: session.title, detail: project.name, select: () => onSelectSession(session.cwd ?? project.path, session.id) })) })
  }
  if (tab === "All" || tab === "Files") {
    const files = needle ? current?.files ?? [] : openedFiles.slice(0, 8)
    groups.push({ label: needle ? `Files · ${projectName}` : "Opened recently", items: files.map(file => ({ id: `file:${file.path}`, kind: "file", label: file.path.split("/").pop()!, detail: file.path.split("/").slice(0, -1).join("/"), path: file.path, select: () => onOpenFile(file.path) })) })
  }
  if (searchText) groups.push({ label: `Text · ${projectName}`, items: (current?.matches ?? []).map(match => ({ id: `text:${match.path}:${match.line}`, kind: "text", label: `${match.path.split("/").pop()}:${match.line}`, detail: match.preview, path: match.path, select: () => onOpenFile(match.path, match.line) })) })
  const results = groups.flatMap(group => group.items)
  const active = Math.max(0, results.findIndex(result => result.id === selected))
  const activeId = results.length ? `${listId}-${active}` : undefined

  useEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" }) }, [activeId, needle, tab])

  function run(result: Result | undefined) {
    if (!result) return
    flushSync(onClose)
    result.select()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const fromInput = event.target === input.current
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
      event.preventDefault(); event.stopPropagation(); flushSync(onClose)
      onNewSession()
    } else if (event.key === "F6") {
      event.preventDefault()
      if (fromInput) dialog.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()
      else input.current?.focus()
    } else if ((fromInput && event.key === "Tab") || (!fromInput && ["ArrowLeft", "ArrowRight"].includes(event.key))) {
      event.preventDefault()
      const direction = event.shiftKey || event.key === "ArrowLeft" ? -1 : 1
      setTab(TABS[(TABS.indexOf(tab) + direction + TABS.length) % TABS.length]!)
      if (!fromInput) requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus())
    } else if (fromInput && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if ((event.key === "Home" || event.key === "End") && !event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const next = event.key === "Home" ? 0 : event.key === "End" ? results.length - 1 : (active + (event.key === "ArrowDown" ? 1 : results.length - 1)) % Math.max(1, results.length)
      setSelected(results[next]?.id)
    } else if (fromInput && event.key === "Enter") {
      event.preventDefault(); run(results[active])
    }
  }

  return createPortal(
    <dialog ref={dialog} aria-label="Search Noa" className="noa-search-dialog font-ui" onKeyDown={onKeyDown} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="noa-search-surface">
        <input ref={input} role="combobox" aria-label={placeholder} aria-expanded="true" aria-controls={listId} aria-activedescendant={activeId} autoComplete="off" spellCheck={false} placeholder={placeholder} value={text} onChange={event => setText(event.target.value)} className="noa-search-input" />
        <div id={listId} role="listbox" aria-label="Search results" className="noa-search-results">
          {groups.filter(group => group.items.length).map(group => <section key={group.label} role="group" aria-label={group.label}>
            <h2 className="noa-search-heading" aria-hidden="true">{group.label}</h2>
            {group.items.map(result => {
              const index = results.indexOf(result)
              return <button key={result.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === active} tabIndex={-1} className="noa-search-result" onMouseMove={() => setSelected(result.id)} onClick={() => run(result)}>
                <span className="noa-search-icon">{result.kind === "task" ? <MessageCircle size={16} /> : result.kind === "file" ? <FileGlyph name={result.path!} /> : result.kind === "text" ? <FileText size={16} /> : result.id === "new" ? <SquarePen size={16} /> : <Folder size={16} />}</span>
                <span className="noa-search-label">{result.label}</span>
                {result.detail && <span className={`noa-search-detail${result.kind === "task" ? " is-project" : ""}`}>{result.detail}</span>}
                {result.shortcut && <kbd>{result.shortcut}</kbd>}
              </button>
            })}
          </section>)}
          {loading && <p role="status" className="noa-search-empty">Searching…</p>}
          {current?.error && <p role="alert" className="noa-search-empty">{current.error}</p>}
          {!results.length && !loading && !current?.error && <p className="noa-search-empty">{!needle && tab === "Text" ? `Search text in ${projectName} files` : !needle && tab === "Files" ? `Search files in ${projectName}` : "No matches"}</p>}
        </div>
        <div role="tablist" aria-label="Search categories" className="noa-search-tabs">
          {TABS.map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => { setTab(value); input.current?.focus() }}>{value}</button>)}
        </div>
      </div>
    </dialog>, document.body,
  )
}
