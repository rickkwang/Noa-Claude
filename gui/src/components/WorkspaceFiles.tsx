import { lazy, Suspense, useEffect, useState, type KeyboardEvent } from "react"
import { query } from "../api"
import { useConfirm } from "./ConfirmDialog"
import { ArrowLeft, CheckCircle2, GitBranch, BrandCss3, BrandHtml5, BrandJavascript, BrandPython, BrandReact, BrandTypescript, ChevronDown, Copy, FileText, Folder, Json, ListDetails, Markdown, MoreHorizontal, Photo, Plus, RefreshCcw, RotateCcw, Search } from "../lib/icons"

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
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  if (["ts", "mts", "cts"].includes(extension)) return <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" className="noa-glyph-blue"><path fill="currentColor" d="M8 1C2.24 1 1 2.24 1 8s1.24 7 7 7 7-1.24 7-7-1.24-7-7-7" opacity={0.2}/>
  <path fill="currentColor" d="M8.1 9.64h.95c.04.62.28.76 1.28.76s1.2-.14 1.2-.85c0-.66-.2-.85-1.2-1.07-1.79-.38-2.18-.7-2.18-1.86C8.15 5.3 8.54 5 10.31 5c1.67 0 2.04.26 2.07 1.42h-.95c-.02-.43-.23-.53-1.1-.53-1 0-1.22.14-1.22.74 0 .52.22.7 1.24.92 1.76.38 2.15.73 2.15 2 0 1.44-.4 1.75-2.24 1.75-1.8 0-2.18-.3-2.15-1.66m-3 1.57V5.99H3.5v-.9h4.21v.9H6.1v5.22z"/></svg>
  if (["tsx", "jsx"].includes(extension)) return <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" className="noa-glyph-cyan"><path fill="currentColor" d="M8 6.65c.73 0 1.31.6 1.31 1.35S8.73 9.35 8 9.35 6.69 8.75 6.69 8 7.27 6.65 8 6.65"/>
  <path fill="currentColor" fillRule="evenodd" d="M8 2.55c1.3-.99 2.59-1.34 3.5-.8.92.55 1.27 1.87 1.08 3.53C14.06 5.94 15 6.9 15 8s-.94 2.06-2.42 2.72c.19 1.65-.16 2.98-1.08 3.52-.91.55-2.2.2-3.5-.8-1.3 1-2.58 1.35-3.5.8-.91-.54-1.27-1.87-1.08-3.52C1.94 10.06 1 9.1 1 8s.94-2.06 2.42-2.72c-.19-1.66.17-2.98 1.08-3.52s2.2-.2 3.5.8M4.26 11.2c-.08 1.34.28 2.03.68 2.26s1.15.22 2.25-.52l.11-.09a12 12 0 0 1-1.24-1.39 11 11 0 0 1-1.8-.41zm7.47-.15q-.83.27-1.79.41-.6.8-1.24 1.4l.11.08c1.1.74 1.86.76 2.25.52.4-.23.76-.92.68-2.26zm-3.04.54a14 14 0 0 1-1.38 0q.34.38.69.7.35-.32.7-.7M8 5.29q-.76 0-1.47.1A13 13 0 0 0 5.07 8a14 14 0 0 0 1.46 2.62 13 13 0 0 0 2.94 0A13 13 0 0 0 10.93 8a14 14 0 0 0-1.46-2.62A13 13 0 0 0 8 5.3M4.64 9.18q-.15.5-.25.96.44.16.94.27a15 15 0 0 1-.7-1.23m6.73 0a15 15 0 0 1-.7 1.23q.5-.11.95-.27a10 10 0 0 0-.25-.96M3.44 6.26C2.27 6.86 1.87 7.53 1.87 8s.4 1.14 1.57 1.74l.13.07q.18-.88.55-1.81a12 12 0 0 1-.55-1.8q-.07.02-.13.06m8.99-.07A12 12 0 0 1 11.88 8q.36.94.55 1.8l.13-.06c1.17-.6 1.56-1.27 1.56-1.74s-.39-1.14-1.56-1.74zm-7.1-.6q-.5.11-.94.27.1.46.25.96a15 15 0 0 1 .69-1.23m5.34 0a15 15 0 0 1 .7 1.23q.14-.5.24-.96-.44-.15-.94-.27M7.18 3.06c-1.09-.74-1.85-.76-2.24-.52s-.76.92-.69 2.26l.01.15a11 11 0 0 1 1.8-.41q.6-.8 1.24-1.4zm3.88-.52c-.4-.24-1.15-.22-2.25.52l-.12.08q.65.6 1.25 1.4.96.15 1.8.41v-.14c.08-1.35-.28-2.04-.68-2.27M8 3.7a10 10 0 0 0-.7.7 14 14 0 0 1 1.4 0 10 10 0 0 0-.7-.7" clipRule="evenodd"/></svg>
  if (extension === "md") return <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" className="noa-glyph-green"><path fill="currentColor" d="M1 12V4h2l2 2.5L7 4h2v8H7V7.5l-2 2-2-2V12zm9-3 3 3.5L16 9h-2V4h-2v5z"/></svg>
  const glyph = GLYPHS[name.split(".").pop()?.toLowerCase() ?? ""]
  if (!glyph) return <FileText size={15} />
  const Glyph = glyph[0]
  return <Glyph size={15} style={{ color: glyph[1] }} />
}
// Middle truncation as in Codex's path labels: the directory shrinks first, the file name stays whole.
function MiddlePath({ path }: { path: string }) {
  const cut = path.lastIndexOf("/")
  return <span className="noa-middle-path">{cut >= 0 && <span className="noa-middle-path-dir">{path.slice(0, cut + 1)}</span>}<span className="noa-middle-path-base">{path.slice(cut + 1)}</span></span>
}

