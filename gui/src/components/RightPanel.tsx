import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react"
import type { AgentState, ToolBlock } from "../agent/reducer"
import type { TurnDiff } from "../agent/protocol"
import { ChevronRight, RefreshCcw } from "../lib/icons"
import { ToolCard } from "./ToolCard"
import { TurnReview } from "./TurnReview"
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
  onStopTask: (id: string) => void
  cwd: string
  sessionId?: string
  onRefreshContext: () => void
  onLoadEarlier: () => void
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onReference: (path: string) => void
  onWorkspaceChange?: () => void
  workspaceRefreshKey: number
  focusChange?: { path: string; at: number }
  focusFile?: { path: string; at: number; line?: number; endLine?: number }
  turnDiff?: { diff: TurnDiff; path?: string; key: number }
}

// Right column: one pane under a tab strip, as in Codex's side panel.
export function RightPanel({ state, onStopTask, cwd, sessionId, onRefreshContext, onLoadEarlier, tab, onTab, onReference, onWorkspaceChange, workspaceRefreshKey, focusChange, focusFile, turnDiff }: RightPanelProps) {
  const [fileChange, setFileChange] = useState<{ cwd: string; path: string; at: number; scope: "all" }>()
  const [changeMode, setChangeMode] = useState<"turn" | "working">("working")
  useEffect(() => {
    setChangeMode(turnDiff ? "turn" : "working")
  }, [turnDiff?.key, turnDiff === undefined])
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
      <div className="flex h-11 shrink-0 items-center gap-1 pl-2 pr-12">
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
        <WorkspaceFiles key={`files-${cwd}`} cwd={cwd} active={tab === "files"} focus={focusFile} refreshKey={workspaceRefreshKey} onReference={onReference} onUpdated={onWorkspaceChange} onOpenChanges={(path) => { if (path) setFileChange({ cwd, path, at: Date.now(), scope: "all" }); setChangeMode("working"); onTab("changes") }} />
      </div>
      <div id="panel-changes" role="tabpanel" aria-labelledby="panel-tab-changes" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "changes" ? "flex" : "none" }}>
        {turnDiff && (
          <div className="noa-panel-toolbar noa-turn-scope">
            <div className="noa-segmented" role="radiogroup" aria-label="Change scope">
              <button type="button" role="radio" aria-checked={changeMode === "turn"} onClick={() => setChangeMode("turn")}>This turn</button>
              <button type="button" role="radio" aria-checked={changeMode === "working"} onClick={() => setChangeMode("working")}>Working tree</button>
            </div>
            {changeMode === "turn" && (
              <span className="min-w-0 truncate text-caption tabular-nums text-[var(--sidebar-text-muted)]">
                {turnDiff.diff.files.length} {turnDiff.diff.files.length === 1 ? "file" : "files"}
              </span>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 flex-col" style={{ display: tab === "changes" && changeMode === "working" ? "flex" : "none" }}>
          <WorkspaceFiles key={`changes-${cwd}`} cwd={cwd} changes focus={fileChange?.cwd === cwd && (!focusChange || fileChange.at > focusChange.at) ? fileChange : focusChange} active={tab === "changes" && changeMode === "working"} refreshKey={workspaceRefreshKey} onReference={onReference} onUpdated={onWorkspaceChange} />
        </div>
        {turnDiff && (
          <div className="min-h-0 flex-1 flex-col" style={{ display: tab === "changes" && changeMode === "turn" ? "flex" : "none" }}>
            <TurnReview diff={turnDiff.diff} focusPath={turnDiff.path} focusKey={turnDiff.key} />
          </div>
        )}
      </div>
      <div id="panel-context" role="tabpanel" aria-labelledby="panel-tab-context" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "context" ? "flex" : "none" }}>
        <ContextTab state={state} cwd={cwd} sessionId={sessionId} active={tab === "context"} onRefreshContext={onRefreshContext} onReference={onReference} />
      </div>
      <div id="panel-activity" role="tabpanel" aria-labelledby="panel-tab-activity" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === "activity" ? "flex" : "none" }}>
        <ActivityTab state={state} onStopTask={onStopTask} onLoadEarlier={onLoadEarlier} />
      </div>
    </div>
  )
}

