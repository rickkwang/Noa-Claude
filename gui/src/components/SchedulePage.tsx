import { useCallback, useEffect, useState } from "react"
import { fetchSchedules, scheduleAction, startScheduleTask, type ProjectInfo, type ScheduleFrequency, type ScheduledTask } from "../api"
import { ArrowUpDown, ChevronDown, ChevronLeft, Filter, Folder, MessageCircle, MoreHorizontal, Search, Settings } from "../lib/icons"
import { useConfirm } from "./ConfirmDialog"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "./PopupMenu"
import { Row, Section, Toggle, fieldInput, primaryButton } from "./settings/controls"

type Kind = ScheduleFrequency["kind"]
const KINDS: [Kind, string][] = [["manual", "Manual"], ["hourly", "Hourly"], ["daily", "Daily"], ["weekdays", "Weekdays"], ["weekly", "Weekly"], ["cron", "Cron expression"]]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MODES: [string, string, string][] = [
  ["acceptEdits", "Accept edits", "Edits files without asking. Other actions wait for your approval in the sidebar."],
  ["default", "Ask permissions", "Asks before edits and commands. The run waits in the sidebar until you approve."],
  ["auto", "Auto", "Decides which actions are safe and runs them without asking."],
  ["plan", "Plan mode", "Reads and plans only. Makes no changes."],
]

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

