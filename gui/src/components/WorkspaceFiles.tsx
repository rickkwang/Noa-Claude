import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { query } from "../api"
import { useConfirm } from "./ConfirmDialog"
import { FileMenu, loadEditors, openPath, revealLabel, type Editor, type FileMenuTarget } from "./FileMenu"
import { useDiffPref } from "../lib/diffPrefs"
import { ArrowLeft, ArrowUpRight, CheckCircle2, GitBranch, BrandCss3, BrandHtml5, BrandJavascript, BrandPython, BrandReact, BrandTypescript, ChevronDown, Copy, FileText, Folder, Json, ListDetails, Markdown, MoreHorizontal, Photo, PlusMinus, RefreshCcw, Search, SquarePen } from "../lib/icons"

const CodeView = lazy(() => import("./CodeView"))
type Entry = { name: string; path: string; directory: boolean }
type Change = { path: string; oldPath?: string; status: string; additions: number; deletions: number; binary: boolean }
type Changes = { isGit: boolean; branch: string; files: Change[]; additions: number; deletions: number }
type Preview = { path: string; scope: string; view: string; content?: string; snapshot?: string; revision?: string; truncated?: boolean; binary?: boolean; kind?: string; dataUrl?: string }

// File-type glyphs and brand colors.
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
// Middle truncation for path labels: the directory shrinks first, the file name stays whole.
function MiddlePath({ path }: { path: string }) {
  const cut = path.lastIndexOf("/")
  return <span className="noa-middle-path">{cut >= 0 && <span className="noa-middle-path-dir">{path.slice(0, cut + 1)}</span>}<span className="noa-middle-path-base">{path.slice(cut + 1)}</span></span>
}

// Git lane glyphs: a rounded square holding a plus, minus or dot.
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

// "?query" in the Files filter searches file contents. Grouping follows Claude Code: at most 200 matches
// shown, 5 per file (the rest of that file becomes "More matches in this file."), from 241 requested.
type GrepMatch = { path: string; line: number; column: number; preview: string }
type GrepGroup = { path: string; matches: GrepMatch[]; more: boolean }
const GREP_REQUEST = 241, GREP_SHOWN = 200, GREP_PER_FILE = 5
function groupMatches(matches: GrepMatch[]) {
  let truncated = matches.length >= GREP_REQUEST, shown = 0
  const groups = new Map<string, GrepGroup>()
  for (const match of matches) {
    const group = groups.get(match.path)
    if (group && group.matches.length >= GREP_PER_FILE) group.more = true
    else if (shown >= GREP_SHOWN) { truncated = true; if (group) group.more = true }
    else { if (group) group.matches.push(match); else groups.set(match.path, { path: match.path, matches: [match], more: false }); shown++ }
  }
  return { groups: [...groups.values()], shown, truncated }
}
// The preview with whitespace runs collapsed and the query marked, smart case as the search itself.
function Snippet({ text, query }: { text: string; query: string }) {
  const line = text.trim().replace(/\s+/g, " ")
  const fold = query === query.toLowerCase()
  const hay = fold ? line.toLowerCase() : line
  const parts: ReactNode[] = []
  let from = 0
  for (let at = query ? hay.indexOf(query) : -1; at >= 0; at = hay.indexOf(query, at + query.length)) {
    parts.push(line.slice(from, at), <mark key={at}>{line.slice(at, at + query.length)}</mark>)
    from = at + query.length
  }
  parts.push(line.slice(from))
  return <>{parts}</>
}

// The folder rows changedRows renders, so "Collapse all files" / "Expand all files" can address every one.
function changeFolders(node: ChangeNode, base = ""): string[] {
  return [...node.dirs].flatMap(([name, child]) => {
    let label = name, leaf = child
    while (leaf.files.length === 0 && leaf.dirs.size === 1) { const [next, deeper] = [...leaf.dirs][0]!; label += `/${next}`; leaf = deeper }
    const path = base ? `${base}/${label}` : label
    return [path, ...changeFolders(leaf, path)]
  })
}

