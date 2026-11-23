import { useCallback, useEffect, useState } from "react"
import { fetchSchedules, runScheduledTask, scheduleAction, type ProjectInfo, type ScheduleFrequency, type ScheduledTask } from "../api"
import { ChevronDown, ChevronLeft, MoreHorizontal, Plus, Search } from "../lib/icons"
import { useConfirm } from "./ConfirmDialog"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "./PopupMenu"
import { Row, Section, Toggle, fieldInput, primaryButton } from "./settings/controls"

type Kind = ScheduleFrequency["kind"]
const KINDS: [Kind, string][] = [["manual", "Manual"], ["hourly", "Hourly"], ["daily", "Daily"], ["weekdays", "Weekdays"], ["weekly", "Weekly"], ["cron", "Cron expression"]]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MODES: [string, string][] = [["acceptEdits", "Accept edits"], ["default", "Ask permissions"], ["auto", "Auto"], ["plan", "Plan mode"]]

interface Draft { id?: string; name: string; prompt: string; cwd: string; kind: Kind; time: string; weekday: number; cron: string; mode: string }

function toFrequency(draft: Draft): ScheduleFrequency {
  switch (draft.kind) {
    case "manual": case "hourly": return { kind: draft.kind }
    case "cron": return { kind: "cron", cron: draft.cron }
    case "weekly": return { kind: "weekly", time: draft.time, weekday: draft.weekday }
    default: return { kind: draft.kind, time: draft.time }
  }
}

