import { useState } from "react"
import { IconFileDiff } from "@tabler/icons-react"
import type { TurnDiff, TurnDiffActionResult, TurnDiffFile } from "../agent/protocol"
import { ChevronDown, ChevronRight, ChevronUp } from "../lib/icons"

export function TurnDiffCard({ diff, onOpen, onAction, pending }: {
  diff: TurnDiff
  onOpen: (path?: string) => void
  onAction?: (action: "undo" | "reapply") => void
  pending?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const single = diff.files.length === 1
  const shown = expanded ? diff.files : diff.files.slice(0, 3)
  const hidden = diff.files.length - shown.length
  const title = single ? `Edited ${basename(diff.files[0]!.path)}` : `Edited ${diff.files.length} files`
  const action = diff.reverted ? "reapply" : "undo"
  const canAct = onAction !== undefined && diff.turnIndex !== undefined

  return (
    <div className="noa-turn-diff-card">
      <div className="noa-turn-diff-headrow">
        <button
          type="button"
          className="noa-turn-diff-header group/turn-diff"
          onClick={() => onOpen(single ? diff.files[0]!.path : undefined)}
          aria-label={`${title}. View changes`}
        >
          <IconFileDiff size={14} className="shrink-0 text-[var(--sidebar-text-muted)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-[var(--text-primary)]">{title}</span>
          <span className="noa-turn-diff-default">
            <Stats file={diff} />
          </span>
          <span className="noa-turn-diff-hover">
            View changes
            <ChevronRight size={12} aria-hidden="true" />
          </span>
        </button>
        {canAct && (
          <button
            type="button"
            className="noa-turn-diff-action"
            disabled={pending}
            onClick={() => onAction(action)}
            title={action === "undo" ? "Undo" : "Reapply"}
          >
            {pending ? (action === "reapply" ? "Reapplying…" : "Undoing…") : action === "reapply" ? "Reapply" : "Undo"}
          </button>
        )}
      </div>
      {!single && (
        <div className="noa-turn-diff-list">
          {shown.map((file) => (
            <button key={file.path} type="button" className="noa-turn-diff-row" onClick={() => onOpen(file.path)} title={file.path}>
              <MiddlePath path={file.path} />
              <RowStats file={file} />
            </button>
          ))}
          {hidden > 0 && (
            <button type="button" className="noa-turn-diff-more" onClick={() => setExpanded(true)}>
              Show {hidden} more file{hidden === 1 ? "" : "s"}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          )}
          {expanded && diff.files.length > 3 && (
            <button type="button" className="noa-turn-diff-more" onClick={() => setExpanded(false)} aria-expanded="true">
              Collapse files
              <ChevronUp size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {diff.truncated && <p className="noa-turn-diff-note">Diff too large to preview</p>}
    </div>
  )
}

/** Codex's in-progress row above the composer: files changed while the turn runs. */
export function LiveDiffSummary({ diff, onOpen }: { diff: TurnDiff; onOpen: () => void }) {
  const count = diff.files.length
  if (count === 0) return null
  return (
    <button
      type="button"
      className="noa-live-diff noa-press"
      onClick={onOpen}
      aria-label={`${count} ${count === 1 ? "file" : "files"} changed. View changes`}
    >
      <IconFileDiff size={14} className="shrink-0" aria-hidden="true" />
      <span className="noa-shimmer">{count} {count === 1 ? "file" : "files"} changed</span>
      <Stats file={diff} />
    </button>
  )
}

export function DiffActionDialog({ action, result, onClose }: {
  action: "undo" | "reapply"
  result: TurnDiffActionResult
  onClose: () => void
}) {
  const reverted = action === "undo"
  const title =
    result.errorCode === "not-git-repo"
      ? `${reverted ? "Undo" : "Reapply"} requires a Git repository`
      : result.appliedPaths.length > 0
        ? `Some changes ${reverted ? "reverted" : "reapplied"}`
        : result.skippedPaths.length > 0 && result.conflictedPaths.length === 0
          ? `No changes ${reverted ? "reverted" : "reapplied"}`
          : `Failed to ${reverted ? "revert" : "reapply"} changes`
  const groups = [
    { label: `Applied cleanly (${result.appliedPaths.length})`, paths: result.appliedPaths, color: "" },
    { label: `Skipped (${result.skippedPaths.length})`, paths: result.skippedPaths, color: "text-[var(--sidebar-text-muted)]" },
    { label: `Conflicts (${result.conflictedPaths.length})`, paths: result.conflictedPaths, color: "text-[#C24444]" },
  ].filter((group) => group.paths.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl bg-[var(--surface-page,#F9F9F7)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-dialog)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="m-0 text-balance text-[length:var(--font-text-md-size)] font-semibold tabular-nums">{title}</h2>
        {result.errorCode === "no-patch" && (
          <p className="mt-2 text-caption text-[var(--sidebar-text-muted)]">This turn has no stored patch to apply.</p>
        )}
        {result.errorCode === "not-git-repo" && (
          <p className="mt-2 text-caption text-[var(--sidebar-text-muted)]">This action only works when running in a Git repository.</p>
        )}
        {groups.length > 0 && (
          <div className="mt-3 flex max-h-[40vh] flex-col gap-3 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.label}>
                <p className={`m-0 text-caption font-medium tabular-nums ${group.color}`}>{group.label}</p>
                <ul className="m-0 mt-1 list-none break-all p-0 text-caption text-[var(--sidebar-text-muted)]">
                  {group.paths.map((path) => <li key={path}>{path}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
        {result.error && groups.length === 0 && (
          <p className="mt-2 whitespace-pre-wrap break-words text-caption text-[#C24444]">{result.error}</p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="noa-panel-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function Stats({ file }: { file: TurnDiff }) {
  return (
    <span className="noa-turn-diff-stats">
      {file.additions > 0 && <span className="is-added">+{file.additions}</span>}
      {file.deletions > 0 && <span className="is-removed">-{file.deletions}</span>}
    </span>
  )
}

function RowStats({ file }: { file: TurnDiffFile }) {
  if (file.binary) return <span className="noa-turn-diff-note">Binary</span>
  return (
    <span className="noa-turn-diff-stats">
      {file.tooLarge && <span className="noa-turn-diff-note">Too large to render inline</span>}
      {file.additions > 0 && <span className="is-added">+{file.additions}</span>}
      {file.deletions > 0 && <span className="is-removed">-{file.deletions}</span>}
    </span>
  )
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

export function MiddlePath({ path }: { path: string }) {
  const at = path.lastIndexOf("/")
  return (
    <span className="noa-middle-path" title={path}>
      {at > 0 && <span className="noa-middle-path-dir">{path.slice(0, at + 1)}</span>}
      <span className="noa-middle-path-base">{path.slice(at + 1)}</span>
    </span>
  )
}