async function load<T>(route: string, cwd: string, params: Record<string, string> = {}, signal?: AbortSignal, body?: unknown): Promise<T> {
  const suffix = new URLSearchParams(params)
  const response = await fetch(`/api/${route}${query(cwd)}&${suffix}`, { signal, ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? "Could not load workspace")
  return value as T
}

export function WorkspaceFiles({ cwd, changes = false, scope: scopeProp, focus, reveal, foldAll, canSplit = true, active = true, refreshKey, onReference, onUpdated, onOpenChanges, onRevealInTree }: {
  cwd: string; changes?: boolean; scope?: string; focus?: { path: string; at: number; line?: number; endLine?: number; scope?: "all" }
  // Files tab: show this path in the tree. Changes tab: fold or unfold every folder of the grouped list.
  reveal?: { path: string; at: number }; foldAll?: { collapsed: boolean; seq: number }; canSplit?: boolean
  active?: boolean; refreshKey: number; onReference: (path: string) => void; onUpdated?: () => void; onOpenChanges?: (path?: string) => void; onRevealInTree?: (path: string) => void
}) {
  const [selected, setSelected] = useState<string>()
  const [view, setView] = useState(changes ? "diff" : "file")
  const [ownScope, setScope] = useState("all")
  // The Changes tab owns the review source (its toolbar selector); Files keeps its own.
  const scope = scopeProp ?? ownScope
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
  // Diff layout comes from the shared Changes options; the file viewer keeps its own wrap setting.
  const [codeWrap, setCodeWrap] = useState(() => localStorage.getItem("noa-code-wrap") === "true")
  const [context, setContext] = useState("")
  const [findRequest, setFindRequest] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [action, setAction] = useState("")
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [viewed, setViewed] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState<FileMenuTarget>()
  const [fileTree] = useDiffPref("fileTree")
  const [wordDiff] = useDiffPref("wordDiff")
  const [hideWhitespace] = useDiffPref("hideWhitespace")
  const [sideBySide] = useDiffPref("sideBySide")
  const [wordWrap] = useDiffPref("wordWrap")
  const pendingReveal = useRef<string | undefined>(undefined)
  const [grep, setGrep] = useState<ReturnType<typeof groupMatches> & { query: string }>()
  const [jump, setJump] = useState<{ path: string; line: number; at: number }>()
  const [gotoRequest, setGotoRequest] = useState(0)
  const [diskNotice, setDiskNotice] = useState<string>()
  const [editors, setEditors] = useState<Editor[]>([])
  useEffect(() => { void loadEditors(cwd).then(setEditors) }, [cwd])
  const contentMode = !changes && filter.startsWith("?")
  const contentQuery = !changes && search.startsWith("?") ? search.slice(1).trimStart() : undefined
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
  useEffect(() => { localStorage.setItem("noa-code-wrap", String(codeWrap)) }, [codeWrap])
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
      : contentQuery !== undefined ? Promise.resolve()
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

  useEffect(() => {
    if (!foldAll || !status) return
    const folders = changeFolders(changeTree(status.files)).map((path) => `c:${path}`)
    setClosed((previous) => {
      const next = new Set([...previous].filter((key) => !key.startsWith("c:")))
      if (foldAll.collapsed) for (const key of folders) next.add(key)
      return next
    })
  }, [foldAll?.seq]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Reveal in file tree": leave any open file, clear the filter, and open every folder above the path.
  useEffect(() => {
    if (!reveal) return
    void select().then(() => {
      setFilter(""); setSearch("")
      setClosed((previous) => { const next = new Set(previous); next.delete("@all"); return next })
      const parts = reveal.path.split("/")
      setExpanded((previous) => new Set([...previous, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))]))
      pendingReveal.current = reveal.path
    })
  }, [reveal?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const path = pendingReveal.current
    if (!path || selected) return
    const row = document.querySelector<HTMLElement>(`#panel-files [data-tree-path="${CSS.escape(path)}"]`)
    if (!row) return
    pendingReveal.current = undefined
    row.scrollIntoView({ block: "center" })
    row.focus({ preventScroll: true })
  }, [tree, selected])

  // A different review source may not contain the open file; return to the list.
  const prevScope = useRef(scopeProp)
  const prevFocus = useRef(focus)
  useEffect(() => {
    const scopeChanged = prevScope.current !== scopeProp
    const focusChanged = prevFocus.current !== focus
    prevScope.current = scopeProp
    prevFocus.current = focus
    if (changes && scopeChanged && !focusChanged) void select()
  }, [scopeProp, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Content search runs when the query changes (or on an explicit refresh), never on the 3s poll:
  // a search over a large tree can outlast the poll interval.
  const [grepping, setGrepping] = useState(false)
  useEffect(() => {
    if (!active || contentQuery === undefined) return
    if (!contentQuery) { setGrep(undefined); return }
    const controller = new AbortController()
    setGrepping(true)
    load<{ matches: GrepMatch[] }>("grep", cwd, { q: contentQuery, max: String(GREP_REQUEST) }, controller.signal)
      .then((body) => setGrep({ query: contentQuery, ...groupMatches(body.matches) }))
      .catch((e) => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setGrepping(false) })
    return () => controller.abort()
  }, [cwd, contentQuery, refreshKey, active])

  // While editing, say so when the file changes or disappears on disk (saving would refuse either way).
  useEffect(() => {
    setDiskNotice(undefined)
    if (!editing || !selected || !active) return
    const baseline = current?.revision
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      load<Preview>("file", cwd, { path: selected })
        .then((body) => setDiskNotice(body.revision && body.revision !== baseline ? "This file changed on disk since you started editing." : undefined))
        .catch((e: Error) => setDiskNotice(/ENOENT|no such file/i.test(e.message) ? "This file was deleted on disk since you started editing." : undefined))
    }, 3000)
    return () => clearInterval(timer)
  }, [editing, selected, active, cwd]) // eslint-disable-line react-hooks/exhaustive-deps
  const openMatch = (path: string, line?: number) => {
    if (line) setJump({ path, line, at: Date.now() })
    void select(path, "file")
  }
  const download = () => {
    if (!current || !selected) return
    const link = document.createElement("a")
    const url = current.kind === "image" ? current.dataUrl! : URL.createObjectURL(new Blob([current.content ?? ""], { type: "text/plain" }))
    link.href = url; link.download = selected.split("/").pop() ?? "file"; link.click()
    if (current.kind !== "image") setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
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
  const openMenu = (event: MouseEvent<HTMLButtonElement>, path: string, directory: boolean, gone?: boolean) => {
    event.preventDefault()
    // The keyboard context-menu key reports no pointer position; anchor to the row instead.
    const rect = event.currentTarget.getBoundingClientRect()
    const fromKeyboard = event.clientX === 0 && event.clientY === 0
    setMenu({ x: fromKeyboard ? rect.left + 24 : event.clientX, y: fromKeyboard ? rect.bottom : event.clientY, path, directory, gone })
  }
  const row = (key: string, name: string, depth: number, opts: { directory?: boolean; opened?: boolean; marked?: boolean; change?: Change; stats?: boolean; onClick: () => void; title?: string; label?: ReactNode; menuPath?: string; treePath?: string }) => {
    const tone = opts.change ? toneOf(opts.change.status) : undefined
    const menuPath = opts.menuPath
    // Open folders stick under their ancestors (one 28px row per level).
    const sticky = opts.directory && opts.opened && depth >= rootDepth ? { position: "sticky" as const, top: (depth - rootDepth) * 28, zIndex: 20 - depth } : undefined
    return <button key={key} type="button" className={`noa-file-row${tone ? ` is-${tone}` : ""}${sticky ? " is-sticky" : ""}`} role="treeitem" aria-expanded={opts.directory ? !!opts.opened : undefined} style={sticky} title={opts.title ?? key} data-tree-path={opts.treePath} onClick={opts.onClick} onContextMenu={menuPath === undefined ? undefined : (event) => openMenu(event, menuPath, !!opts.directory, !!opts.change?.status.includes("D"))}>
      {depth > 0 && <span className={`noa-file-guides${opts.directory ? " is-folder" : ""}`} aria-hidden="true">{Array.from({ length: depth }, (_, i) => <span key={i} />)}</span>}
      <span className="noa-file-icon">{opts.directory ? <ChevronDown size={14} className={opts.opened ? undefined : "-rotate-90"} /> : <FileGlyph name={name} />}</span>
      <span className="noa-file-name">{opts.label ?? name}</span>
      {opts.stats && opts.change && !opts.change.binary && <span className="noa-row-stats">{opts.change.additions > 0 && <span className="is-added">+{opts.change.additions}</span>}{opts.change.deletions > 0 && <span className="is-removed">-{opts.change.deletions}</span>}</span>}
      {(opts.change || opts.marked) && <span className="noa-git-lane">{opts.change ? <GitMark status={opts.change.status} /> : <span className="noa-file-dot" aria-label="Contains changes" />}</span>}
    </button>
  }
  const sectioned = !search && !!status?.isGit && status.files.length > 0
  const rootDepth = sectioned && !changes ? 1 : 0
  const section = (key: string, label: string) => row(key, label, 0, { directory: true, opened: !closed.has(key), onClick: () => toggleClosed(key) })
  const treeRows = (directory: string, depth = rootDepth): React.ReactNode => (search ? matches : tree[directory] ?? []).map((entry) => {
    const opened = expanded.has(entry.path)
    return <div key={entry.path} role="none">{row(entry.path, search ? entry.path : entry.name, search ? 0 : depth, { menuPath: entry.path, treePath: search ? undefined : entry.path, directory: entry.directory && !search, opened, marked: entry.directory && dirty_(entry.path), change: status?.files.find((f) => f.path === entry.path), onClick: () => {
      if (!entry.directory) select(entry.path, "file")
      else setExpanded((previous) => { const next = new Set(previous); if (next.has(entry.path)) { for (const p of next) if (p === entry.path || p.startsWith(entry.path + "/")) next.delete(p) } else next.add(entry.path); return next })
    } })}{entry.directory && opened && <div role="group">{treeRows(entry.path, depth + 1)}</div>}</div>
  })
  const changedFile = (file: Change, depth: number, label?: ReactNode) => row(file.path, file.path.split("/").pop()!, depth, { menuPath: file.path, label, change: file, stats: changes, title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path, onClick: () => !changes && file.status.includes("D") ? onOpenChanges?.(file.path) : select(file.path, changes ? "diff" : "file") })
  const changedRows = (node: ChangeNode, base = "", depth = 1): React.ReactNode => <>
    {[...node.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      // Fold single-directory chains into one row, as the full tree does.
      let label = name, leaf = child
      while (leaf.files.length === 0 && leaf.dirs.size === 1) { const [next, deeper] = [...leaf.dirs][0]!; label += `/${next}`; leaf = deeper }
      const path = base ? `${base}/${label}` : label, opened = !closed.has(`c:${path}`)
      return <div key={path} role="none">{row(`c:${path}`, label, depth, { menuPath: path, directory: true, opened, marked: true, title: path, onClick: () => toggleClosed(`c:${path}`) })}{opened && <div role="group">{changedRows(leaf, path, depth + 1)}</div>}</div>
    })}
    {node.files.sort((a, b) => a.path.localeCompare(b.path)).map((file) => changedFile(file, depth))}
  </>
  const currentStatus = status?.scope === scope ? status : undefined
  const selectedChange = currentStatus?.files.find((f) => f.path === selected)
  const changeFiles = currentStatus?.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())) ?? []
  const button = "noa-panel-button"
  // The newest of a content-search jump and an external focus decides which line the viewer shows.
  const lineTarget = jump && jump.path === selected && !(focus && focus.path === selected && focus.at > jump.at) ? jump : focus?.path === selected ? focus : undefined
  const contentResults = !contentQuery ? <p className="noa-panel-empty">Type after ? to search in files</p>
    : grep?.query !== contentQuery ? grepping && <p className="noa-panel-empty" role="status">Searching files…</p>
    : !grep.groups.length ? <p className="noa-panel-empty">No matches in file contents</p>
    : <>{grep.groups.map((group) => <div key={group.path} role="none">
        {row(`g:${group.path}`, group.path.split("/").pop()!, 0, { menuPath: group.path, title: group.path, label: <><span>{group.path.split("/").pop()}</span>{group.path.includes("/") && <span className="noa-grep-dir">{group.path.slice(0, group.path.lastIndexOf("/"))}</span>}</>, onClick: () => openMatch(group.path) })}
        {group.matches.map((match) => <button key={`${match.line}:${match.column}`} type="button" role="treeitem" className="noa-file-row noa-grep-match" title={`${match.path}:${match.line}`} onClick={() => openMatch(match.path, match.line)}>
          <span className="noa-grep-line">{match.line}</span><span className="noa-grep-text"><Snippet text={match.preview} query={grep.query} /></span>
        </button>)}
        {group.more && <div className="noa-grep-more" aria-hidden="true">More matches in this file.</div>}
      </div>)}
      {grep.truncated && <p className="noa-panel-notice">Only {grep.shown} {grep.shown === 1 ? "match is" : "matches are"} shown. Keep typing to narrow.</p>}</>

  return <div className={`noa-workspace-panel${changes ? " is-review" : ""}`}>
    {dialog}
    {menu && <FileMenu cwd={cwd} target={menu} onClose={() => setMenu(undefined)} onReference={onReference} onRevealInTree={onRevealInTree} onError={setActionError} />}
    {(selected || changes) && <div className="noa-panel-toolbar noa-file-header">
      {selected && <button type="button" className={button} aria-label="Back to files" title="Back" onClick={() => select()}><ArrowLeft size={14} /></button>}
      <span className="noa-panel-title" title={selectedChange?.oldPath ? `Renamed from ${selectedChange.oldPath}` : selected ?? cwd}>{selected ? <MiddlePath path={selected} /> : (changes ? <span className="noa-branch">{status?.isGit && <GitBranch size={14} />}{status?.branch || "Changes"}</span> : "Project files")}</span>
      {selected && changes && view === "diff" && selectedChange && count(selectedChange)}
      {!selected && changes && currentStatus?.isGit && (currentStatus.additions > 0 || currentStatus.deletions > 0) && <span className="noa-row-stats"><span className="is-added">+{currentStatus.additions}</span><span className="is-removed">-{currentStatus.deletions}</span></span>}
      {!selected && <button type="button" className={button} aria-label={changes ? "Refresh changes" : "Refresh files"} title="Refresh" disabled={!!action} onClick={() => setTick((n) => n + 1)}><RefreshCcw size={14} /></button>}
      {selected && editing && <><button type="button" className={`${button} is-text`} disabled={!!action} onClick={async () => { if (!dirty || (await confirm({ title: "Discard unsaved edits?", description: `Changes to ${selected} have not been saved.`, confirmLabel: "Discard", danger: true }))) { sessionStorage.removeItem(draftKey); setEditing(false) } }}>Cancel</button><button type="button" className={`${button} is-text is-primary`} disabled={!dirty || !!action} onClick={save}>{action === "save" ? "Saving…" : "Save"}</button></>}
      {selected && !editing && view === "file" && current?.kind === "text" && <button type="button" className={button} aria-label="Edit file" title="Edit" onClick={() => { setDraft(current.content ?? ""); setEditing(true) }}><SquarePen size={14} /></button>}
      {/* Claude Code's diff file header: Open file (or back to the diff), then More actions. */}
      {selected && changes && !editing && <button type="button" className={button} aria-label={view === "diff" ? "Open file" : "Show diff"} title={view === "diff" ? "Open file" : "Show diff"} onClick={() => select(selected, view === "diff" ? "file" : "diff")}>{view === "diff" ? <ArrowUpRight size={14} /> : <PlusMinus size={14} />}</button>}
      {selected && !editing && <details className="noa-review-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false }} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false }} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false }}>
        <summary role="button" className={button} aria-label="More actions" title="More actions"><MoreHorizontal size={16} /></summary>
        <div className="noa-review-menu-content noa-floating-panel">
          {(view === "diff" || current?.kind === "text") && <button type="button" className={button} onClick={() => setFindRequest((n) => n + 1)}>Find in file</button>}
          {view === "file" && current?.kind === "text" && <>
            <button type="button" className={button} onClick={() => setGotoRequest((n) => n + 1)}>Go to line</button>
            <label className="noa-viewed-label"><input type="checkbox" checked={codeWrap} onChange={(event) => setCodeWrap(event.target.checked)} />Word wrap</label>
          </>}
          {view === "diff" && current?.snapshot && <>
            <button type="button" className={button} onClick={() => setContext(context ? "" : "all")}>{context ? "Collapse context" : "Expand context"}</button>
            <label className="noa-viewed-label"><input type="checkbox" checked={viewed[selected] === current.snapshot} onChange={(event) => setViewed((v) => ({ ...v, [selected]: event.target.checked ? current.snapshot! : "" }))} />Viewed</label>
            <div className="noa-review-menu-separator" role="separator" />
            {scope !== "staged" && selectedChange && selectedChange.status[1] !== " " && <button type="button" className={button} disabled={!!action} onClick={() => gitAction("stage")}>Stage file</button>}
            {scope !== "unstaged" && selectedChange && selectedChange.status !== "??" && selectedChange.status[0] !== " " && <button type="button" className={button} disabled={!!action} onClick={() => gitAction("unstage")}>Unstage file</button>}
            <button type="button" className={button} disabled={!!action} onClick={() => gitAction("revert")}>Revert file</button>
          </>}
          {view === "file" && current && <>
            {current.kind === "text" && <button type="button" className={button} onClick={() => navigator.clipboard.writeText(current.content ?? "").catch((e) => setActionError(`Copy failed: ${e.message}`))}>Copy file contents</button>}
            {current.kind !== "binary" && <button type="button" className={button} onClick={download}>Download file</button>}
          </>}
          <div className="noa-review-menu-separator" role="separator" />
          {!selectedChange?.status.includes("D") && <button type="button" className={button} onClick={() => onReference(selected)}>Attach as context</button>}
          <button type="button" className={button} onClick={copyPath}>Copy path</button>
          {changes && onRevealInTree && !selectedChange?.status.includes("D") && <button type="button" className={button} onClick={() => onRevealInTree(selected)}>Reveal in file tree</button>}
          <button type="button" className={button} disabled={!!action} onClick={() => setTick((n) => n + 1)}>{view === "diff" ? "Refresh" : "Reload file"}</button>
          {view === "file" && current && <>
            {editors.length > 0 && <><div className="noa-review-menu-separator" role="separator" /><div className="noa-review-menu-label">Open in</div>
              {editors.map((editor) => <button key={editor.type} type="button" className={button} onClick={() => openPath(cwd, selected, editor.type).catch((e) => setActionError(e.message))}>{editor.name}</button>)}</>}
            <div className="noa-review-menu-separator" role="separator" />
            <button type="button" className={button} onClick={() => openPath(cwd, selected, "finder").catch((e) => setActionError(e.message))}>{revealLabel}</button>
          </>}
        </div>
      </details>}
    </div>}
    {selected ? <>
    </> : <>
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
        <div className="noa-file-search-field"><Search size={14} /><input aria-label={changes ? "Filter changed files" : "Search files"} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={changes ? "Filter changed files" : "Filter, or ? to search in files"} /></div>
      </div>
    </>}
    {error && <p className="noa-panel-error" role="alert">{error}</p>}
    {actionError && <p className="noa-panel-error" role="alert">{actionError}</p>}
    {diskNotice && editing && <p className="noa-panel-notice" role="status">{diskNotice}</p>}
    {statusError && <p className="noa-panel-error" role="alert">Could not load changes: {statusError}{currentStatus && " · Showing last result"} <button type="button" className={button} onClick={() => setTick((n) => n + 1)}>Retry</button></p>}
    {loading && !current && selected && <p className="noa-panel-empty" role="status">Loading…</p>}
    <div className="noa-panel-body">
      {selected ? current && (editing ? <textarea aria-label="Edit file content" className="noa-file-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} /> : current.kind === "image" ? <div className="noa-image-preview"><img src={current.dataUrl} alt={selected} /></div> : current.kind === "binary" ? <p className="noa-panel-empty">Binary file cannot be previewed</p> : current.truncated ? <p className="noa-panel-empty">Diff too large to display. Open the file in your editor to review it.</p> : <Suspense fallback={<p className="noa-panel-empty">Loading code viewer…</p>}><CodeView focusRequest={lineTarget?.at} focusLine={lineTarget?.line} focusEndLine={lineTarget && "endLine" in lineTarget ? lineTarget.endLine : undefined} gotoRequest={gotoRequest} path={selected} content={current.content ?? ""} diff={view === "diff"} split={sideBySide && canSplit} wrap={view === "diff" ? wordWrap : codeWrap} wordDiff={wordDiff} hideWhitespace={hideWhitespace} hunkScope={scope !== "all" && !selectedChange?.oldPath && !action ? scope : undefined} onHunkAction={gitAction} findRequest={findRequest} onCloseFind={() => setFindRequest(0)} /></Suspense>)
        : changes ? !currentStatus ? !statusError && <p className="noa-panel-empty" role="status">Loading changes…</p> : currentStatus.isGit === false ? <div className="noa-panel-empty"><p>This folder is not a Git repository</p><button type="button" className={button} disabled={!!action} onClick={() => gitAction("init")}>Create Git repository</button></div> : <div role="tree" aria-label="Changed files" className="noa-file-tree" onKeyDown={onTreeKey}>{changeFiles.length ? fileTree ? changedRows(changeTree(changeFiles), "", 0) : [...changeFiles].sort((a, b) => a.path.localeCompare(b.path)).map((file) => changedFile(file, 0, <MiddlePath path={file.path} />)) : <div className="noa-panel-empty">{!filter && <CheckCircle2 size={20} />}<p>{filter ? "No matching files" : scope === "staged" ? "No staged changes" : scope === "unstaged" ? "No unstaged changes" : "Working tree clean"}</p></div>}</div>
        : contentMode ? <div role="tree" aria-label="File content matches" className="noa-file-tree" onKeyDown={onTreeKey}>{contentResults}</div>
        : <div role="tree" aria-label="Project files" className="noa-file-tree" onKeyDown={onTreeKey}>{!search && onOpenChanges && status?.isGit && <button type="button" role="treeitem" className="noa-file-row" onClick={() => onOpenChanges()}><span className="noa-file-icon"><ListDetails size={15} /></span><span className="noa-file-name">All changes</span></button>}
          {sectioned && <>{section("@changed", "Changed files")}{!closed.has("@changed") && <div role="group">{changedRows(changeTree(status!.files))}</div>}
          <div className="noa-file-divider" role="none" />{section("@all", "All files")}</>}
          {(search || !closed.has("@all")) && (sectioned ? <div role="group">{treeRows("")}</div> : treeRows(""))}{loading && !tree[""] && <p className="noa-panel-empty" role="status">{search ? "Searching files…" : "Loading directory entries…"}</p>}{!loading && !error && (search ? !matches.length : !tree[""]?.length) && <p className="noa-panel-empty">{search ? "No matching files" : "No files in this folder"}</p>}</div>}
    </div>
    {(current?.truncated || !selected && truncated) && <p className="noa-panel-notice">Preview limit reached; some content is omitted.</p>}
  </div>
}
