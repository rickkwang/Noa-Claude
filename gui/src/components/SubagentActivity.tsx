import { useEffect, useRef, useState, type ReactNode } from "react"
import type { AgentTask, ToolBlock } from "../agent/reducer"
import { ChevronRight, Users } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { SubagentAvatar } from "./SubagentAvatar"
import { Markdown } from "./Markdown"

export function SubagentActivity({ blocks, tasks = [], onOpenTask, details, trackedTaskIds, verbose = false }: {
  blocks: ToolBlock[]
  tasks?: AgentTask[]
  onOpenTask?: (id?: string) => void
  details?: ReactNode
  trackedTaskIds?: ReadonlySet<string>
  verbose?: boolean
}) {
  const [open, setOpen] = useState(verbose)
  const [detailsOpen, setDetailsOpen] = useState(verbose)
  const prevVerbose = useRef(verbose)
  useEffect(() => {
    if (prevVerbose.current === verbose) return
    prevVerbose.current = verbose
    setOpen(verbose)
    setDetailsOpen(verbose)
  }, [verbose])
  const entries = blocks.map(block => ({ block, task: tasks.find(task => task.id === block.id || task.toolUseId === block.id) }))
  const agents = [...new Map(entries.filter(entry => entry.task && !trackedTaskIds?.has(entry.task.id)).map(entry => [entry.task!.id, entry.task!])).values()]
  const action = entries.some(({ block, task }) => block.status === "running" && (!task || task.status === "running")) ? "Creating" : blocks.some(block => block.status === "error") ? "Failed to create" : blocks.some(block => block.status === "stopped") ? "Stopped creating" : "Created"
  const label = `${action} ${blocks.length === 1 ? "an agent" : `${blocks.length} agents`}`
  return <div data-subagent-group className="not-prose flex min-w-0 flex-col gap-2 text-[length:var(--font-text-md-size)] leading-5">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="group/agents flex min-w-0 items-center gap-1.5 text-left text-[color-mix(in_srgb,var(--text-primary)_60%,transparent)] hover:text-[var(--text-primary)]">
      <Users size={16} className="shrink-0" />
      <span className={action === "Creating" ? "noa-shimmer" : ""}>{label}</span>
      <ChevronRight size={12} className={`shrink-0 opacity-0 group-hover/agents:opacity-100 group-focus-visible/agents:opacity-100 ${open ? "rotate-90" : ""}`} />
    </button>
    <Collapsible open={open}>
      <div data-agent-instructions className="flex flex-col gap-1 border-l border-[var(--divider-subtle)] ps-5 text-[var(--text-secondary)]">
        {entries.map(({ block, task }) => <div key={block.id}>
          <div className="flex min-w-0 gap-1">
          <span className="shrink-0">{block.status === "running" ? "Creating" : block.status === "error" ? "Failed to create" : "Created"}</span>
          {task && onOpenTask ? <button type="button" onClick={() => onOpenTask(task.id)} className="min-w-0 truncate font-medium hover:underline">{task.description}</button> : <span className="min-w-0 truncate">{String(block.input.description ?? "agent")}</span>}
          {typeof block.input.prompt === "string" && <span className="min-w-0 flex-1 truncate text-[var(--text-tertiary)]" title={block.input.prompt}>with the instructions: {block.input.prompt}</span>}
          </div>
          {!task && block.output && <div className="py-1"><Markdown text={block.output} /></div>}
        </div>)}
      </div>
    </Collapsible>
    {(["running", "completed", "failed", "stopped", "unknown"] as const).map(status => <SubagentStatus key={status} members={agents.filter(task => task.status === status)} status={status} onOpenTask={onOpenTask ?? (details ? () => setDetailsOpen(value => !value) : undefined)} expanded={onOpenTask ? undefined : detailsOpen} />)}
    {details && <Collapsible open={detailsOpen}>{details}</Collapsible>}
  </div>
}

export function SubagentStatus({ members, status, onOpenTask, expanded }: {
  members: Pick<AgentTask, "id" | "description">[]
  status: AgentTask["status"]
  onOpenTask?: (id?: string) => void
  expanded?: boolean
}) {
  if (!members.length) return null
  const label = status === "running" ? "started working" : status === "completed" ? "finished" : status === "failed" ? "finished with errors" : status === "stopped" ? "were interrupted" : "disconnected"
  const named = members.length > 3 ? members.slice(0, 2) : members
  return <div data-subagent-activity-row data-subagent-state={status} className="flex min-w-0 items-start gap-1.5 text-left text-[var(--text-secondary)]">
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5">
      {members.slice(0, 4).map((task, index) => index < named.length
        ? <span key={task.id}><SubagentAvatar id={task.id} size={16} /></span>
        : <button key={task.id} type="button" aria-label={`Open ${task.description} subagent`} disabled={!onOpenTask} onClick={() => onOpenTask?.(task.id)}><SubagentAvatar id={task.id} size={16} /></button>)}
    </span>
    <span className="min-w-0">
      {named.map((task, index) => <span key={task.id}>
        {index > 0 && (index === named.length - 1 && named.length === members.length ? " and " : ", ")}
        <button type="button" data-subagent-id={task.id} disabled={!onOpenTask} aria-expanded={expanded} onClick={() => onOpenTask?.(task.id)} className="inline rounded-sm text-left hover:text-[var(--text-primary)] disabled:cursor-default">{task.description}</button>
      </span>)}
      {members.length > 3 && <> and <button type="button" onClick={() => onOpenTask?.()} disabled={!onOpenTask} className="inline hover:text-[var(--text-primary)]">{members.length - 2} more</button></>}
      {" "}{label === "were interrupted" && members.length === 1 ? "was interrupted" : label}
    </span>
  </div>
}
