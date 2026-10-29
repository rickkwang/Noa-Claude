import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import type { AgentState } from "../agent/reducer"
import type { TurnDiff } from "../agent/protocol"
import { ChevronRight, MoreHorizontal } from "../lib/icons"
import { SPLIT_MIN_WIDTH, useDiffPref } from "../lib/diffPrefs"
import { ToolCard } from "./ToolCard"
import { TurnReview } from "./TurnReview"
import { WorkspaceFiles } from "./WorkspaceFiles"

export type PanelTab = "files" | "changes" | "activity"

// The panel sits in a no-drag column; its tab row drags the window again, except on the tabs themselves.
const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

const TABS: { id: PanelTab; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "changes", label: "Changes" },
  { id: "activity", label: "Activity" },
]

interface RightPanelProps {
  state: AgentState
  onStopTask: (id: string) => void
  cwd: string
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onReference: (path: string) => void
  onWorkspaceChange?: () => void
  workspaceRefreshKey: number
  focusChange?: { path: string; at: number }
  focusFile?: { path: string; at: number; line?: number; endLine?: number }
  turnDiff?: { diff: TurnDiff; path?: string; key: number }
}

// Right column: one pane under a tab strip.
export function RightPanel({ state, onStopTask, cwd, tab, onTab, onReference, onWorkspaceChange, workspaceRefreshKey, focusChange, focusFile, turnDiff }: RightPanelProps) {
  const [fileChange, setFileChange] = useState<{ cwd: string; path: string; at: number; scope: "all" }>()
  // One review source: the last turn's patch or a slice of the working tree.
  const [source, setSource] = useState<"turn" | "all" | "unstaged" | "staged">("all")
  useEffect(() => {
    setSource(turnDiff ? "turn" : "all")
  }, [turnDiff?.key, turnDiff === undefined])
  const changeMode = source === "turn" && turnDiff ? "turn" : "working"
  const [revealFile, setRevealFile] = useState<{ path: string; at: number }>()
  const [foldAll, setFoldAll] = useState<{ collapsed: boolean; seq: number }>()
  const [fileTree, setFileTree] = useDiffPref("fileTree")
  const [wordDiff, setWordDiff] = useDiffPref("wordDiff")
  const [hideWhitespace, setHideWhitespace] = useDiffPref("hideWhitespace")
  const [sideBySide, setSideBySide] = useDiffPref("sideBySide")
  const [wordWrap, setWordWrap] = useDiffPref("wordWrap")
  const changesRef = useRef<HTMLDivElement>(null)
  const [canSplit, setCanSplit] = useState(true)
  useEffect(() => {
    const element = changesRef.current
    if (!element) return
    const observer = new ResizeObserver(() => { if (element.offsetWidth > 0) setCanSplit(element.offsetWidth >= SPLIT_MIN_WIDTH) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // Arrow keys move between tabs, as in a WAI-ARIA tablist.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
    const index = TABS.findIndex((t) => t.id === tab)
    const nextId = TABS[e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]?.id
    if (!nextId) return
    onTab(nextId)
    const next = e.currentTarget.querySelector<HTMLElement>(`[data-tab="${nextId}"]`)
    next?.focus({ preventScroll: true })
    next?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-page,#F9F9F7)] font-ui">
      <div className="flex h-11 shrink-0 items-center gap-1 pl-2 pr-[76px] select-none" style={dragRegion}>
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap hide-scrollbar"
          role="tablist"
          aria-label="Panel tabs"
          onKeyDown={onTabKey}
        >
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                id={`panel-tab-${t.id}`}
                aria-controls={`panel-${t.id}`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onTab(t.id)}
                style={noDragRegion}
                className={`h-6 shrink-0 rounded-md px-2 text-body transition-colors ${
                  active
                    ? "bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] text-[var(--text-primary,#2D2D2B)]"
                    : "noa-sidebar-hover-surface-subtle text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)]"
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      <div id="panel-files" role="tabpanel" aria-labelledby="panel-tab-files" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "files" ? "flex" : "none" }}>
        <WorkspaceFiles key={`files-${cwd}`} cwd={cwd} active={tab === "files"} focus={focusFile} reveal={revealFile} refreshKey={workspaceRefreshKey} onReference={onReference} onUpdated={onWorkspaceChange} onOpenChanges={(path) => { if (path) setFileChange({ cwd, path, at: Date.now(), scope: "all" }); setSource("all"); onTab("changes") }} />
      </div>
      <div ref={changesRef} id="panel-changes" role="tabpanel" aria-labelledby="panel-tab-changes" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "changes" ? "flex" : "none" }}>
        <div className="noa-panel-toolbar noa-turn-scope">
          <select aria-label="Review source" value={changeMode === "turn" ? "turn" : source === "turn" ? "all" : source} onChange={(e) => setSource(e.target.value as typeof source)}>
            {turnDiff && <option value="turn">Last turn</option>}
            <option value="all">Uncommitted</option>
            <option value="unstaged">Unstaged</option>
            <option value="staged">Staged</option>
          </select>
          {changeMode === "turn" && turnDiff && (
            <span className="min-w-0 truncate text-caption tabular-nums text-[var(--sidebar-text-muted)]">
              {turnDiff.diff.files.length} {turnDiff.diff.files.length === 1 ? "file" : "files"}
            </span>
          )}
          {/* Claude Code's Changes pane menu: file list, fold, then display groups. */}
          <details className="noa-review-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false }} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false }}>
            <summary role="button" className="noa-panel-button" aria-label="Diff options" title="Diff options"><MoreHorizontal size={16} /></summary>
            <div className="noa-review-menu-content noa-floating-panel">
              {changeMode === "working" && <>
                <label className="noa-viewed-label"><input type="checkbox" checked={fileTree} onChange={(event) => setFileTree(event.target.checked)} />Group files by folder</label>
                {fileTree && <>
                  <div className="noa-review-menu-separator" role="separator" />
                  <button type="button" className="noa-panel-button" onClick={(event) => { setFoldAll((fold) => ({ collapsed: true, seq: (fold?.seq ?? 0) + 1 })); event.currentTarget.closest("details")!.open = false }}>Collapse all files</button>
                  <button type="button" className="noa-panel-button" onClick={(event) => { setFoldAll((fold) => ({ collapsed: false, seq: (fold?.seq ?? 0) + 1 })); event.currentTarget.closest("details")!.open = false }}>Expand all files</button>
                </>}
                <div className="noa-review-menu-separator" role="separator" />
              </>}
              <label className="noa-viewed-label" title={sideBySide && !canSplit ? "Needs a wider pane" : undefined}><input type="checkbox" checked={sideBySide} onChange={(event) => setSideBySide(event.target.checked)} />Side by side{sideBySide && !canSplit && <span className="noa-review-menu-hint">Needs a wider pane</span>}</label>
              <label className="noa-viewed-label"><input type="checkbox" checked={wordWrap} onChange={(event) => setWordWrap(event.target.checked)} />Word wrap</label>
              <div className="noa-review-menu-separator" role="separator" />
              <label className="noa-viewed-label"><input type="checkbox" checked={wordDiff} onChange={(event) => setWordDiff(event.target.checked)} />Highlight changed words</label>
              <label className="noa-viewed-label"><input type="checkbox" checked={hideWhitespace} onChange={(event) => setHideWhitespace(event.target.checked)} />Hide whitespace changes</label>
            </div>
          </details>
        </div>
        <div className="min-h-0 flex-1 flex-col" style={{ display: tab === "changes" && changeMode === "working" ? "flex" : "none" }}>
          <WorkspaceFiles key={`changes-${cwd}`} cwd={cwd} changes scope={source === "turn" ? "all" : source} focus={fileChange?.cwd === cwd && (!focusChange || fileChange.at > focusChange.at) ? fileChange : focusChange} foldAll={foldAll} canSplit={canSplit} onRevealInTree={(path) => { setRevealFile({ path, at: Date.now() }); onTab("files") }} active={tab === "changes" && changeMode === "working"} refreshKey={workspaceRefreshKey} onReference={onReference} onUpdated={onWorkspaceChange} />
        </div>
        {turnDiff && (
          <div className="min-h-0 flex-1 flex-col" style={{ display: tab === "changes" && changeMode === "turn" ? "flex" : "none" }}>
            <TurnReview diff={turnDiff.diff} focusPath={turnDiff.path} focusKey={turnDiff.key} canSplit={canSplit} />
          </div>
        )}
      </div>
      <div id="panel-activity" role="tabpanel" aria-labelledby="panel-tab-activity" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "activity" ? "flex" : "none" }}>
        <ActivityTab state={state} onStopTask={onStopTask} />
      </div>
    </div>
  )
}

function Section({ title, count, open, children }: { title: string; count?: string | number; open?: boolean; children: ReactNode }) {
  return <details className="noa-panel-section" open={open}>
    <summary><ChevronRight size={12} className="noa-panel-section-chevron" /><span>{title}</span>{count !== undefined && <span className="noa-panel-section-count">{count}</span>}</summary>
    <div className="noa-panel-section-body">{children}</div>
  </details>
}

function ActivityTab({ state, onStopTask }: { state: AgentState; onStopTask: (id: string) => void }) {
  const statusKind = state.connection === "closed" ? "closed" : state.connection === "connecting" ? "connecting" : state.permissions.length || state.elicitations.length ? "waiting" : state.busy ? "running" : "ready"
  return <div className="noa-panel-details">
    <section className="noa-activity-status" data-kind={statusKind}>
      <span className="noa-activity-dot" />
      <div className="min-w-0 flex-1">
        <div>{statusKind === "closed" ? "Agent disconnected" : statusKind === "connecting" ? "Connecting…" : statusKind === "waiting" ? state.permissions.length && state.elicitations.length ? "Waiting for approval and input" : state.elicitations.length ? "Waiting for input" : "Waiting for approval" : statusKind === "running" ? "Agent is working" : "Ready"}</div>
        {state.result && <p className="noa-panel-muted tabular-nums">{state.result.interrupted ? "Stopped" : state.result.isError ? "Finished with an error" : "Last run completed"} · {(state.result.durationMs / 1000).toFixed(1)}s{state.result.costUsd !== undefined && ` · $${state.result.costUsd.toFixed(4)}`}</p>}
      </div>
    </section>
    {state.tasks.length > 0 && (
      <div className="noa-panel-sections">
        <Section title="Background tasks" count={state.tasks.length} open>
          {state.tasks.map((task) => (
            <details key={task.id} className="rounded-lg border border-[var(--divider-subtle)] p-2 text-body">
              <summary className="cursor-pointer">
                <span className={task.status === "running" ? "noa-shimmer" : ""}>{task.description}</span>
                <span className="ml-2 text-caption text-[var(--sidebar-text-muted)]">{task.status}</span>
              </summary>
              {task.summary && <p className="whitespace-pre-wrap text-caption">{task.summary}</p>}
              {task.lastTool && <p className="text-caption text-[var(--sidebar-text-muted)]">Using {task.lastTool}</p>}
              {task.usage && (
                <p className="text-caption tabular-nums text-[var(--sidebar-text-muted)]">
                  {task.usage.tool_uses} tools · {(task.usage.duration_ms / 1000).toFixed(1)}s
                </p>
              )}
              {task.turns.map((turn) =>
                turn.role === "assistant"
                  ? turn.blocks.map((block, i) =>
                      block.kind === "tool" ? (
                        <ToolCard key={`${turn.id}-${i}`} block={block} tasks={state.tasks} task={state.tasks.find(task => task.id === block.id || task.toolUseId === block.id)} />
                      ) : (block.kind === "text" || block.kind === "thinking") ? (
                        <p key={`${turn.id}-${i}`} className="whitespace-pre-wrap text-caption">
                          {block.text}
                        </p>
                      ) : null,
                    )
                  : null,
              )}
              {task.status === "running" && task.id !== task.toolUseId && (
                <button
                  className="noa-confirm-btn mt-2 rounded-md border border-[var(--divider-subtle)] px-2 py-1 text-caption"
                  onClick={() => onStopTask(task.id)}
                >
                  Stop task
                </button>
              )}
              {task.outputFile && (
                <p className="break-all text-caption text-[var(--sidebar-text-muted)]">Output: {task.outputFile}</p>
              )}
            </details>
          ))}
        </Section>
      </div>
    )}
    <div className="noa-panel-sections"><Section title="Diagnostics" count={state.logs.length}><pre className="noa-activity-log">{state.logs.join("\n") || "No agent diagnostics"}</pre></Section></div>
  </div>
}
