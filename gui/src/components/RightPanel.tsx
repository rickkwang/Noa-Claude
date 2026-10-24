import { useEffect, useState, type KeyboardEvent } from "react"
import type { AgentState } from "../agent/reducer"
import { Check, ChevronRight, RefreshCcw } from "../lib/icons"
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
  onWorkspaceChange?: () => void
}

// Right column: one pane under a tab strip, as in Codex's side panel.
export function RightPanel({ state, cwd, sessionId, onRefreshContext, tab, onTab, onReference, onWorkspaceChange }: RightPanelProps) {
  // Arrow keys move between tabs, as in a WAI-ARIA tablist.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
    const index = TABS.findIndex((t) => t.id === tab)
    const nextId = TABS[e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]?.id
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
                id={`panel-tab-${t.id}`}
                aria-controls={`panel-${t.id}`}
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
      <div id="panel-files" role="tabpanel" aria-labelledby="panel-tab-files" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "files" ? "flex" : "none" }}>
        <WorkspaceFiles key={`files-${cwd}`} cwd={cwd} active={tab === "files"} refreshKey={state.busy ? 0 : state.turns.length} onReference={onReference} onUpdated={onWorkspaceChange} />
      </div>
      <div id="panel-changes" role="tabpanel" aria-labelledby="panel-tab-changes" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "changes" ? "flex" : "none" }}>
        <WorkspaceFiles key={`changes-${cwd}`} cwd={cwd} changes active={tab === "changes"} refreshKey={state.busy ? 0 : state.turns.length} onReference={onReference} onUpdated={onWorkspaceChange} />
      </div>
      <div id="panel-context" role="tabpanel" aria-labelledby="panel-tab-context" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "context" ? "flex" : "none" }}>
        <ContextTab state={state} cwd={cwd} sessionId={sessionId} active={tab === "context"} onRefreshContext={onRefreshContext} onReference={onReference} />
      </div>
      <div id="panel-activity" role="tabpanel" aria-labelledby="panel-tab-activity" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "activity" ? "flex" : "none" }}>
        <ActivityTab state={state} />
      </div>
    </div>
  )
}

function ContextTab({ state, cwd, sessionId, active, onRefreshContext, onReference }: {
  state: AgentState; cwd: string; sessionId?: string; active: boolean; onRefreshContext: () => void; onReference: (path: string) => void
}) {
  useEffect(() => { if (active && state.connection === "ready") onRefreshContext() }, [active, state.connection, onRefreshContext])
  const usage = state.contextUsage
  const percent = usage ? Math.max(0, Math.min(100, usage.percentage)) : 0
  const categories = usage?.categories?.filter((c) => c.tokens > 0 && c.name !== "Free space" && c.name !== "Autocompact buffer" && !c.isDeferred) ?? []
  const colors = ["#748FFC", "#DA77F2", "#51CF66", "#FCC419", "#FF922B", "#66D9E8", "#F783AC"]
  return <div className="noa-panel-details">
    <div className="noa-panel-section-title">Context window<button type="button" className="noa-panel-button" onClick={onRefreshContext} aria-label="Refresh context"><RefreshCcw size={14} /></button></div>
    <div className="noa-context-total">{Math.round(percent)}%<span>{usage ? `${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens` : "Not measured yet"}</span></div>
    <div className="noa-context-bar" role="meter" aria-label="Context usage" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      {categories.length ? categories.map((c, i) => <span key={c.name} style={{ width: `${Math.min(100, c.tokens / (usage!.maxTokens || 1) * 100)}%`, background: colors[i % colors.length] }} title={`${c.name}: ${c.tokens.toLocaleString()} tokens`} />) : <span style={{ width: `${percent}%`, background: "var(--accent-color)" }} />}
    </div>
    {!!categories.length && <div className="noa-context-categories">{categories.map((c, i) => <div key={c.name}><span className="noa-context-dot" style={{ background: colors[i % colors.length] }} /><span>{c.name}</span><span>{c.tokens.toLocaleString()}</span></div>)}</div>}
    <dl className="noa-context-metadata"><dt>Workspace</dt><dd title={cwd}>{cwd}</dd><dt>Model</dt><dd>{state.model ?? "—"}</dd><dt>Permissions</dt><dd>{state.permissionMode ?? "—"}</dd><dt>Session</dt><dd title={sessionId}>{sessionId ?? "New task"}</dd>{usage?.isAutoCompactEnabled !== undefined && <><dt>Auto compact</dt><dd>{usage.isAutoCompactEnabled ? "Enabled" : "Disabled"}</dd></>}</dl>
    {!!usage?.memoryFiles?.length && <details open><summary>Instructions and memory <span>{usage.memoryFiles.length}</span></summary>{usage.memoryFiles.map((file) => <button type="button" key={file.path} className="noa-file-row" title="Add to chat" onClick={() => onReference(file.path)}><span className="noa-file-name" title={file.path}>{file.path}</span><span className="noa-file-status">{file.tokens.toLocaleString()}</span></button>)}</details>}
    {!!usage?.systemPromptSections?.length && <details><summary>System prompt <span>{usage.systemPromptSections.length} sections</span></summary>{usage.systemPromptSections.map((section) => <div className="noa-context-detail-row" key={section.name}><span>{section.name}</span><span>{section.tokens.toLocaleString()}</span></div>)}</details>}
    {!!usage?.mcpTools?.length && <details><summary>MCP tools <span>{usage.mcpTools.length}</span></summary>{usage.mcpTools.map((tool) => <div className="noa-context-detail-row" key={`${tool.serverName}:${tool.name}`}><span title={tool.serverName}>{tool.name}{tool.isLoaded === false && " · deferred"}</span><span>{tool.tokens.toLocaleString()}</span></div>)}</details>}
    {usage?.skills && <details><summary>Skills <span>{usage.skills.includedSkills} / {usage.skills.totalSkills}</span></summary>{usage.skills.skillFrontmatter.map((skill) => <div className="noa-context-detail-row" key={`${skill.source}:${skill.name}`}><span>{skill.name}</span><span>{skill.tokens.toLocaleString()}</span></div>)}</details>}
    {!!usage?.agents?.length && <details><summary>Agents <span>{usage.agents.length}</span></summary>{usage.agents.map((agent) => <div className="noa-context-detail-row" key={`${agent.source}:${agent.agentType}`}><span>{agent.agentType}</span><span>{agent.tokens.toLocaleString()}</span></div>)}</details>}
    {usage?.apiUsage && <details><summary>Last API usage</summary>{Object.entries(usage.apiUsage).map(([name, value]) => <div className="noa-context-detail-row" key={name}><span>{name.replaceAll("_", " ")}</span><span>{value.toLocaleString()}</span></div>)}</details>}
  </div>
}