// What the frequency means in practice, shown under the schedule while editing.
function schedulePreview(draft: Draft): string {
  if (draft.kind === "manual") return "Runs only when you choose Run now."
  if (draft.kind === "hourly") return "Runs at the start of every hour."
  if (draft.kind === "cron") return "Five fields: minute, hour, day of month, month, day of week. Uses this computer’s time zone."
  const [hour, minute] = draft.time.split(":").map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "Choose a time."
  const now = new Date()
  for (let day = 0; day < 8; day++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, hour, minute)
    const weekday = at.getDay()
    const fits = draft.kind === "daily" || (draft.kind === "weekdays" ? weekday >= 1 && weekday <= 5 : weekday === draft.weekday)
    if (fits && at > now) return `Next run ${nextLabel(at.getTime())}.`
  }
  return ""
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
// A prompt box with the project picker in its footer, as in the composer.
function PromptBox({ label, value, onChange, placeholder, cwd, onCwd, projects, projectName }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; cwd: string; onCwd: (cwd: string) => void; projects: ProjectInfo[]; projectName: (cwd: string) => string }) {
  return (
    <div className="flex flex-col rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-card)]">
      <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} rows={5} placeholder={placeholder} className="resize-none bg-transparent px-3 py-2.5 text-body leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]" />
      <div className="flex items-center border-t border-[var(--border-default)] px-1.5 py-1.5">
        <div className="relative inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-chat-sm text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)]">
          <Folder size={14} />
          {projectName(cwd)}
          <ChevronDown size={12} />
          <select aria-label="Project" value={cwd} onChange={(e) => onCwd(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
            {projects.map((project) => <option key={project.path} value={project.path}>{project.name}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}

type Sort = "name" | "next" | "last"
type Status = "all" | "on" | "off"
const iconButton = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)]"
const backLink = "-ml-1 inline-flex items-center gap-1 self-start text-chat-sm text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"
const fieldHint = "text-caption leading-4 text-[var(--sidebar-text-muted)]"
const fieldLabel = "text-chat-sm font-medium leading-[18px] text-[var(--text-primary)]"
const blank = (cwd: string): Draft => ({ name: "", prompt: "", cwd, kind: "daily", time: "09:00", weekday: 1, cron: "", mode: "acceptEdits" })

export function SchedulePage({ projects, activeCwd, onOpenTask }: { projects: ProjectInfo[]; activeCwd: string; onOpenTask: (cwd: string, id: string) => void }) {
  const { confirm, dialog } = useConfirm()
  const [tasks, setTasks] = useState<ScheduledTask[]>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState("")
  const [draft, setDraft] = useState<Draft>()
  const [saving, setSaving] = useState(false)
  const [menu, setMenu] = useState<{ task: ScheduledTask; anchor: PopupMenuAnchor; trigger: Element }>()
  const [headerMenu, setHeaderMenu] = useState<{ kind: "new" | "filter" | "sort"; anchor: PopupMenuAnchor; trigger: Element }>()
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState<Status>("all")
  const [sort, setSort] = useState<Sort>("name")
  const [compose, setCompose] = useState<{ request: string; cwd: string }>()
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
    try { const started = await startScheduleTask({ action: "run", id: task.id }); await refresh(); onOpenTask(started.cwd, started.sessionId) } catch (e) { setError((e as Error).message) }
  }
  const startCompose = async () => {
    if (!compose) return
    setError(undefined)
    setSaving(true)
    try { const started = await startScheduleTask({ action: "compose", ...compose }); setCompose(undefined); onOpenTask(started.cwd, started.sessionId) } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }
  const defaultCwd = usable.find((p) => p.path === activeCwd)?.path ?? usable[0]?.path ?? activeCwd
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

  if (compose) {
    const close = () => { setCompose(undefined); setError(undefined) }
    return (
      <>
        <div className="flex flex-col gap-2">
          <button type="button" className={backLink} onClick={close}>
            <ChevronLeft size={14} />
            Scheduled
          </button>
          <h1 className="m-0 noa-serif text-[26px] leading-8 text-[var(--text-primary)]">Create with Claude</h1>
        </div>
        <div className="flex flex-col gap-2">
          <span className={fieldLabel}>What should run on a schedule?</span>
          <PromptBox label="What should run on a schedule?" value={compose.request} onChange={(request) => setCompose({ ...compose, request })} placeholder="Every weekday morning, review yesterday’s commits and list anything risky." cwd={compose.cwd} onCwd={(cwd) => setCompose({ ...compose, cwd })} projects={usable} projectName={projectName} />
          <span className="text-caption text-[var(--sidebar-text-muted)]">Claude asks anything it still needs, then sets the task up.</span>
        </div>
        {error && <p role="alert" className="m-0 text-chat-sm text-[var(--text-danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={`${primaryButton} !bg-transparent !text-[var(--text-primary)] border-[var(--border-default)]`} onClick={close}>Cancel</button>
          <button type="button" className={primaryButton} disabled={saving || !compose.request.trim() || !compose.cwd} onClick={startCompose}>Start</button>
        </div>
      </>
    )
  }

  if (draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
    const timed = draft.kind === "daily" || draft.kind === "weekdays" || draft.kind === "weekly"
    return (
      <>
        <div className="flex flex-col gap-2">
          <button type="button" className={backLink} onClick={() => { setDraft(undefined); setError(undefined) }}>
            <ChevronLeft size={14} />
            Scheduled
          </button>
          <h1 className="m-0 noa-serif text-[26px] leading-8 text-[var(--text-primary)]">{draft.id ? "Edit scheduled task" : "New scheduled task"}</h1>
        </div>
        <div className="flex flex-col gap-6">
          <label className="flex flex-col gap-2">
            <span className={fieldLabel}>Name <span className="font-normal text-[var(--sidebar-text-muted)]">(optional)</span></span>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Defaults to the first line of the instructions" className={`${fieldInput} h-8`} />
          </label>
          <div className="flex flex-col gap-2">
            <span className={fieldLabel}>Instructions</span>
            <PromptBox label="Instructions" value={draft.prompt} onChange={(prompt) => set({ prompt })} placeholder="Review yesterday’s commits and list anything risky." cwd={draft.cwd} onCwd={(cwd) => set({ cwd })} projects={usable} projectName={projectName} />
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <span className={fieldLabel}>Schedule</span>
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Frequency" value={draft.kind} onChange={(e) => set({ kind: e.target.value as Kind })} width="w-[150px]">
                  {KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                </Select>
                {draft.kind === "weekly" && (
                  <Select aria-label="Day" value={draft.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} width="w-[130px]">
                    {WEEKDAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}
                  </Select>
                )}
                {timed && <input aria-label="Time" type="time" value={draft.time} onChange={(e) => set({ time: e.target.value })} className={`${fieldInput} h-8 !w-[88px] [&::-webkit-calendar-picker-indicator]:hidden`} />}
                {draft.kind === "cron" && <input aria-label="Cron expression" value={draft.cron} onChange={(e) => set({ cron: e.target.value })} placeholder="0 9 * * 1-5" spellCheck={false} className={`${fieldInput} h-8 !w-[150px] font-mono`} />}
              </div>
              <span className={fieldHint}>{schedulePreview(draft)}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <span className={fieldLabel}>Permissions</span>
              <Select aria-label="Permissions" value={draft.mode} onChange={(e) => set({ mode: e.target.value })} width="w-[150px]">
                {MODES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
              </Select>
              <span className={fieldHint}>{MODES.find(([mode]) => mode === draft.mode)?.[2]}</span>
            </div>
          </div>
        </div>
        {error && <p role="alert" className="m-0 text-chat-sm text-[var(--text-danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={`${primaryButton} !bg-transparent !text-[var(--text-primary)] border-[var(--border-default)]`} onClick={() => { setDraft(undefined); setError(undefined) }}>Cancel</button>
          <button type="button" className={primaryButton} disabled={saving || !draft.prompt.trim() || !draft.cwd} onClick={save}>{draft.id ? "Save" : "Create"}</button>
        </div>
      </>
    )
  }

  const shown = (tasks ?? [])
    .filter((task) => `${task.name} ${task.prompt}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .filter((task) => status === "all" || (status === "on" ? task.enabled && task.frequency.kind !== "manual" : !task.enabled))
    .sort((a, b) => sort === "next" ? (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) : sort === "last" ? (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0) : 0)
  const open = (kind: "new" | "filter" | "sort") => (e: React.MouseEvent) => setHeaderMenu({ kind, anchor: anchorBelow(e.currentTarget), trigger: e.currentTarget })
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="m-0 noa-serif text-[26px] leading-8 text-[var(--text-primary)]">Scheduled</h1>
        <div className="flex items-center gap-1">
          {(tasks?.length ?? 0) > 0 && (
            <>
              <button type="button" aria-label="Search scheduled tasks" aria-pressed={searching} className={iconButton} onClick={() => { setSearching(!searching); setFilter("") }}><Search size={15} /></button>
              <button type="button" aria-label="Filter scheduled tasks" aria-haspopup="menu" className={`${iconButton} ${status !== "all" ? "text-[var(--text-primary)]" : ""}`} onClick={open("filter")}><Filter size={15} /></button>
              <button type="button" aria-label="Sort scheduled tasks" aria-haspopup="menu" className={iconButton} onClick={open("sort")}><ArrowUpDown size={15} /></button>
            </>
          )}
          <button type="button" aria-haspopup="menu" className={`${primaryButton} ml-1.5`} onClick={open("new")}>
            New task
            <ChevronDown size={13} />
          </button>
        </div>
      </div>
      <p className="-mt-3 m-0 text-chat-sm text-[var(--sidebar-text-muted)]">Scheduled tasks only run while Noa is open and your computer is awake.</p>
      {searching && (tasks?.length ?? 0) > 0 && (
        <label className="flex h-7 w-full max-w-[320px] items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] px-2.5 text-[var(--sidebar-text-muted)] focus-within:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
          <Search size={13} className="shrink-0" />
          <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search scheduled tasks" aria-label="Search scheduled tasks" className="min-w-0 flex-1 bg-transparent text-chat-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]" />
        </label>
      )}
      {error && <p role="alert" className="m-0 text-chat-sm text-[var(--text-danger)]">{error}</p>}
      {tasks === undefined ? (
        !error && <p className="m-0 text-chat-sm text-[var(--sidebar-text-muted)]">Loading scheduled tasks</p>
      ) : tasks.length === 0 ? (
        <p className="m-0 py-6 text-center text-chat-sm text-[var(--sidebar-text-muted)]">No scheduled tasks yet. Create one to run a prompt on a schedule.</p>
      ) : shown.length === 0 ? (
        <p className="m-0 py-6 text-center text-chat-sm text-[var(--sidebar-text-muted)]">{filter.trim() ? `No scheduled tasks match “${filter.trim()}”` : "No scheduled tasks match this filter."}</p>
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
      {headerMenu && (
        <PopupMenu
          anchor={headerMenu.anchor}
          trigger={headerMenu.trigger}
          label={headerMenu.kind === "new" ? "New task" : headerMenu.kind === "filter" ? "Filter scheduled tasks" : "Sort scheduled tasks"}
          onClose={() => setHeaderMenu(undefined)}
          entries={
            headerMenu.kind === "new"
              ? [
                  { label: "Create with Claude", icon: MessageCircle, onSelect: () => setCompose({ request: "", cwd: defaultCwd }) },
                  { label: "Set up manually", icon: Settings, onSelect: () => setDraft(blank(defaultCwd)) },
                ]
              : headerMenu.kind === "filter"
                ? ([["all", "All"], ["on", "On"], ["off", "Off"]] as const).map(([value, label]) => ({ label, checked: status === value, onSelect: () => setStatus(value) }))
                : ([["name", "Name"], ["next", "Next run"], ["last", "Last run"]] as const).map(([value, label]) => ({ label, checked: sort === value, onSelect: () => setSort(value) }))
          }
        />
      )}
      {dialog}
    </>
  )
}