function fromTask(task: ScheduledTask): Draft {
  const f = task.frequency
  return { id: task.id, name: task.name, prompt: task.prompt, cwd: task.cwd, mode: task.mode, kind: f.kind, time: "time" in f ? f.time : "09:00", weekday: f.kind === "weekly" ? f.weekday : 1, cron: f.kind === "cron" ? f.cron : "" }
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

function nextLabel(ms: number): string {
  const when = new Date(ms)
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const days = Math.round((new Date(when).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  return days <= 0 ? `today at ${time}` : days === 1 ? `tomorrow at ${time}` : `${when.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${time}`
}

// A native select with the chevron drawn over it; `width` sizes the wrapper and the select fills it.
function Select({ width, children, ...props }: { width: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative shrink-0 ${width}`}>
      <select {...props} className={`${fieldInput} h-8 appearance-none pr-8`}>{children}</select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--sidebar-text-muted)]" />
    </div>
  )
}
const blank = (cwd: string): Draft => ({ name: "", prompt: "", cwd, kind: "daily", time: "09:00", weekday: 1, cron: "", mode: "acceptEdits" })

export function SchedulePage({ projects, activeCwd, onOpenTask }: { projects: ProjectInfo[]; activeCwd: string; onOpenTask: (cwd: string, id: string) => void }) {
  const { confirm, dialog } = useConfirm()
  const [tasks, setTasks] = useState<ScheduledTask[]>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState("")
  const [draft, setDraft] = useState<Draft>()
  const [saving, setSaving] = useState(false)
  const [menu, setMenu] = useState<{ task: ScheduledTask; anchor: PopupMenuAnchor; trigger: Element }>()
  const usable = projects.filter((project) => !project.missing)
  const projectName = (cwd: string) => projects.find((project) => project.path === cwd || project.sources.includes(cwd))?.name ?? cwd.split("/").pop() ?? cwd

  const refresh = useCallback(() => fetchSchedules().then(setTasks, (e: Error) => setError(e.message)), [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh])

  const mutate = async (work: Promise<ScheduledTask[]>) => {
    setError(undefined)
    try { setTasks(await work); return true } catch (e) { setError((e as Error).message); return false }
  }
  const run = async (task: ScheduledTask) => {
    setError(undefined)
    try { const started = await runScheduledTask(task.id); await refresh(); onOpenTask(started.cwd, started.sessionId) } catch (e) { setError((e as Error).message) }
  }
  const remove = async (task: ScheduledTask) => {
    if (await confirm({ title: `Delete “${task.name}”?`, description: "Tasks this scheduled task already started are kept.", confirmLabel: "Delete", danger: true })) await mutate(scheduleAction({ action: "delete", id: task.id }))
  }
  const save = async () => {
    if (!draft) return
    setSaving(true)
    const ok = await mutate(scheduleAction({ action: draft.id ? "update" : "create", id: draft.id, name: draft.name, prompt: draft.prompt, cwd: draft.cwd, frequency: toFrequency(draft), mode: draft.mode }))
    setSaving(false)
    if (ok) setDraft(undefined)
  }

  if (draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
    const timed = draft.kind === "daily" || draft.kind === "weekdays" || draft.kind === "weekly"
    return (
      <>
        <h1 className="m-0 noa-serif text-[26px] leading-8 text-[var(--text-primary)]">{draft.id ? "Edit scheduled task" : "New scheduled task"}</h1>
        <button type="button" className="-mt-2 inline-flex items-center gap-1 self-start text-chat-sm text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]" onClick={() => { setDraft(undefined); setError(undefined) }}>
          <ChevronLeft size={14} />
          Scheduled
        </button>
        <Section>
          <Row label="Name"><input aria-label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Daily code review" className={`${fieldInput} h-8 max-w-[320px]`} /></Row>
          <div className="flex flex-col gap-2 px-4 py-3">
            <span className="text-chat-sm font-medium leading-[18px]">Prompt</span>
            <textarea aria-label="Prompt" value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={5} placeholder="Review yesterday’s commits and list anything risky." className={`${fieldInput} resize-y py-2 leading-5`} />
          </div>
          <Row label="Project" description="Each run starts a new task in this folder.">
            <Select aria-label="Project" value={draft.cwd} onChange={(e) => set({ cwd: e.target.value })} width="w-[240px]">
              {usable.map((project) => <option key={project.path} value={project.path}>{project.name}</option>)}
            </Select>
          </Row>
          <Row label="Frequency">
            <div className="flex items-center gap-2">
              <Select aria-label="Frequency" value={draft.kind} onChange={(e) => set({ kind: e.target.value as Kind })} width="w-[160px]">
                {KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
              </Select>
              {draft.kind === "weekly" && (
                <Select aria-label="Day" value={draft.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} width="w-[130px]">
                  {WEEKDAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}
                </Select>
              )}
              {timed && <input aria-label="Time" type="time" value={draft.time} onChange={(e) => set({ time: e.target.value })} className={`${fieldInput} h-8 w-[110px]`} />}
              {draft.kind === "cron" && <input aria-label="Cron expression" value={draft.cron} onChange={(e) => set({ cron: e.target.value })} placeholder="0 9 * * 1-5" spellCheck={false} className={`${fieldInput} h-8 w-[160px] font-mono`} />}
            </div>
          </Row>
          <Row label="Permissions" description="Runs without a person watching, so a task that needs approval waits in the sidebar.">
            <Select aria-label="Permissions" value={draft.mode} onChange={(e) => set({ mode: e.target.value })} width="w-[160px]">
              {MODES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
            </Select>
          </Row>
        </Section>
        {error && <p role="alert" className="m-0 text-chat-sm text-[var(--text-danger)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={`${primaryButton} !bg-transparent !text-[var(--text-primary)] border-[var(--border-default)]`} onClick={() => { setDraft(undefined); setError(undefined) }}>Cancel</button>
          <button type="button" className={primaryButton} disabled={saving || !draft.name.trim() || !draft.prompt.trim() || !draft.cwd} onClick={save}>{draft.id ? "Save" : "Create"}</button>
        </div>
      </>
    )
  }

  const shown = (tasks ?? []).filter((task) => `${task.name} ${task.prompt}`.toLowerCase().includes(filter.trim().toLowerCase()))
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="m-0 noa-serif text-[26px] leading-8 text-[var(--text-primary)]">Scheduled</h1>
        <button type="button" className={primaryButton} onClick={() => setDraft(blank(usable.find((p) => p.path === activeCwd)?.path ?? usable[0]?.path ?? activeCwd))}>
          <Plus size={13} />
          New scheduled task
        </button>
      </div>
      <p className="-mt-3 m-0 text-chat-sm text-[var(--sidebar-text-muted)]">Scheduled tasks only run while Noa is open and your computer is awake.</p>
      {(tasks?.length ?? 0) > 0 && (
        <label className="flex h-7 w-full max-w-[320px] items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] px-2.5 text-[var(--sidebar-text-muted)] focus-within:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
          <Search size={13} className="shrink-0" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search scheduled tasks" aria-label="Search scheduled tasks" className="min-w-0 flex-1 bg-transparent text-chat-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]" />
        </label>
      )}
      {error && <p role="alert" className="m-0 text-chat-sm text-[var(--text-danger)]">{error}</p>}
      {tasks === undefined ? (
        !error && <p className="m-0 text-chat-sm text-[var(--sidebar-text-muted)]">Loading scheduled tasks</p>
      ) : tasks.length === 0 ? (
        <p className="m-0 py-6 text-center text-chat-sm text-[var(--sidebar-text-muted)]">No scheduled tasks yet. Create one to run a prompt on a schedule.</p>
      ) : shown.length === 0 ? (
        <p className="m-0 py-6 text-center text-chat-sm text-[var(--sidebar-text-muted)]">No scheduled tasks match “{filter.trim()}”</p>
      ) : (
        <Section>
          {shown.map((task) => (
            <Row
              key={task.id}
              label={task.name}
              description={
                <>
                  {task.summary} · {projectName(task.cwd)}
                  {task.enabled && task.nextRunAt ? ` · next ${nextLabel(task.nextRunAt)}` : task.frequency.kind !== "manual" && !task.enabled ? " · off" : ""}
                  {task.lastError ? <span className="text-[var(--text-danger)]"> · {task.lastError}</span> : null}
                  {task.lastRunAt && !task.lastError && task.lastSessionId ? (
                    <> · <button type="button" className="underline-offset-2 hover:text-[var(--text-primary)] hover:underline" onClick={() => onOpenTask(task.cwd, task.lastSessionId!)}>ran {ago(task.lastRunAt)}</button></>
                  ) : null}
                </>
              }
            >
              <div className="flex items-center gap-2">
                {task.frequency.kind !== "manual" && <Toggle checked={task.enabled} label={`${task.enabled ? "Turn off" : "Turn on"} ${task.name}`} onChange={(enabled) => mutate(scheduleAction({ action: "update", id: task.id, enabled }))} />}
                <button
                  type="button"
                  aria-label={`Actions for ${task.name}`}
                  aria-haspopup="menu"
                  onClick={(e) => setMenu({ task, anchor: anchorBelow(e.currentTarget), trigger: e.currentTarget })}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)]"
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </Row>
          ))}
        </Section>
      )}
      {menu && (
        <PopupMenu
          anchor={menu.anchor}
          trigger={menu.trigger}
          label={`Actions for ${menu.task.name}`}
          onClose={() => setMenu(undefined)}
          entries={[
            { label: "Run now", onSelect: () => run(menu.task) },
            { label: "Edit", onSelect: () => setDraft(fromTask(menu.task)) },
            { label: "Duplicate", onSelect: () => { mutate(scheduleAction({ action: "duplicate", id: menu.task.id })) } },
            { kind: "separator" },
            { label: "Delete", danger: true, onSelect: () => remove(menu.task) },
          ]}
        />
      )}
      {dialog}
    </>
  )
}