function ActivityTab({ state }: { state: AgentState }) {
  const [filter, setFilter] = useState("all")
  const tools = state.turns.flatMap((turn) => turn.role === "assistant" ? turn.blocks.filter((block) => block.kind === "tool") : [])
  const visible = tools.filter((tool) => filter === "all" || tool.status === filter)
  return <div className="noa-panel-details">
    <div className="noa-panel-section-title">{state.connection === "closed" ? "Agent disconnected" : state.permissions.length ? "Waiting for approval" : state.busy ? "Agent is working" : "Ready"}<span className={`noa-activity-dot ${state.busy ? "is-running" : ""}`} /></div>
    {state.result && <p className="noa-panel-muted">{state.result.interrupted ? "Stopped" : state.result.isError ? "Finished with an error" : "Completed"} · {(state.result.durationMs / 1000).toFixed(1)}s{state.result.costUsd !== undefined && ` · $${state.result.costUsd.toFixed(4)}`}</p>}
    <div className="noa-panel-toolbar noa-panel-actions"><span className="noa-panel-muted">{tools.length} tool calls</span><span className="flex-1" /><select aria-label="Filter activity" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All activity</option><option value="running">Running</option><option value="done">Completed</option><option value="error">Errors</option></select></div>
    {visible.length ? visible.map((tool) => <details className="noa-activity-item" key={tool.id} open={tool.status === "running"}><summary>{tool.status === "done" ? <Check size={14} /> : <ChevronRight size={14} className="noa-activity-expand" />}<span>{tool.name}</span><span className={`noa-activity-state is-${tool.status}`}>{tool.status === "done" ? "Completed" : tool.status === "error" ? "Failed" : "Running"}</span></summary><div className="noa-activity-content"><h4>Input</h4><pre>{Object.keys(tool.input).length ? JSON.stringify(tool.input, null, 2) : tool.partialJson || "No input"}</pre>{tool.output !== undefined && <><h4>Output</h4><pre>{tool.output || "No output"}</pre></>}</div></details>) : <p className="noa-panel-empty">{tools.length ? "No matching activity" : "Tool activity will appear here"}</p>}
    <details><summary>Diagnostics <span>{state.logs.length}</span></summary><pre className="noa-activity-log">{state.logs.join("\n") || "No agent diagnostics"}</pre></details>
  </div>
}
