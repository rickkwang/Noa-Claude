import { useEffect, useMemo, useRef, useState } from "react"
import { query } from "../api"
import { Check, ChevronRight, GitBranch, Plus, Search, Settings, Worktree } from "../lib/icons"
import { ComposerBranchIcon, ComposerSettingsIcon } from "./ComposerIcons"

type BranchState =
  | { isGit: false }
  | { isGit: true; current: string | null; defaultBranch: string | null; branches: string[]; uncommitted: number; hasCommits: boolean }

const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`

async function branchRequest(cwd: string, body?: { action: "checkout" | "detach" | "create"; branch: string }) {
  const response = await fetch(`/api/branches${query(cwd)}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Git command failed")
  return result
}

// The composer's local environment menu: the worktree switch, the branch with its
// branch switcher (search, the current branch's uncommitted count, create and checkout), and the environment.
// In a worktree the branch row picks the branch the task starts from, which the worktree checks out detached.
export function EnvironmentMenu({ cwd, branch, onBranchChange, worktree, canToggleWorktree, onWorktree }: {
  cwd: string
  branch?: string
  onBranchChange: () => void
  worktree: boolean
  canToggleWorktree: boolean
  onWorktree: (on: boolean) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"main" | "branches" | "create">("main")
  const [state, setState] = useState<BranchState>()
  const [search, setSearch] = useState("")
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  // Closing forgets the branch list too, so reopening (possibly in another project) never shows stale branches.
  const close = () => {
    setOpen(false)
    setState(undefined)
    setView("main")
    setSearch("")
    setDraft("")
    setError(undefined)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    branchRequest(cwd).then((result) => !cancelled && setState(result), () => !cancelled && setState({ isGit: false }))
    const press = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      // Escape steps back out of the branch list before it closes the menu.
      if (viewRef.current === "main") return close()
      setError(undefined)
      setView(viewRef.current === "create" ? "branches" : "main")
    }
    document.addEventListener("mousedown", press)
    document.addEventListener("keydown", key, true)
    return () => {
      cancelled = true
      document.removeEventListener("mousedown", press)
      document.removeEventListener("keydown", key, true)
    }
  }, [open, cwd])

  const git = state?.isGit ? state : undefined
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (git?.branches ?? []).filter((name) => name.toLowerCase().includes(needle))
  }, [git, search])

  async function run(body: { action: "checkout" | "detach" | "create"; branch: string }) {
    setPending(true)
    setError(undefined)
    try {
      await branchRequest(cwd, body)
      close()
      onBranchChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  function checkout(name: string) {
    if (!git || name === git.current) return close()
    // A commit is required before switching away from uncommitted tracked changes.
    if (git.uncommitted > 0) return setError(`Commit changes in ${files(git.uncommitted)} to check out ${name}.`)
    void run({ action: worktree ? "detach" : "checkout", branch: name })
  }

  async function toggleWorktree() {
    setPending(true)
    setError(undefined)
    try {
      await onWorktree(!worktree)
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const createError = (() => {
    const name = draft.trim()
    if (name.endsWith("/")) return "Branch name cannot end with “/”."
    if (git?.branches.includes(name)) return "Branch already exists."
    return undefined
  })()

  return (
    <div ref={ref} className="relative -mr-0.5 ml-auto">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Configure local environment"
        aria-expanded={open}
        className={`flex size-7 items-center justify-center rounded-full noa-sidebar-hover-surface-subtle ${open ? "bg-[var(--fill-hover)]" : ""}`}
      >
        <ComposerSettingsIcon />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Configure local environment"
          className={`noa-context-menu noa-popup-menu noa-floating-panel absolute bottom-full right-0 z-30 mb-2 text-left ${view === "main" ? "w-[260px]" : "w-72"}`}
        >
          {view === "main" && (
            <>
              <div className="noa-popup-menu-heading">Configure local environment</div>
              <div className="noa-context-menu-entry">
                <button
                  type="button"
                  role="switch"
                  aria-checked={worktree}
                  disabled={pending || !canToggleWorktree || (!worktree && !!state && !git?.hasCommits)}
                  title={!canToggleWorktree ? "Only a new task can start in a worktree" : state && !git?.hasCommits ? "Worktrees need a Git repository with a commit" : undefined}
                  onClick={() => void toggleWorktree()}
                >
                  <Worktree size={16} className="noa-popup-menu-icon" />
                  <span className="noa-popup-menu-label">New worktree</span>
                  <span aria-hidden="true" className="noa-popup-switch" data-checked={worktree || undefined} />
                </button>
              </div>
              {error && <p role="alert" className="m-0 px-2 py-1.5 text-caption text-[#C24444]">{error}</p>}
              <div className="noa-context-menu-entry">
                <button type="button" disabled={!git} onClick={() => setView("branches")} aria-haspopup="menu">
                  <ComposerBranchIcon className="noa-popup-menu-icon" />
                  <span className="noa-popup-menu-label">Branch</span>
                  <span className="noa-popup-menu-value min-w-0 max-w-32 truncate">
                    {git ? git.current ?? "Detached HEAD" : state ? "No git repo" : branch ?? "…"}
                  </span>
                  {git && <ChevronRight size={16} className="noa-popup-menu-chevron shrink-0" />}
                </button>
              </div>
              <div className="noa-context-menu-entry">
                <button type="button" disabled>
                  <Settings size={16} className="noa-popup-menu-icon" />
                  <span className="noa-popup-menu-label">Environment</span>
                  <span className="noa-popup-menu-value">No environment</span>
                  <ChevronRight size={16} className="noa-popup-menu-chevron shrink-0" />
                </button>
              </div>
            </>
          )}
          {view === "branches" && git && (
            <>
              {/* Menu search: the row padding, a leading tertiary search icon, no field chrome. */}
              <label className="flex items-center gap-1.5 px-2 py-[5px] text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)]">
                <Search size={16} className="shrink-0" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search branches"
                  aria-label="Search branches"
                  className="min-w-0 flex-1 bg-transparent text-body text-[var(--text-primary)] outline-none placeholder:text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)]"
                />
              </label>
              <div role="menu" aria-label="Branches" className="max-h-60 overflow-y-auto">
                {shown.map((name) => (
                  <div key={name} className="noa-context-menu-entry">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={name === git.current}
                      disabled={pending}
                      onClick={() => checkout(name)}
                    >
                      <GitBranch size={name === git.current && git.uncommitted > 0 ? 18 : 14} className="noa-popup-menu-icon" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{name}</span>
                        {name === git.current && git.uncommitted > 0 && (
                          <span className="text-xs text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)]">Uncommitted: {files(git.uncommitted)}</span>
                        )}
                      </span>
                      {name === git.current && <Check size={14} className="noa-popup-menu-trailing" />}
                    </button>
                  </div>
                ))}
                {!shown.length && <p className="m-0 px-2 py-3 text-center text-caption text-[var(--sidebar-text-muted)]">No branches found</p>}
              </div>
              {error && (
                <p role="alert" className="m-0 px-2 py-1.5 text-caption text-[#C24444]">
                  {error}
                  {git.uncommitted > 0 && <span className="block text-[var(--sidebar-text-muted)]">Please commit your changes to continue</span>}
                </p>
              )}
              <div role="separator" className="noa-context-menu-separator" />
              <div className="noa-context-menu-entry">
                <button
                  type="button"
                  disabled={!git.hasCommits || pending}
                  title={git.hasCommits ? undefined : "Commit changes to create and checkout a new branch"}
                  onClick={() => {
                    setError(undefined)
                    setDraft(search.trim())
                    setView("create")
                  }}
                >
                  <Plus size={14} className="noa-popup-menu-icon" />
                  <span className="noa-popup-menu-label">Create and checkout new branch…</span>
                </button>
              </div>
            </>
          )}
          {view === "create" && git && (
            <form
              className="flex flex-col gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (draft.trim() && !createError) void run({ action: "create", branch: draft.trim() })
              }}
            >
              <span className="text-body font-medium text-[var(--text-primary)]">Create and checkout branch</span>
              <input
                autoFocus
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setError(undefined)
                }}
                placeholder="new-branch"
                aria-label="Branch name"
                className="h-8 rounded-lg border border-[var(--border-default)] bg-transparent px-2 text-body outline-none focus:border-[var(--sidebar-text-muted)]"
              />
              {(createError || error) && <span role="alert" className="text-caption text-[#C24444]">{createError ?? error}</span>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setView("branches")} className="h-7 rounded-lg px-3 text-body noa-sidebar-hover-surface">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!draft.trim() || !!createError || pending}
                  className="h-7 rounded-lg bg-[var(--text-primary)] px-3 text-body text-[var(--bg-card,#FFFFFF)] disabled:opacity-40"
                >
                  Create and checkout
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
