import { useEffect, useMemo, useState } from "react"
import { parsePatch } from "diff"
import type { TurnDiff, TurnDiffFile } from "../agent/protocol"
import { MiddlePath } from "./TurnDiffCard"
import CodeView from "./CodeView"

export function TurnReview({ diff, focusPath }: {
  diff: TurnDiff
  focusPath?: string
}) {
  const [selected, setSelected] = useState(focusPath && diff.files.some((file) => file.path === focusPath) ? focusPath : diff.files[0]?.path ?? "")
  const [wrap, setWrap] = useState(false)
  const [findRequest, setFindRequest] = useState(0)

  useEffect(() => {
    setSelected((current) => {
      if (focusPath && diff.files.some((file) => file.path === focusPath)) return focusPath
      // Live diffs refresh while running; keep the file the user picked.
      if (current && diff.files.some((file) => file.path === current)) return current
      return diff.files[0]?.path ?? ""
    })
  }, [diff, focusPath])

  const patches = useMemo(() => {
    if (!diff.patch) return []
    try { return parsePatch(diff.patch) } catch { return [] }
  }, [diff.patch])
  const file = diff.files.find((candidate) => candidate.path === selected)
  const patchPath = file?.patchPath ?? selected
  const content = useMemo(() => patchContent(patchPath, patches), [patchPath, patches])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="noa-panel-toolbar">
        <span className="min-w-0 flex-1 truncate text-caption text-[var(--sidebar-text-muted)]">
          {diff.files.length} {diff.files.length === 1 ? "file" : "files"} changed ·{" "}
          {diff.additions > 0 && <span className="noa-turn-diff-stats"><span className="is-added">+{diff.additions}</span></span>}{" "}
          {diff.deletions > 0 && <span className="noa-turn-diff-stats"><span className="is-removed">-{diff.deletions}</span></span>}
        </span>
        <button type="button" className="noa-panel-button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>Wrap</button>
        <button type="button" className="noa-panel-button" onClick={() => setFindRequest((value) => value + 1)}>Find</button>
      </div>
      {diff.files.length > 1 && (
        <div className="noa-turn-review-files" role="listbox" aria-label="Changed files">
          {diff.files.map((item) => (
            <button
              key={item.path}
              type="button"
              role="option"
              aria-selected={item.path === selected}
              className="noa-turn-review-row"
              data-selected={item.path === selected || undefined}
              title={item.path}
              onClick={() => setSelected(item.path)}
            >
              <MiddlePath path={item.path} />
              <ReviewStats file={item} />
            </button>
          ))}
        </div>
      )}
      <div className="noa-panel-body">
        {content
          ? <CodeView path={selected} content={content} diff split={false} wrap={wrap} findRequest={findRequest} onCloseFind={() => setFindRequest(0)} />
          : <p className="noa-panel-empty">
              {file?.tooLarge || !diff.patch || diff.truncated
                ? "Diff too large to preview"
                : file?.binary ? "Binary file cannot be previewed" : "No diff available"}
            </p>}
      </div>
    </div>
  )
}

function ReviewStats({ file }: { file: TurnDiffFile }) {
  if (file.binary) return <span className="noa-turn-diff-note">Binary</span>
  return (
    <span className="noa-turn-diff-stats">
      {file.tooLarge && <span className="noa-turn-diff-note">Too large</span>}
      {file.additions > 0 && <span className="is-added">+{file.additions}</span>}
      {file.deletions > 0 && <span className="is-removed">-{file.deletions}</span>}
    </span>
  )
}

function normalize(path: string): string {
  return path.replace(/^(a|b)\//, "")
}

function patchContent(selected: string, patches: ReturnType<typeof parsePatch>): string {
  if (!selected) return ""
  const file = patches.find((patch) => normalize(patch.newFileName) === selected || normalize(patch.oldFileName) === selected)
  if (!file) return ""
  let out = `--- a/${selected}\n+++ b/${selected}\n`
  for (const hunk of file.hunks) {
    out += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`
    out += `${hunk.lines.join("\n")}\n`
  }
  return out
}
