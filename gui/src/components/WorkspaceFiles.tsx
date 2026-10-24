import { lazy, Suspense, useEffect, useState } from "react"
import { query } from "../api"
import { ArrowLeft, BrandCss3, BrandHtml5, BrandJavascript, BrandPython, BrandReact, BrandTypescript, ChevronDown, ChevronRight, Copy, FileText, Folder, Json, ListDetails, Markdown, MoreHorizontal, Photo, Plus, RefreshCcw, RotateCcw, Search, SquareDot, SquareMinus, PlusSquare } from "../lib/icons"

const CodeView = lazy(() => import("./CodeView"))
type Entry = { name: string; path: string; directory: boolean }
type Change = { path: string; oldPath?: string; status: string; additions: number; deletions: number; binary: boolean }
type Changes = { isGit: boolean; branch: string; files: Change[]; additions: number; deletions: number }
type Preview = { path: string; scope: string; view: string; content?: string; snapshot?: string; revision?: string; truncated?: boolean; binary?: boolean; kind?: string; dataUrl?: string }

// File-type glyphs and brand colors, as in Codex's tree.
const GLYPHS: Record<string, [typeof FileText, string]> = {
  ts: [BrandTypescript, "#3178C6"], mts: [BrandTypescript, "#3178C6"], cts: [BrandTypescript, "#3178C6"],
  tsx: [BrandReact, "#61DAFB"], jsx: [BrandReact, "#61DAFB"],
  js: [BrandJavascript, "#D4B72C"], mjs: [BrandJavascript, "#D4B72C"], cjs: [BrandJavascript, "#D4B72C"],
  json: [Json, "#CBB02A"], md: [Markdown, "#7A8AA0"], css: [BrandCss3, "#2965F1"], html: [BrandHtml5, "#E34F26"], py: [BrandPython, "#3776AB"],
  png: [Photo, "#8C7AE6"], jpg: [Photo, "#8C7AE6"], jpeg: [Photo, "#8C7AE6"], gif: [Photo, "#8C7AE6"], webp: [Photo, "#8C7AE6"], svg: [Photo, "#8C7AE6"],
}
function FileGlyph({ name }: { name: string }) {
  const glyph = GLYPHS[name.split(".").pop()?.toLowerCase() ?? ""]
  if (!glyph) return <FileText size={15} />
  const Glyph = glyph[0]
  return <Glyph size={15} style={{ color: glyph[1] }} />
}
const toneOf = (status: string) => status.includes("D") ? "deleted" : status === "??" || status.includes("A") ? "added" : "modified"
function GitMark({ status }: { status: string }) {
  const tone = toneOf(status), Mark = tone === "added" ? PlusSquare : tone === "deleted" ? SquareMinus : SquareDot
  return <Mark size={16} className={`noa-git-mark is-${tone}`} aria-label={tone} />
}
type ChangeNode = { dirs: Map<string, ChangeNode>; files: Change[] }
function changeTree(files: Change[]): ChangeNode {
  const root: ChangeNode = { dirs: new Map(), files: [] }
  for (const file of files) {
    let node = root
    for (const part of file.path.split("/").slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
      node = node.dirs.get(part)!
    }
    node.files.push(file)
  }
  return root
}

