import { useEffect, useState } from "react"
import { query } from "../api"
import { ArrowLeft, ChevronRight, FileText, Folder, RefreshCcw } from "../lib/icons"

type Entry = { name: string; path: string; directory: boolean }
type Changes = { branch: string; files: { path: string; status: string }[] }

async function load<T>(route: string, cwd: string, path = ""): Promise<T> {
  const response = await fetch(`/api/${route}${query(cwd)}&path=${encodeURIComponent(path)}`)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Could not load workspace")
  return body as T
}

export function WorkspaceFiles({
  cwd,
  changes,
  refreshKey,
  onReference,
}: {
  cwd: string
  changes?: boolean
  refreshKey: number
  onReference: (path: string) => void
}) {
  const [directory, setDirectory] = useState("")
  const [selected, setSelected] = useState<{ path: string; untracked?: boolean }>()
  const [entries, setEntries] = useState<Entry[]>([])
  const [status, setStatus] = useState<Changes>()
  const [content, setContent] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    setContent(undefined)
    setTruncated(false)
    const request = selected
      ? load<{ content: string; truncated?: boolean }>(
          changes && !selected.untracked ? "diff" : "file",
          cwd,
          selected.path,
        )
      : changes
        ? load<Changes>("changes", cwd)
        : load<{ entries: Entry[]; truncated: boolean }>("files", cwd, directory)
    request
      .then((body) => {
        if (cancelled) return
        if ("content" in body) {
          setContent(body.content)
          setTruncated(!!body.truncated)
        } else if ("files" in body) setStatus(body)
        else {
          setEntries(body.entries)
          setTruncated(body.truncated)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, directory, selected, changes, tick, refreshKey])

  const button = "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-caption noa-sidebar-hover-surface-subtle"
  return (
    <div className="flex min-h-0 flex-1 flex-col text-body">
      <div className="flex min-h-8 items-center gap-1 px-3">
        {(selected || directory) && (
          <button
            className={button}
            aria-label="Back to files"
            onClick={() =>
              selected ? setSelected(undefined) : setDirectory(directory.split("/").slice(0, -1).join("/"))
            }
          >
            <ArrowLeft size={13} />
          </button>
        )}
        <span
          className="min-w-0 flex-1 truncate font-ui text-caption text-[var(--sidebar-text-muted,#898781)]"
          title={selected?.path ?? directory}
        >
          {selected?.path ?? (changes ? (status?.branch ?? "Working tree") : directory || "Project files")}
        </span>
        {selected && (
          <button className={button} onClick={() => onReference(selected.path)} title="Add file path to task">
            Reference
          </button>
        )}
        <button
          className={button}
          aria-label={changes ? "Refresh changes" : "Refresh files"}
          onClick={() => setTick((n) => n + 1)}
        >
          <RefreshCcw size={12} />
        </button>
      </div>
      {!selected && (
        <input
          aria-label={changes ? "Filter changed files" : "Filter files"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          className="mx-3 my-1.5 min-h-7 rounded-md bg-[var(--surface-page)] px-2 text-caption outline-none focus:ring-1 focus:ring-[var(--accent-color)]"
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-2">
        {loading ? (
          <p className="text-caption text-[var(--sidebar-text-muted)]" role="status">
            Loading…
          </p>
        ) : error ? (
          <p className="break-words text-caption text-[#C24444]" role="alert">
            {error}
          </p>
        ) : selected ? (
          <pre className="m-0 py-2 font-mono text-[length:var(--code-font-size)] leading-relaxed">
            {content
              ? content.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className={`min-h-[1.5em] whitespace-pre ${changes && !selected.untracked ? (line.startsWith("+") ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : line.startsWith("-") ? "bg-red-500/10 text-red-700 dark:text-red-300" : "") : ""}`}
                  >
                    {line || " "}
                  </div>
                ))
              : "No diff content. The change may be binary or metadata only."}
          </pre>
        ) : changes ? (
          <>
            {status?.files.length === 0 && (
              <p className="py-3 text-center text-caption text-[var(--sidebar-text-muted)]">Working tree is clean</p>
            )}
            {status?.files
              .filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
              .map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelected({ path: file.path, untracked: file.status === "??" })}
                  className="-mx-1.5 flex min-h-7 w-[calc(100%+12px)] items-center gap-2 rounded-md px-1.5 text-left noa-sidebar-hover-surface-subtle"
                >
                  <span className="w-5 shrink-0 font-mono text-caption text-[var(--accent-color)]">
                    {file.status.trim()}
                  </span>
                  <span className="truncate text-caption" title={file.path}>
                    {file.path}
                  </span>
                </button>
              ))}
          </>
        ) : (
          entries
            .filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
            .map((entry) => (
              <button
                key={entry.path}
                onClick={() => {
                  if (entry.directory) {
                    setDirectory(entry.path)
                    setFilter("")
                  } else setSelected({ path: entry.path })
                }}
                className="-mx-1.5 flex min-h-7 w-[calc(100%+12px)] items-center gap-2 rounded-md px-1.5 text-left noa-sidebar-hover-surface-subtle"
              >
                {entry.directory ? <Folder size={13} /> : <FileText size={13} />}
                <span className="min-w-0 flex-1 truncate text-caption">{entry.name}</span>
                {entry.directory && <ChevronRight size={11} />}
              </button>
            ))
        )}
        {truncated && (
          <p className="text-caption text-[var(--sidebar-text-muted)]">
            Preview limit reached; some content is omitted.
          </p>
        )}
      </div>
    </div>
  )
}