const compact = (n: number) => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n)

function Section({ title, count, open, children }: { title: string; count?: string | number; open?: boolean; children: ReactNode }) {
  return <details className="noa-panel-section" open={open}>
    <summary><ChevronRight size={12} className="noa-panel-section-chevron" /><span>{title}</span>{count !== undefined && <span className="noa-panel-section-count">{count}</span>}</summary>
    <div className="noa-panel-section-body">{children}</div>
  </details>
}

function DetailRow({ name, value, title }: { name: ReactNode; value: number; title?: string }) {
  return <div className="noa-context-detail-row" title={title}><span>{name}</span><span>{value.toLocaleString()}</span></div>
}

function ContextTab({ state, cwd, sessionId, active, onRefreshContext, onReference }: {
  state: AgentState; cwd: string; sessionId?: string; active: boolean; onRefreshContext: () => void; onReference: (path: string) => void
}) {
  useEffect(() => { if (active && state.connection === "ready") onRefreshContext() }, [active, state.connection, onRefreshContext])
  const usage = state.contextUsage
  const percent = usage ? Math.max(0, Math.min(100, usage.percentage)) : 0
  const categories = usage?.categories?.filter((c) => c.tokens > 0 && c.name !== "Free space" && c.name !== "Autocompact buffer" && !c.isDeferred) ?? []
  const colors = ["#748FFC", "#DA77F2", "#51CF66", "#FCC419", "#FF922B", "#66D9E8", "#F783AC"]
  const used = categories.reduce((sum, c) => sum + c.tokens, 0) || 1
  const tone = percent >= 90 ? "is-critical" : percent >= 70 ? "is-warning" : ""
  const home = cwd.match(/^\/(?:Users|home)\/[^/]+/)?.[0]
  return <div className="noa-panel-details">
    <section className="noa-context-card">
      <div className="noa-panel-section-title"><span className="noa-panel-eyebrow">Context window</span><button type="button" className="noa-panel-button" onClick={onRefreshContext} disabled={state.contextLoading || state.connection !== "ready"} aria-label="Refresh context" title="Refresh"><RefreshCcw size={14} /></button></div>
      <p className="noa-panel-muted" role={state.contextError ? "alert" : "status"}>{state.contextLoading ? "Refreshing…" : state.contextError ? `Refresh failed: ${state.contextError}` : state.connection === "closed" ? usage ? "Disconnected · showing last measurement" : "Disconnected" : state.contextUpdatedAt ? `Measured ${new Date(state.contextUpdatedAt).toLocaleTimeString()}` : "Waiting for measurement"}</p>
      <div className={`noa-context-total ${tone}`}><b>{usage ? <>{Math.round(percent)}<small>%</small></> : "—"}</b><span>{usage ? `${compact(usage.totalTokens)} of ${compact(usage.maxTokens)} tokens` : "Not measured yet"}</span></div>
      <div className="noa-context-bar" role="meter" aria-label="Context usage" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        {categories.length ? categories.map((c, i) => <span key={c.name} style={{ width: `${Math.min(100, c.tokens / (usage!.maxTokens || 1) * 100)}%`, background: colors[i % colors.length] }} title={`${c.name}: ${c.tokens.toLocaleString()} tokens`} />) : <span style={{ width: `${percent}%`, background: "var(--accent-color)" }} />}
      </div>
      {!!categories.length && <div className="noa-context-categories">{categories.map((c, i) => <div key={c.name} title={`${c.tokens.toLocaleString()} tokens`}><span className="noa-context-dot" style={{ background: colors[i % colors.length] }} /><span>{c.name}</span><span className="noa-context-share">{Math.round(c.tokens / used * 100)}%</span><span>{compact(c.tokens)}</span></div>)}</div>}
    </section>
    <dl className="noa-context-metadata">
      <dt>Workspace</dt><dd title={cwd}>{home ? `~${cwd.slice(home.length)}` : cwd}</dd>
      <dt>Model</dt><dd>{state.model ?? "—"}</dd>
      <dt>Permissions</dt><dd>{state.permissionMode ?? "—"}</dd>
      {state.result?.costUsd !== undefined && <><dt>Session cost</dt><dd>${state.result.costUsd.toFixed(4)}</dd></>}
      <dt>Session</dt><dd title={sessionId}>{sessionId ? sessionId.slice(0, 8) : "New task"}</dd>
      {usage?.isAutoCompactEnabled !== undefined && <><dt>Auto compact</dt><dd>{usage.isAutoCompactEnabled ? "On" : "Off"}</dd></>}
    </dl>
    <div className="noa-panel-sections">
      {!!usage?.memoryFiles?.length && <Section title="Instructions and memory" count={usage.memoryFiles.length} open>{usage.memoryFiles.map((file) => <button type="button" key={file.path} className="noa-context-detail-row is-action" title={`${file.path}\nAdd to chat`} onClick={() => onReference(file.path)}><span>{home && file.path.startsWith(home) ? `~${file.path.slice(home.length)}` : file.path}</span><span>{file.tokens.toLocaleString()}</span></button>)}</Section>}
      {!!usage?.systemPromptSections?.length && <Section title="System prompt" count={`${usage.systemPromptSections.length} sections`}>{usage.systemPromptSections.map((section) => <DetailRow key={section.name} name={section.name} value={section.tokens} />)}</Section>}
      {!!usage?.mcpTools?.length && <Section title="MCP tools" count={usage.mcpTools.length}>{usage.mcpTools.map((tool) => <DetailRow key={`${tool.serverName}:${tool.name}`} title={tool.serverName} name={<>{tool.name}{tool.isLoaded === false && <em> deferred</em>}</>} value={tool.tokens} />)}</Section>}
      {usage?.skills && <Section title="Skills" count={`${usage.skills.includedSkills} / ${usage.skills.totalSkills}`}>{usage.skills.skillFrontmatter.map((skill) => <DetailRow key={`${skill.source}:${skill.name}`} name={skill.name} value={skill.tokens} />)}</Section>}
      {!!usage?.agents?.length && <Section title="Agents" count={usage.agents.length}>{usage.agents.map((agent) => <DetailRow key={`${agent.source}:${agent.agentType}`} name={agent.agentType} value={agent.tokens} />)}</Section>}
      {usage?.apiUsage && <Section title="Last API usage">{Object.entries(usage.apiUsage).map(([name, value]) => <DetailRow key={name} name={name.replaceAll("_", " ")} value={value} />)}</Section>}
    </div>
  </div>
}

