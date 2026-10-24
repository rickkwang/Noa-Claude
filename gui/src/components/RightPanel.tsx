import type { KeyboardEvent } from "react"
import type { AgentState } from "../agent/reducer"
import { WorkspaceFiles } from "./WorkspaceFiles"

export type PanelTab = "files" | "changes" | "context" | "activity"

const TABS: { id: PanelTab; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "changes", label: "Changes" },
  { id: "context", label: "Context" },
  { id: "activity", label: "Activity" },
]

interface RightPanelProps {
  state: AgentState
  cwd: string
  sessionId?: string
  onRefreshContext: () => void
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onReference: (path: string) => void
}

// Right column: one pane under a tab strip, as in Codex's side panel.
export function RightPanel({ state, cwd, sessionId, onRefreshContext, tab, onTab, onReference }: RightPanelProps) {
  // Arrow keys move between tabs, as in a WAI-ARIA tablist.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    const index = TABS.findIndex((t) => t.id === tab)
    const nextId = TABS[(index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]?.id
    if (!nextId) return
    onTab(nextId)
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${nextId}"]`)?.focus()
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-page,#F9F9F7)] font-ui">
      <div className="flex h-11 shrink-0 items-center gap-1 px-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-1"
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
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onTab(t.id)}
                className={`h-6 rounded-md px-2.5 text-body transition-colors ${
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
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "files" && (
          <WorkspaceFiles
            key={`files-${cwd}`}
            cwd={cwd}
            refreshKey={state.busy ? 0 : state.turns.length}
            onReference={onReference}
          />
        )}
        {tab === "changes" && (
          <WorkspaceFiles
            key={`changes-${cwd}`}
            cwd={cwd}
            changes
            refreshKey={state.busy ? 0 : state.turns.length}
            onReference={onReference}
          />
        )}
        {tab === "context" && (
          <ContextTab state={state} cwd={cwd} sessionId={sessionId} onRefreshContext={onRefreshContext} />
        )}
        {tab === "activity" && <ActivityTab state={state} />}
      </div>
    </div>
  )
}

function ContextTab({
  state,
  cwd,
  sessionId,
  onRefreshContext,
}: {
  state: AgentState
  cwd: string
  sessionId?: string
  onRefreshContext: () => void
}) {
  const usage = state.contextUsage
  const percent = usage ? Math.min(100, Math.round(usage.percentage)) : 0
  const last = state.result
  const label = "text-[var(--sidebar-text-muted,#898781)]"
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3 text-body">
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className={label}>Workspace</dt>
        <dd className="min-w-0 truncate font-mono text-caption" title={cwd}>
          {cwd}
        </dd>
        <dt className={label}>Model</dt>
        <dd className="min-w-0 truncate font-mono text-caption">{state.model ?? "—"}</dd>
        <dt className={label}>Mode</dt>
        <dd className="min-w-0 truncate font-mono text-caption">{state.permissionMode ?? "—"}</dd>
        <dt className={label}>Session</dt>
        <dd className="min-w-0 truncate font-mono text-caption">{sessionId ? sessionId.slice(0, 8) : "new"}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <div className="h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_8%,transparent)]">
          <div className="h-full rounded-full bg-[var(--accent-color,#CC7D5E)]" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex items-center justify-between gap-2 text-caption">
          <span className={label}>
            {usage
              ? `${usage.totalTokens.toLocaleString()} of ${usage.maxTokens.toLocaleString()} tokens · ${percent}%`
              : "Not measured yet"}
          </span>
          <button
            type="button"
            onClick={onRefreshContext}
            className="h-6 shrink-0 rounded-md px-2.5 hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] transition-colors noa-press"
          >
            Refresh
          </button>
        </div>
      </div>
      {last && (
        <div className={`text-caption ${label}`}>
          {last.interrupted
            ? "Task stopped"
            : last.isError
              ? "Finished with an error"
              : `Done in ${(last.durationMs / 1000).toFixed(1)}s`}
          {last.costUsd !== undefined && ` · $${last.costUsd.toFixed(4)}`}
        </div>
      )}
    </div>
  )
}

function ActivityTab({ state }: { state: AgentState }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
      <p className="text-caption text-[var(--sidebar-text-muted,#898781)]">
        {state.connection === "closed"
          ? "Agent disconnected"
          : state.permissions.length
            ? "Waiting for approval"
            : state.busy
              ? "Agent is working"
              : "Ready for a task"}
      </p>
      <pre className="whitespace-pre-wrap break-words font-mono text-caption">
        {state.logs.join("\n") || "No agent diagnostics"}
      </pre>
    </div>
  )
}