// Codex's git lane glyphs (base-file-tree): a rounded square holding a plus, minus or dot.
const GIT_FRAME = "M12.666 2.66797C13.3549 2.66797 13.9121 2.66735 14.3623 2.7041C14.8202 2.74151 15.2268 2.82084 15.6035 3.0127C16.1989 3.31608 16.6829 3.80115 16.9863 4.39649C17.1781 4.77304 17.2575 5.17902 17.2949 5.63672C17.3317 6.08689 17.3311 6.64406 17.3311 7.33301V12.666C17.3311 13.3549 17.3317 13.9121 17.2949 14.3623C17.2575 14.8203 17.1782 15.2268 16.9863 15.6035C16.6829 16.1988 16.1988 16.6829 15.6035 16.9863C15.2268 17.1783 14.8203 17.2575 14.3623 17.2949C13.9121 17.3317 13.3549 17.3311 12.666 17.3311H7.33301C6.64403 17.3311 6.08691 17.3317 5.63672 17.2949C5.17899 17.2575 4.77306 17.1781 4.39649 16.9863C3.80114 16.6829 3.31609 16.1989 3.0127 15.6035C2.82085 15.2269 2.74151 14.8202 2.7041 14.3623C2.66736 13.9122 2.66797 13.3548 2.66797 12.666V7.33301C2.66797 6.64406 2.66732 6.08689 2.7041 5.63672C2.74152 5.17904 2.82093 4.77302 3.0127 4.39649C3.31613 3.80104 3.80103 3.31611 4.39649 3.0127C4.77304 2.82092 5.17902 2.74152 5.63672 2.7041C6.08691 2.66732 6.64403 2.66797 7.33301 2.66797H12.666ZM7.33301 3.99805C6.6221 3.99805 6.12859 3.99894 5.74512 4.03027C5.36955 4.06098 5.15798 4.11775 5 4.19824C4.65484 4.37414 4.37416 4.65485 4.19824 5C4.11775 5.15797 4.06098 5.36959 4.03027 5.74512C3.99894 6.12858 3.99805 6.62214 3.99805 7.33301V12.666C3.99805 13.3767 3.99898 13.8705 4.03027 14.2539C4.06094 14.6292 4.11788 14.8411 4.19824 14.999C4.37412 15.3442 4.65487 15.6258 5 15.8018C5.15795 15.8822 5.36972 15.939 5.74512 15.9697C6.12859 16.0011 6.6221 16.001 7.33301 16.001H12.666C13.3767 16.001 13.8705 16.001 14.2539 15.9697C14.6292 15.9391 14.8411 15.8821 14.999 15.8018C15.3443 15.6258 15.6258 15.3443 15.8018 14.999C15.8821 14.8411 15.9391 14.6292 15.9697 14.2539C16.001 13.8705 16.001 13.3767 16.001 12.666V7.33301C16.001 6.62213 16.0011 6.12858 15.9697 5.74512C15.939 5.36976 15.8822 5.15795 15.8018 5C15.6258 4.65488 15.3442 4.37411 14.999 4.19824C14.8411 4.11787 14.6292 4.06094 14.2539 4.03027C13.8705 3.99898 13.3767 3.99805 12.666 3.99805H7.33301Z"
const GIT_MARK = {
  added: "M10 6.41797C10.367 6.41815 10.6649 6.71599 10.665 7.08301V9.33496H12.916C13.2832 9.33496 13.5809 9.63287 13.5811 10C13.5809 10.3671 13.2832 10.665 12.916 10.665H10.665V12.916C10.665 13.2832 10.3671 13.5809 10 13.5811C9.63284 13.5809 9.33496 13.2832 9.33496 12.916V10.665H7.08301C6.71596 10.6649 6.41815 10.367 6.41797 10C6.41813 9.63295 6.71595 9.33509 7.08301 9.33496H9.33496V7.08301C9.33513 6.71596 9.63295 6.4181 10 6.41797Z",
  deleted: "M12.916 9.33496C13.2833 9.33496 13.5811 9.63273 13.5811 10C13.5811 10.3673 13.2833 10.665 12.916 10.665H7.08301C6.71585 10.6649 6.41797 10.3672 6.41797 10C6.41797 9.63281 6.71585 9.33509 7.08301 9.33496H12.916Z",
  modified: "M10 8.33301C10.9205 8.33301 11.667 9.07953 11.667 10C11.667 10.9205 10.9205 11.667 10 11.667C9.07961 11.6669 8.334 10.9204 8.33399 10C8.33399 9.07958 9.0796 8.3331 10 8.33301Z",
}
const toneOf = (status: string) => status.includes("D") ? "deleted" : status === "??" || status.includes("A") ? "added" : "modified"
function GitMark({ status }: { status: string }) {
  const tone = toneOf(status)
  return <svg width={20} height={20} viewBox="0 0 20 20" className={`noa-git-mark is-${tone}`} aria-label={tone}><path d={GIT_MARK[tone]} fill="currentColor" /><path d={GIT_FRAME} fill="currentColor" /></svg>
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

export function WorkspaceFiles({ cwd, changes = false, focus, active = true, refreshKey, onReference, onUpdated, onOpenChanges }: {
  cwd: string; changes?: boolean; focus?: { path: string; at: number; line?: number; endLine?: number; scope?: "all" }; active?: boolean; refreshKey: number; onReference: (path: string) => void; onUpdated?: () => void; onOpenChanges?: (path?: string) => void
}) {
  const [selected, setSelected] = useState<string>()
  const [view, setView] = useState(changes ? "diff" : "file")
  const [scope, setScope] = useState("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tree, setTree] = useState<Record<string, Entry[]>>({})
  const [matches, setMatches] = useState<Entry[]>([])
  const [status, setStatus] = useState<(Changes & { scope: string })>()
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [statusError, setStatusError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState("")
  const [search, setSearch] = useState("")
  const [split, setSplit] = useState(() => localStorage.getItem("noa-diff-layout") === "split")
  const [wrap, setWrap] = useState(() => changes ? localStorage.getItem("noa-diff-wrap-v2") !== "false" : localStorage.getItem("noa-code-wrap") === "true")
  const [context, setContext] = useState("")
  const [findRequest, setFindRequest] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [action, setAction] = useState("")
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [viewed, setViewed] = useState<Record<string, string>>({})
  const { confirm, dialog } = useConfirm()
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
    if (changes) localStorage.setItem("noa-diff-layout", split ? "split" : "unified")
    localStorage.setItem(changes ? "noa-diff-wrap-v2" : "noa-code-wrap", String(wrap))
  }, [split, wrap, changes])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    load<Changes>("changes", cwd, { scope }, controller.signal).then((value) => { if (!controller.signal.aborted) { setStatus({ ...value, scope }); setStatusError(undefined) } }).catch((e) => { if (!controller.signal.aborted) setStatusError(e.message) })
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

  const select = async (path?: string, nextView = changes ? "diff" : "file", nextScope?: "all") => {
    if (dirty && !(await confirm({
      title: "Discard unsaved edits?",
      description: `Changes to ${selected} have not been saved.`,
      confirmLabel: "Discard",
      danger: true,
    }))) return
    if (draftKey) sessionStorage.removeItem(draftKey)
    if (nextScope) { setStatusError(undefined); setScope(nextScope) }
    setEditing(false); setSelected(path); setView(nextView); setContext(""); setFindRequest(0); setError(undefined); setActionError(undefined)
  }  // Opening a file from the turn's change summary jumps straight to its diff.
  useEffect(() => {
    if (!focus) return
    void select(focus.path, changes ? "diff" : "file", changes ? focus.scope : undefined)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const gitAction = async (kind: string, hunk?: number) => {
    if (kind.startsWith("revert")) {
      const ok = await confirm(hunk !== undefined
        ? { title: "Revert this hunk?", description: `Revert hunk ${hunk + 1} in ${selected}? This cannot be undone.`, confirmLabel: "Revert", danger: true }
        : scope === "staged"
          ? { title: "Unstage these changes?", description: `Remove the staged changes for ${selected}? Working files will be kept.`, confirmLabel: "Unstage", danger: true }
          : { title: "Discard these changes?", description: `Discard changes to ${selected}? This cannot be undone. Untracked files will be deleted.`, confirmLabel: "Discard", danger: true })
      if (!ok) return
    }
    setAction(kind); setActionError(undefined)
    try {
      await load("git-action", cwd, { scope, context }, undefined, { action: kind, path: selected, snapshot: current?.snapshot, hunk })
      if (hunk === undefined) await select()
      setTick((n) => n + 1); onUpdated?.()
    } catch (e) { setActionError((e as Error).message) } finally { setAction("") }
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
  const onTreeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="treeitem"]')
    if (!item || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
    const index = items.indexOf(item)
    const expanded = item.getAttribute("aria-expanded")
    let target: HTMLElement | null | undefined
    if (event.key === "ArrowDown") target = items[index + 1]
    else if (event.key === "ArrowUp") target = items[index - 1]
    else if (event.key === "Home") target = items[0]
    else if (event.key === "End") target = items.at(-1)
    else if (event.key === "ArrowRight" && expanded === "false") item.click()
    else if (event.key === "ArrowRight" && expanded === "true") target = item.nextElementSibling?.querySelector<HTMLElement>('[role="treeitem"]')
    else if (event.key === "ArrowLeft" && expanded === "true") item.click()
    else if (event.key === "ArrowLeft") target = item.parentElement?.closest('[role="group"]')?.previousElementSibling as HTMLElement | null
    event.preventDefault()
    target?.focus()
  }
  const row = (key: string, name: string, depth: number, opts: { directory?: boolean; opened?: boolean; marked?: boolean; change?: Change; stats?: boolean; onClick: () => void; title?: string }) => {
    const tone = opts.change ? toneOf(opts.change.status) : undefined
    // Open folders stick under their ancestors (one 28px row per level), as Codex's tree does.
    const sticky = opts.directory && opts.opened && depth >= rootDepth ? { position: "sticky" as const, top: (depth - rootDepth) * 28, zIndex: 20 - depth } : undefined
    return <button key={key} type="button" className={`noa-file-row${tone ? ` is-${tone}` : ""}${sticky ? " is-sticky" : ""}`} role="treeitem" aria-expanded={opts.directory ? !!opts.opened : undefined} style={sticky} title={opts.title ?? key} onClick={opts.onClick}>
      {depth > 0 && <span className={`noa-file-guides${opts.directory ? " is-folder" : ""}`} aria-hidden="true">{Array.from({ length: depth }, (_, i) => <span key={i} />)}</span>}
      <span className="noa-file-icon">{opts.directory ? <ChevronDown size={14} className={opts.opened ? undefined : "-rotate-90"} /> : <FileGlyph name={name} />}</span>
      <span className="noa-file-name">{name}</span>
      {opts.stats && opts.change && !opts.change.binary && <span className="noa-row-stats">{opts.change.additions > 0 && <span className="is-added">+{opts.change.additions}</span>}{opts.change.deletions > 0 && <span className="is-removed">-{opts.change.deletions}</span>}</span>}
      {(opts.change || opts.marked) && <span className="noa-git-lane">{opts.change ? <GitMark status={opts.change.status} /> : <span className="noa-file-dot" aria-label="Contains changes" />}</span>}
    </button>
  }
  const sectioned = !search && !!status?.isGit && status.files.length > 0
  const rootDepth = sectioned && !changes ? 1 : 0
  const section = (key: string, label: string) => row(key, label, 0, { directory: true, opened: !closed.has(key), onClick: () => toggleClosed(key) })
  const treeRows = (directory: string, depth = rootDepth): React.ReactNode => (search ? matches : tree[directory] ?? []).map((entry) => {
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
    {node.files.sort((a, b) => a.path.localeCompare(b.path)).map((file) => row(file.path, file.path.split("/").pop()!, depth, { change: file, stats: changes, title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path, onClick: () => !changes && file.status.includes("D") ? onOpenChanges?.(file.path) : select(file.path, changes ? "diff" : "file") }))}
  </>
  const currentStatus = status?.scope === scope ? status : undefined
  const selectedChange = currentStatus?.files.find((f) => f.path === selected)
  const changeFiles = currentStatus?.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())) ?? []
  const button = "noa-panel-button"

  return <div className={`noa-workspace-panel${changes ? " is-review" : ""}`}>
    {dialog}
    {(selected || changes) && <div className="noa-panel-toolbar">
      {selected && <button type="button" className={button} aria-label="Back to files" onClick={() => select()}><ArrowLeft size={14} /></button>}
      <span className="noa-panel-title" title={selected ?? cwd}>{selected ? <MiddlePath path={selected} /> : (changes ? <span className="noa-branch">{status?.isGit && <GitBranch size={14} />}{status?.branch || "Changes"}</span> : "Project files")}</span>
      {selected && changes && selectedChange && count(selectedChange)}
      {!selected && changes && currentStatus?.isGit && (currentStatus.additions > 0 || currentStatus.deletions > 0) && <span className="noa-row-stats"><span className="is-added">+{currentStatus.additions}</span><span className="is-removed">-{currentStatus.deletions}</span></span>}
      {selected && <><button type="button" className={button} aria-label="Copy file path" title="Copy path" onClick={copyPath}><Copy size={14} /></button><button type="button" className={button} title="Add to chat" aria-label="Add file to chat" onClick={() => onReference(selected)}><Plus size={14} /></button></>}
      {!selected && !changes && expanded.size > 0 && <button type="button" className={button} onClick={() => setExpanded(new Set())}>Collapse all</button>}
      <button type="button" className={button} aria-label={editing ? "Reload file" : changes ? "Refresh changes" : "Refresh files"} disabled={!!action} onClick={() => { if (editing) void select(selected, view); else setTick((n) => n + 1) }}><RefreshCcw size={14} /></button>
    </div>}
    {selected ? <>
      {selectedChange?.oldPath && <div className="noa-file-breadcrumb">{selectedChange.oldPath} → {selected}</div>}
      <div className="noa-panel-toolbar noa-panel-actions">
        {changes && <><button type="button" className={button} aria-pressed={view === "diff"} onClick={() => select(selected, view === "diff" ? "file" : "diff")}>{view === "diff" ? "Open file" : "Show diff"}</button>{view === "diff" && <><select aria-label="Changes scope" value={scope} onChange={(e) => { setStatusError(undefined); setScope(e.target.value) }}><option value="all">All</option><option value="unstaged">Unstaged</option><option value="staged">Staged</option></select><div className="noa-segmented" role="radiogroup" aria-label="Diff layout"><button type="button" role="radio" aria-checked={!split} onClick={() => setSplit(false)}>Unified</button><button type="button" role="radio" aria-checked={split} onClick={() => setSplit(true)}>Split</button></div></>}</>}
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
        {view === "file" && current?.kind === "text" && (editing ? <><button type="button" className={button} disabled={!!action} onClick={async () => { if (!dirty || (await confirm({ title: "Discard unsaved edits?", description: `Changes to ${selected} have not been saved.`, confirmLabel: "Discard", danger: true }))) { sessionStorage.removeItem(draftKey); setEditing(false) } }}>Cancel</button><button type="button" className={button} disabled={!dirty || !!action} onClick={save}>{action === "save" ? "Saving…" : "Save"}</button></> : <button type="button" className={button} onClick={() => { setDraft(current.content ?? ""); setEditing(true) }}>Edit</button>)}
      </div>
    </> : <>
      {changes && status?.isGit && <div className="noa-panel-toolbar"><div className="noa-segmented" role="radiogroup" aria-label="Changes scope">{[["all", "All"], ["unstaged", "Unstaged"], ["staged", "Staged"]].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={scope === id} onClick={() => { setStatusError(undefined); setScope(id!); setPreview(undefined) }}>{label}</button>)}</div></div>}
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
    {actionError && <p className="noa-panel-error" role="alert">{actionError}</p>}
    {statusError && <p className="noa-panel-error" role="alert">Could not load changes: {statusError}{currentStatus && " · Showing last result"} <button type="button" className={button} onClick={() => setTick((n) => n + 1)}>Retry</button></p>}
    {loading && !current && selected && <p className="noa-panel-empty" role="status">Loading…</p>}
    <div className="noa-panel-body">
      {selected ? current && (editing ? <textarea aria-label="Edit file content" className="noa-file-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} /> : current.kind === "image" ? <div className="noa-image-preview"><img src={current.dataUrl} alt={selected} /></div> : current.kind === "binary" ? <p className="noa-panel-empty">Binary file cannot be previewed</p> : current.truncated ? <p className="noa-panel-empty">Diff too large to display. Open the file in your editor to review it.</p> : <Suspense fallback={<p className="noa-panel-empty">Loading code viewer…</p>}><CodeView focusRequest={focus?.path === selected ? focus.at : undefined} focusLine={focus?.path === selected ? focus.line : undefined} focusEndLine={focus?.path === selected ? focus.endLine : undefined} path={selected} content={current.content ?? ""} diff={view === "diff"} split={split} wrap={wrap} hunkScope={scope !== "all" && !selectedChange?.oldPath && !action ? scope : undefined} onHunkAction={gitAction} findRequest={findRequest} onCloseFind={() => setFindRequest(0)} /></Suspense>)
        : changes ? !currentStatus ? !statusError && <p className="noa-panel-empty" role="status">Loading changes…</p> : currentStatus.isGit === false ? <div className="noa-panel-empty"><p>This folder is not a Git repository</p><button type="button" className={button} disabled={!!action} onClick={() => gitAction("init")}>Create Git repository</button></div> : <div role="tree" aria-label="Changed files" className="noa-file-tree" onKeyDown={onTreeKey}>{changeFiles.length ? changedRows(changeTree(changeFiles), "", 0) : <div className="noa-panel-empty">{!filter && <CheckCircle2 size={20} />}<p>{filter ? "No matching files" : scope === "staged" ? "No staged changes" : scope === "unstaged" ? "No unstaged changes" : "Working tree clean"}</p></div>}</div>
        : <div role="tree" aria-label="Project files" className="noa-file-tree" onKeyDown={onTreeKey}>{!search && onOpenChanges && status?.isGit && <button type="button" role="treeitem" className="noa-file-row" onClick={() => onOpenChanges()}><span className="noa-file-icon"><ListDetails size={15} /></span><span className="noa-file-name">All changes</span></button>}
          {sectioned && <>{section("@changed", "Changed files")}{!closed.has("@changed") && <div role="group">{changedRows(changeTree(status!.files))}</div>}
          <div className="noa-file-divider" role="none" />{section("@all", "All files")}</>}
          {(search || !closed.has("@all")) && (sectioned ? <div role="group">{treeRows("")}</div> : treeRows(""))}{loading && !tree[""] && <p className="noa-panel-empty" role="status">{search ? "Searching files…" : "Loading directory entries…"}</p>}{!loading && !error && (search ? !matches.length : !tree[""]?.length) && <p className="noa-panel-empty">{search ? "No matching files" : "No files in this folder"}</p>}</div>}
    </div>
    {(current?.truncated || !selected && truncated) && <p className="noa-panel-notice">Preview limit reached; some content is omitted.</p>}
  </div>
}