const FILTERS = [{ id: "all", label: "All" }, { id: "running", label: "Running" }, { id: "error", label: "Failed" }] as const

function ActivityTab({ state, onStopTask, onLoadEarlier }: { state: AgentState; onStopTask: (id: string) => void; onLoadEarlier: () => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all")
  // Newest first: the latest call is what the user is usually looking for.
  const tools = state.turns.flatMap((turn) => turn.role === "assistant" ? turn.blocks.filter((block): block is ToolBlock => block.kind === "tool") : []).reverse()
  const counts = { all: tools.length, running: tools.filter((t) => t.status === "running").length, error: tools.filter((t) => t.status === "error").length }
  const visible = tools.filter((tool) => filter === "all" || tool.status === filter)
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
    <div className="noa-segmented" role="radiogroup" aria-label="Filter activity">
      {FILTERS.map((f) => <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}<span>{counts[f.id]}</span></button>)}
    </div>
    <div className="noa-activity-list">{visible.length ? visible.map((tool) => <ToolCard key={tool.id} block={tool} tasks={state.tasks} task={state.tasks.find(task => task.id === tool.id || task.toolUseId === tool.id)} />) : <p className="noa-panel-empty">{tools.length ? "No matching activity" : state.historyBefore ? "No loaded tool activity" : "Tool calls will appear here"}</p>}</div>
    {!!state.historyBefore && <div className="noa-activity-history"><span>Showing loaded activity</span><button type="button" className="noa-panel-button" disabled={state.historyLoading} onClick={onLoadEarlier}>{state.historyLoading ? "Loading…" : "Load earlier"}</button></div>}
    <div className="noa-panel-sections"><Section title="Diagnostics" count={state.logs.length}><pre className="noa-activity-log">{state.logs.join("\n") || "No agent diagnostics"}</pre></Section></div>
  </div>
}
