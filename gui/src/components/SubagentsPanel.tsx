import type { AgentTask } from "../agent/reducer"
import { ArrowLeft } from "../lib/icons"
import { SubagentAvatar } from "./SubagentAvatar"
import { TaskDetail } from "./ToolCard"

export function SubagentsPanel({ tasks, selectedId, onSelect, onStopTask }: {
  tasks: AgentTask[]
  selectedId?: string
  onSelect: (id?: string) => void
  onStopTask: (id: string) => void
}) {
  const selected = tasks.find(task => task.id === selectedId)
  if (selected) return <div data-subagent-detail className="flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-11 items-center gap-2 border-b border-[var(--divider-subtle)] px-3 text-body">
      <button type="button" aria-label="Back to subagents" onClick={() => onSelect()} className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--fill-hover)]"><ArrowLeft size={16} /></button>
      <SubagentAvatar id={selected.id} />
      <span className="min-w-0 truncate">{selected.description}</span>
    </div>
    <div className="scrollbar-on-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3"><TaskDetail task={selected} tasks={tasks} onStopTask={onStopTask} /></div>
  </div>
  const active = tasks.filter(task => task.status === "running" || task.status === "unknown")
  const done = tasks.filter(task => task.status !== "running" && task.status !== "unknown")
  return <div className="scrollbar-on-scroll min-h-0 flex-1 overflow-y-auto px-3 py-5 text-chat-sm">
    {[{ title: "Active", items: active }, { title: "Done", items: done }].map(({ title, items }) => <section key={title} className={title === "Done" ? "mt-6" : ""}>
      <h2 className="mb-2 flex items-center gap-1 px-2 text-chat-sm font-normal text-[var(--text-tertiary)]">{title} · {items.length}</h2>
      {!items.length && title === "Active" && <p className="m-0 px-2 py-1 text-[var(--text-tertiary)]">No active subagents</p>}
      <div className="flex flex-col gap-1">
        {items.map(task => <button key={task.id} type="button" onClick={() => onSelect(task.id)} className="flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--fill-hover)]">
          <SubagentAvatar id={task.id} size="1.375em" />
          <span className="min-w-0 flex-1 truncate">{task.description}</span>
          {task.status === "failed" || task.status === "stopped" || task.status === "unknown" ? <span className="shrink-0 text-caption capitalize text-[var(--text-tertiary)]">{task.status === "unknown" ? "Disconnected" : task.status}</span> : null}
        </button>)}
      </div>
    </section>)}
  </div>
}
