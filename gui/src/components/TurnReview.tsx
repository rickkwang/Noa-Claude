import { useEffect, useMemo, useRef, useState } from "react"
import { parsePatch } from "diff"
import type { TurnDiff, TurnDiffFile } from "../agent/protocol"
import { MiddlePath } from "./TurnDiffCard"
import CodeView from "./CodeView"
import { useDiffPref } from "../lib/diffPrefs"

export function TurnReview({ diff, focusPath, focusKey, canSplit = true }: {
  diff: TurnDiff
  focusPath?: string
  focusKey?: number
  canSplit?: boolean
}) {
  const [selected, setSelected] = useState(focusPath && diff.files.some((file) => file.path === focusPath) ? focusPath : diff.files[0]?.path ?? "")
  const [findRequest, setFindRequest] = useState(0)
  const [wordDiff] = useDiffPref("wordDiff")
  const [hideWhitespace] = useDiffPref("hideWhitespace")
  const [sideBySide] = useDiffPref("sideBySide")
  const [wrap] = useDiffPref("wordWrap")
  const appliedFocus = useRef<string | undefined>(undefined)

  useEffect(() => {
    setSelected((current) => {
      // Live diffs refresh while running; keep the file the user picked.
      if (current && diff.files.some((file) => file.path === current)) return current
      return diff.files[0]?.path ?? ""
    })
  }, [diff])
  useEffect(() => {
    const request = `${focusKey ?? ""}:${focusPath ?? ""}`
    if (focusPath && appliedFocus.current !== request && diff.files.some((file) => file.path === focusPath)) {
      appliedFocus.current = request
      setSelected(focusPath)
    }
  }, [diff, focusPath, focusKey])

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
        <span className="min-w-0 flex-1 truncate text-caption tabular-nums text-[var(--sidebar-text-muted)]">
          {diff.files.length} {diff.files.length === 1 ? "file" : "files"} changed ·{" "}
          {diff.additions > 0 && <span className="noa-turn-diff-stats"><span className="is-added">+{diff.additions}</span></span>}{" "}
          {diff.deletions > 0 && <span className="noa-turn-diff-stats"><span className="is-removed">-{diff.deletions}</span></span>}
        </span>
        <button type="button" className="noa-panel-button" onClick={() => setFindRequest((value) => value + 1)}>Find</button>
      </div>
      {diff.files.length > 1 && (
        <div className="noa-turn-review-files scrollbar-on-hover" role="listbox" aria-label="Changed files">
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
      <div className="noa-panel-body scrollbar-on-hover">
        {content
          ? <CodeView path={selected} content={content} diff split={sideBySide && canSplit} wrap={wrap} wordDiff={wordDiff} hideWhitespace={hideWhitespace} findRequest={findRequest} onCloseFind={() => setFindRequest(0)} />
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