async function load<T>(route: string, cwd: string, params: Record<string, string> = {}, signal?: AbortSignal, body?: unknown): Promise<T> {
  const suffix = new URLSearchParams(params)
  const response = await fetch(`/api/${route}${query(cwd)}&${suffix}`, { signal, ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? "Could not load workspace")
  return value as T
}

export function WorkspaceFiles({ cwd, changes = false, active = true, refreshKey, onReference, onUpdated, onOpenChanges }: {
  cwd: string; changes?: boolean; active?: boolean; refreshKey: number; onReference: (path: string) => void; onUpdated?: () => void; onOpenChanges?: () => void
}) {
  const [selected, setSelected] = useState<string>()
  const [view, setView] = useState(changes ? "diff" : "file")
  const [scope, setScope] = useState("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tree, setTree] = useState<Record<string, Entry[]>>({})
  const [matches, setMatches] = useState<Entry[]>([])
  const [status, setStatus] = useState<Changes>()
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState("")
  const [search, setSearch] = useState("")
  const [split, setSplit] = useState(() => localStorage.getItem("noa-diff-layout") === "split")
  const [wrap, setWrap] = useState(() => localStorage.getItem("noa-code-wrap") === "true")
  const [context, setContext] = useState("")
  const [findRequest, setFindRequest] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [action, setAction] = useState("")
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [viewed, setViewed] = useState<Record<string, string>>({})
  const current = preview?.path === selected && preview?.scope === scope && preview?.view === view ? preview : undefined
  const dirty = editing && draft !== current?.content
  const draftKey = selected ? `noa-file-draft:${cwd}:${selected}` : ""
  useEffect(() => {
    if (!dirty || !draftKey) return
    try { sessionStorage.setItem(draftKey, JSON.stringify({ content: draft, revision: current?.revision })) }
    catch { setError("Draft recovery storage is full. Keep this file open until you save or copy your edits.") }
  }, [dirty, draft, draftKey, current?.revision])
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty])

  useEffect(() => { const timer = setTimeout(() => setSearch(filter), 150); return () => clearTimeout(timer) }, [filter])
  useEffect(() => {
    if (!active || editing) return
    const timer = setInterval(() => { if (document.visibilityState === "visible") setTick((n) => n + 1) }, 3000)
    return () => clearInterval(timer)
  }, [active, editing])
  useEffect(() => {
    localStorage.setItem("noa-diff-layout", split ? "split" : "unified")
    localStorage.setItem("noa-code-wrap", String(wrap))
  }, [split, wrap])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    load<Changes>("changes", cwd, { scope }, controller.signal).then(setStatus).catch((e) => { if (!controller.signal.aborted && changes) setError(e.message) })
    return () => controller.abort()
  }, [cwd, scope, tick, refreshKey, active, changes])
  useEffect(() => {
    if (!active || editing) return
    const controller = new AbortController()
    setLoading(true); setError(undefined)
    const request = selected
      ? load<Preview>(view === "diff" ? "diff" : "file", cwd, { path: selected, scope, context }, controller.signal).then((body) => {
          let recovered: { content: string; revision: string } | undefined
          if (view === "file" && body.kind === "text") {
            try { recovered = JSON.parse(sessionStorage.getItem(`noa-file-draft:${cwd}:${selected}`) ?? "null") ?? undefined } catch { /* Ignore unavailable draft storage. */ }
          }
          setPreview({ ...body, path: selected, scope, view, ...(recovered ? { revision: recovered.revision } : {}) })
          if (recovered) { setDraft(recovered.content); setEditing(true); setError(recovered.revision === body.revision ? undefined : "Recovered your unsaved edits. The disk file has changed; saving will not overwrite it.") }
        })
      : changes ? Promise.resolve()
      : search ? load<{ entries: Entry[]; truncated: boolean }>("files", cwd, { search }, controller.signal).then((body) => { setMatches(body.entries); setTruncated(body.truncated) })
      : Promise.all(["", ...expanded].map(async (path) => {
          const body = await load<{ entries: Entry[]; truncated: boolean }>("files", cwd, { path }, controller.signal)
          return [path, body] as const
        })).then((entries) => { setTree(Object.fromEntries(entries.map(([path, body]) => [path, body.entries]))); setTruncated(entries.some(([, body]) => body.truncated)) })
    request.catch((e) => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [cwd, selected, view, scope, expanded, search, changes, tick, refreshKey, active, editing, context])

  const select = (path?: string, nextView = changes ? "diff" : "file") => {
    if (dirty && !window.confirm("Discard your unsaved file edits?")) return
    if (draftKey) sessionStorage.removeItem(draftKey)
    setEditing(false); setSelected(path); setView(nextView); setContext(""); setFindRequest(0); setError(undefined)
  }
  const gitAction = async (kind: string, hunk?: number) => {
    if (kind.startsWith("revert") && !window.confirm(hunk !== undefined ? `Revert hunk ${hunk + 1} in ${selected}? This cannot be undone.` : scope === "staged" ? `Remove the staged changes for ${selected}? Working files will be kept.` : `Discard changes to ${selected}? This cannot be undone. Untracked files will be deleted.`)) return
    setAction(kind); setError(undefined)
    try {
      await load("git-action", cwd, { scope, context }, undefined, { action: kind, path: selected, snapshot: current?.snapshot, hunk })
      if (hunk === undefined) select()
      setTick((n) => n + 1); onUpdated?.()
    } catch (e) { setError((e as Error).message) } finally { setAction("") }
  }
  const save = async () => {
    setAction("save"); setError(undefined)
    try {
      const body = await load<Preview>("file", cwd, { path: selected! }, undefined, { content: draft, revision: current?.revision })
      sessionStorage.removeItem(draftKey)
      setPreview({ ...body, path: selected!, scope, view }); setEditing(false); setTick((n) => n + 1); onUpdated?.()
    } catch (e) { setError((e as Error).message) } finally { setAction("") }
  }
  const copyPath = () => navigator.clipboard.writeText(selected ?? cwd).catch((e) => setError(`Could not copy path: ${e.message}`))
  const count = (file: Change) => <span className="noa-change-count">{file.binary ? "Binary" : <><span className="is-added">+{file.additions}</span><span className="is-removed">−{file.deletions}</span></>}</span>
  const toggleClosed = (key: string) => setClosed((previous) => { const next = new Set(previous); if (!next.delete(key)) next.add(key); return next })
  const dirty_ = (prefix: string) => status?.files.some((f) => f.path.startsWith(prefix + "/"))
  const row = (key: string, name: string, depth: number, opts: { directory?: boolean; opened?: boolean; marked?: boolean; change?: Change; onClick: () => void; title?: string }) => {
    const tone = opts.change ? toneOf(opts.change.status) : undefined
    // Open folders stick under their ancestors (one 28px row per level), as Codex's tree does.
    const sticky = opts.directory && opts.opened ? { position: "sticky" as const, top: depth * 28, zIndex: 20 - depth } : undefined
    return <button key={key} type="button" className={`noa-file-row${tone ? ` is-${tone}` : ""}${sticky ? " is-sticky" : ""}`} role="treeitem" aria-expanded={opts.directory ? !!opts.opened : undefined} style={{ paddingLeft: 6 + depth * 12, ...sticky }} title={opts.title ?? key} onClick={opts.onClick}>
      {opts.directory ? (opts.opened ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="noa-file-indent" />}
      {!opts.directory && <FileGlyph name={name} />}
      <span className="noa-file-name">{name}</span>
      {opts.directory ? opts.marked && <span className="noa-file-dot" aria-label="Contains changes" /> : opts.change && <GitMark status={opts.change.status} />}
    </button>
  }
  const treeRows = (directory: string, depth = 0): React.ReactNode => (search ? matches : tree[directory] ?? []).map((entry) => {
    const opened = expanded.has(entry.path)
    return <div key={entry.path} role="none">{row(entry.path, search ? entry.path : entry.name, search ? 0 : depth, { directory: entry.directory && !search, opened, marked: entry.directory && dirty_(entry.path), change: status?.files.find((f) => f.path === entry.path), onClick: () => {
      if (!entry.directory) select(entry.path, "file")
      else setExpanded((previous) => { const next = new Set(previous); if (next.has(entry.path)) { for (const p of next) if (p === entry.path || p.startsWith(entry.path + "/")) next.delete(p) } else next.add(entry.path); return next })
    } })}{entry.directory && opened && <div role="group">{treeRows(entry.path, depth + 1)}</div>}</div>
  })
  const changedRows = (node: ChangeNode, base = "", depth = 1): React.ReactNode => <>
    {[...node.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      // Fold single-directory chains into one row, as the full tree does.
      let label = name, leaf = child
      while (leaf.files.length === 0 && leaf.dirs.size === 1) { const [next, deeper] = [...leaf.dirs][0]!; label += `/${next}`; leaf = deeper }
      const path = base ? `${base}/${label}` : label, opened = !closed.has(`c:${path}`)
      return <div key={path} role="none">{row(`c:${path}`, label, depth, { directory: true, opened, marked: true, title: path, onClick: () => toggleClosed(`c:${path}`) })}{opened && <div role="group">{changedRows(leaf, path, depth + 1)}</div>}</div>
    })}
    {node.files.sort((a, b) => a.path.localeCompare(b.path)).map((file) => row(file.path, file.path.split("/").pop()!, depth, { change: file, onClick: () => select(file.path, "file") }))}
  </>
  const selectedChange = status?.files.find((f) => f.path === selected)
  const changeFiles = status?.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())) ?? []
  const button = "noa-panel-button"

  return <div className="noa-workspace-panel">
    {(selected || changes) && <div className="noa-panel-toolbar">
      {selected && <button type="button" className={button} aria-label="Back to files" onClick={() => select()}><ArrowLeft size={14} /></button>}
      <span className="noa-panel-title" title={selected ?? cwd}>{selected ?? (changes ? status?.branch || "Changes" : "Project files")}</span>
      {selected && changes && selectedChange && count(selectedChange)}
      {selected && <><button type="button" className={button} aria-label="Copy file path" title="Copy path" onClick={copyPath}><Copy size={14} /></button><button type="button" className={button} title="Add to chat" aria-label="Add file to chat" onClick={() => onReference(selected)}><Plus size={14} /></button></>}
      {!selected && !changes && expanded.size > 0 && <button type="button" className={button} onClick={() => setExpanded(new Set())}>Collapse all</button>}
      <button type="button" className={button} aria-label={changes ? "Refresh changes" : "Refresh files"} disabled={editing || !!action} onClick={() => setTick((n) => n + 1)}><RefreshCcw size={14} /></button>
    </div>}
    {selected ? <>
      {selectedChange?.oldPath && <div className="noa-file-breadcrumb">{selectedChange.oldPath} → {selected}</div>}
      <div className="noa-panel-toolbar noa-panel-actions">
        {changes && <><button type="button" className={button} aria-pressed={view === "diff"} onClick={() => select(selected, view === "diff" ? "file" : "diff")}>{view === "diff" ? "Open file" : "Show diff"}</button>{view === "diff" && <><select aria-label="Changes scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">All</option><option value="unstaged">Unstaged</option><option value="staged">Staged</option></select><button type="button" className={button} aria-label="Unified diff" aria-pressed={!split} onClick={() => setSplit(false)}>Unified</button><button type="button" className={button} aria-label="Split diff" aria-pressed={split} onClick={() => setSplit(true)}>Split</button></>}</>}
        <button type="button" className={button} aria-pressed={wrap} onClick={() => setWrap(!wrap)}>Wrap</button>
        {!editing && <button type="button" className={button} aria-label="Find in file" onClick={() => setFindRequest((n) => n + 1)}>Find</button>}
        {changes && view === "diff" && current?.snapshot && <details className="noa-review-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false }} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false }}>
          <summary role="button" className={button} aria-label="Review actions" title="Review actions"><MoreHorizontal size={16} /></summary>
          <div className="noa-review-menu-content noa-floating-panel">
            <button type="button" className={button} onClick={() => { setContext(context ? "" : "all") }}>{context ? "Collapse context" : "Expand context"}</button>
            <label className="noa-viewed-label"><input type="checkbox" checked={viewed[selected] === current.snapshot} onChange={(event) => setViewed((v) => ({ ...v, [selected]: event.target.checked ? current.snapshot! : "" }))} />Viewed</label>
            {scope !== "staged" && selectedChange && selectedChange.status[1] !== " " && <button type="button" className={button} disabled={!!action} onClick={() => gitAction("stage")}>Stage file</button>}
            {scope !== "unstaged" && selectedChange && selectedChange.status !== "??" && selectedChange.status[0] !== " " && <button type="button" className={button} disabled={!!action} onClick={() => gitAction("unstage")}>Unstage file</button>}
            <button type="button" className={button} disabled={!!action} onClick={() => gitAction("revert")}><RotateCcw size={13} />Revert file</button>
          </div>
        </details>}
        {view === "file" && current?.kind === "text" && (editing ? <><button type="button" className={button} disabled={!!action} onClick={() => { if (!dirty || window.confirm("Discard your unsaved file edits?")) { sessionStorage.removeItem(draftKey); setEditing(false) } }}>Cancel</button><button type="button" className={button} disabled={!dirty || !!action} onClick={save}>{action === "save" ? "Saving…" : "Save"}</button></> : <button type="button" className={button} onClick={() => { setDraft(current.content ?? ""); setEditing(true) }}>Edit</button>)}
      </div>
    </> : <>
      {changes && status?.isGit && <div className="noa-panel-toolbar noa-panel-actions"><select aria-label="Changes scope" value={scope} onChange={(e) => { setScope(e.target.value); setPreview(undefined) }}><option value="all">All changes</option><option value="unstaged">Unstaged</option><option value="staged">Staged</option></select><span className="flex-1" /><span className="noa-change-count"><span className="is-added">+{status.additions}</span><span className="is-removed">−{status.deletions}</span></span></div>}
      {!changes && <div className="noa-panel-toolbar noa-file-root">
        <span className="noa-file-root-chip" title={cwd}><Folder size={14} />{cwd.split("/").filter(Boolean).pop() ?? "/"}</span>
        <details className="noa-review-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false }} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false }} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false }}>
          <summary role="button" className={button} aria-label="File actions" title="File actions"><MoreHorizontal size={16} /></summary>
          <div className="noa-review-menu-content noa-floating-panel">
            <button type="button" className={button} disabled={editing || !!action} onClick={() => setTick((n) => n + 1)}><RefreshCcw size={13} />Refresh</button>
            <button type="button" className={button} disabled={expanded.size === 0} onClick={() => setExpanded(new Set())}>Collapse all</button>
            <button type="button" className={button} onClick={copyPath}><Copy size={13} />Copy path</button>
          </div>
        </details>
      </div>}
      <div className="noa-file-search">
        <div className="noa-file-search-field"><Search size={14} /><input aria-label={changes ? "Filter changed files" : "Search files"} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={changes ? "Filter changed files" : "Search files"} /></div>
      </div>
    </>}
    {error && <p className="noa-panel-error" role="alert">{error}</p>}
    {loading && !current && selected && <p className="noa-panel-empty" role="status">Loading…</p>}
    <div className="noa-panel-body">
      {selected ? current && (editing ? <textarea aria-label="Edit file content" className="noa-file-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} /> : current.kind === "image" ? <div className="noa-image-preview"><img src={current.dataUrl} alt={selected} /></div> : current.kind === "binary" ? <p className="noa-panel-empty">Binary file cannot be previewed</p> : current.truncated ? <p className="noa-panel-empty">Diff too large to display. Open the file in your editor to review it.</p> : <Suspense fallback={<p className="noa-panel-empty">Loading code viewer…</p>}><CodeView path={selected} content={current.content ?? ""} diff={view === "diff"} split={split} wrap={wrap} hunkScope={scope !== "all" && !selectedChange?.oldPath && !action ? scope : undefined} onHunkAction={gitAction} findRequest={findRequest} onCloseFind={() => setFindRequest(0)} /></Suspense>)
        : changes ? !status ? <p className="noa-panel-empty" role="status">Loading changes…</p> : status.isGit === false ? <div className="noa-panel-empty"><p>This folder is not a Git repository</p><button type="button" className={button} disabled={!!action} onClick={() => gitAction("init")}>Create Git repository</button></div> : <div className="noa-changes-list">{changeFiles.length ? changeFiles.map((file) => <button type="button" key={file.path} className="noa-file-row" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path} onClick={() => select(file.path)}><FileText size={15} /><span className="noa-file-name"><span>{file.path.split("/").pop()}</span><span className="noa-file-directory">{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}</span></span>{count(file)}<span className="noa-file-status">{file.status === "??" ? "U" : file.status.trim()}</span></button>) : <p className="noa-panel-empty">{filter ? "No matching files" : scope === "staged" ? "No staged changes" : scope === "unstaged" ? "No unstaged changes" : "No file changes"}</p>}</div>
        : <div role={search ? undefined : "tree"} aria-label="Project files" className="noa-file-tree">{!search && onOpenChanges && status?.isGit && <button type="button" className="noa-file-row noa-file-section" onClick={onOpenChanges}><ListDetails size={15} /><span className="noa-file-name">All changes</span></button>}
          {!search && status?.isGit && status.files.length > 0 && <><button type="button" className="noa-file-row noa-file-section" aria-expanded={!closed.has("@changed")} onClick={() => toggleClosed("@changed")}>{closed.has("@changed") ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span className="noa-file-name">Changed files</span><span className="noa-file-dot" /></button>{!closed.has("@changed") && <div role="group">{changedRows(changeTree(status.files))}</div>}
          <button type="button" className="noa-file-row noa-file-section" aria-expanded={!closed.has("@all")} onClick={() => toggleClosed("@all")}>{closed.has("@all") ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span className="noa-file-name">All files</span></button></>}
          {!closed.has("@all") && treeRows("")}{!loading && (search ? !matches.length : !tree[""]?.length) && <p className="noa-panel-empty">{search ? "No matching files" : "No files in this folder"}</p>}</div>}
    </div>
    {(current?.truncated || !selected && truncated) && <p className="noa-panel-notice">Preview limit reached; some content is omitted.</p>}
  </div>
}
