import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent } from "react"
import type { SessionSummary } from "../api"
import { CheckCircle2, ChevronDown, MoreHorizontal, Search } from "../lib/icons"
import { anchorBelow, PopupMenu, type PopupMenuAnchor } from "./PopupMenu"
import { ageLabel } from "./SessionHoverCard"

type Group = "review" | "needs" | "working" | "recent" | "resolved"
const GROUPS: { id: Group; title: string }[] = [
  { id: "review", title: "Ready for review" },
  { id: "needs", title: "Needs input" },
  { id: "working", title: "Working" },
  { id: "recent", title: "Recent" },
  { id: "resolved", title: "Resolved" },
]
// `is:` filters typed into the search box; aliases map onto the groups.
const IS_FILTERS: Record<string, Group> = { review: "review", pr: "review", needs: "needs", waiting: "needs", working: "working", running: "working", queued: "working", recent: "recent", idle: "recent", resolved: "resolved", done: "resolved" }

function groupOf(session: SessionSummary): Group {
  if (session.status === "waiting") return "needs"
  if (session.status) return "working"
  if (session.resolvedAt) return "resolved"
  if (session.error) return "needs"
  return session.pr?.state === "open" ? "review" : "recent"
}

function statusLabel(session: SessionSummary): string {
  if (session.status === "waiting") return "Approval required"
  if (session.status === "running") return "Running"
  if (session.status === "queued") return "Queued"
  if (session.resolvedAt) return "Resolved"
  if (session.error) return "Failed"
  return session.pr?.state === "open" ? "Ready for review" : "Idle"
}

// A running task shows the step it is on, a failed one why, otherwise where it ended up.
function line(session: SessionSummary) {
  if (session.status === "waiting") return session.waitingFor || session.progress || session.summary
  return session.status ? session.progress || session.summary : session.error || session.summary
}

const PR_STATES = {
  open: { label: "Open", className: "text-[var(--git-added)]" },
  draft: { label: "Draft", className: "text-[var(--text-tertiary)]" },
  merged: { label: "Merged", className: "text-[var(--git-merged)]" },
  closed: { label: "Closed", className: "text-[var(--git-deleted)]" },
} as const

// 16px status glyphs on one grid: a ring of 8 dots (radius 6) or a 1.5px circle (radius 6.25), with a pie inside.
const DOTS = Array.from({ length: 8 }, (_, i) => ({ cx: 8 + 6 * Math.cos(Math.PI * i / 4), cy: 8 + 6 * Math.sin(Math.PI * i / 4), phase: ((i + 7) % 8) / 8 }))

// A pie of `ratio` of a full turn, clockwise from 12 o'clock.
function pie(ratio: number) {
  const angle = 2 * Math.PI * ratio
  return `M8 8L8 4.75A3.25 3.25 0 ${ratio > 0.5 ? 1 : 0} 1 ${(8 + 3.25 * Math.sin(angle)).toFixed(3)} ${(8 - 3.25 * Math.cos(angle)).toFixed(3)}Z`
}

// Infinite animations run on a clock shared by every glyph, so spinners stay in step and a row that moves to
// another section keeps turning instead of restarting.
function syncToClock(event: AnimationEvent<HTMLElement>) {
  for (const animation of event.currentTarget.getAnimations({ subtree: true })) {
    const timing = animation.effect?.getTiming()
    if (timing?.iterations === Infinity && typeof timing.duration === "number" && timing.duration > 0)
      animation.startTime = -(performance.timeOrigin % timing.duration)
  }
}

function StatusGlyph({ group, label, spin }: { group: Group; label: string; spin: boolean }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", role: "img", "aria-label": label } as const
  if (group === "working") return <span role="img" aria-label={label} onAnimationStart={syncToClock} className="relative flex size-4 shrink-0 text-[var(--text-tertiary)]">
    {/* The arc spins over the dot ring; the dots in its 160 degree gap fade in turn behind it. */}
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {DOTS.map(({ cx, cy, phase }, i) => <circle key={i} cx={cx.toFixed(3)} cy={cy.toFixed(3)} r="1" fill="currentColor" opacity={phase * 360 > 200 ? 0.5 : 0} className={spin ? "noa-thread-dot" : undefined} style={spin ? { animationDelay: `${(phase - 1) * 2}s` } : undefined} />)}
    </svg>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className={`absolute inset-0 ${spin ? "noa-thread-spin" : ""}`}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" pathLength="360" strokeDasharray="200 160" strokeDashoffset="-45" />
    </svg>
  </span>
  if (group === "resolved") return <span role="img" aria-label={label} className="flex shrink-0 text-[var(--text-tertiary)]"><CheckCircle2 size={16} /></span>
  if (group === "recent") return <svg {...common} className="shrink-0 text-[var(--text-tertiary)]">
    {DOTS.map(({ cx, cy }, i) => <circle key={i} cx={cx.toFixed(3)} cy={cy.toFixed(3)} r="1" fill="currentColor" />)}
  </svg>
  return <svg {...common} className={`shrink-0 ${group === "review" ? "text-[var(--git-added)]" : "text-amber-500"}`}>
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d={pie(group === "review" ? 0.75 : 0.5)} fill="currentColor" />
  </svg>
}

function PullRequestGlyph({ state }: { state?: keyof typeof PR_STATES }) {
  const tone = state ? PR_STATES[state] : undefined
  return <svg width="14" height="14" viewBox="0 0 16 16" role="img" aria-label={tone ? `Pull request, ${tone.label.toLowerCase()}` : "Pull request"} className={`shrink-0 ${tone?.className ?? "text-[var(--text-tertiary)]"}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="4" cy="3.5" r="1.75" /><circle cx="4" cy="12.5" r="1.75" /><circle cx="12" cy="12.5" r="1.75" />
    <path d="M4 5.25v5.5M12 10.75V6a2 2 0 0 0-2-2H7.5M9 2.5 7.5 4 9 5.5" />
  </svg>
}

function reminderLabel(at: number) {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5)
  return days === 0 ? time : days === 1 ? `Tomorrow ${time}` : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
}

function reminderTimes(now = new Date()) {
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  return [
    { label: "In 1 hour", at: now.getTime() + 36e5 },
    { label: "In 3 hours", at: now.getTime() + 3 * 36e5 },
    { label: "Tomorrow at 9:00", at: tomorrow.getTime() },
  ]
}

// The project's tasks grouped by what they need from you, newest first within each group.
export function ThreadsPanel({ sessions, activeId, onSelect, onRemind, onResolve }: {
  sessions: SessionSummary[]
  activeId?: string
  onSelect: (id: string) => void
  // Both absent when the project has no coordinator to keep thread state.
  onRemind?: (id: string, at: number | null) => void
  onResolve?: (id: string, resolved: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const [menu, setMenu] = useState<{ session: SessionSummary; anchor: PopupMenuAnchor; trigger: Element }>()
  const [collapsed, setCollapsed] = useState<Set<Group>>(() => new Set(["resolved"]))
  // A thread that was just resolved, from here, the task menu or the coordinator, stays in place for a moment with an
  // undo before it moves into the collapsed Resolved group.
  const [settling, setSettling] = useState<Set<string>>(() => new Set())
  // Whether each thread in the last list was resolved; only a thread seen open there counts as just resolved, so
  // switching projects or the first load does not flash every resolved thread.
  const wasResolved = useRef(new Map<string, boolean>())
  useEffect(() => {
    const fresh = sessions.filter(session => session.resolvedAt && wasResolved.current.get(session.id) === false).map(session => session.id)
    wasResolved.current = new Map(sessions.map(session => [session.id, !!session.resolvedAt]))
    if (!fresh.length) return
    setSettling(current => new Set([...current, ...fresh]))
    setTimeout(() => setSettling(current => new Set([...current].filter(id => !fresh.includes(id)))), 4000)
  }, [sessions])
  const groupFor = (session: SessionSummary) => groupOf(settling.has(session.id) && session.resolvedAt ? { ...session, resolvedAt: undefined } : session)
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const only = words.flatMap(word => word.startsWith("is:") && IS_FILTERS[word.slice(3)] ? [IS_FILTERS[word.slice(3)]] : [])
  const text = words.filter(word => !(word.startsWith("is:") && IS_FILTERS[word.slice(3)]))
  const threads = sessions.filter(session => !session.coordinator)
  const shown = threads
    .filter(session => text.every(word => `${session.title} ${line(session) ?? ""} ${session.pr ? `#${session.pr.number}` : ""}`.toLowerCase().includes(word)))
    .filter(session => !only.length || only.includes(groupFor(session)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const listRef = useRef<HTMLDivElement>(null)
  const layout = useRef(new Map<string, { top: number; look?: string }>())
  // When the list changes, rows and headers that moved slide from where they were, new ones fade in, and a row whose
  // status, line or pull request changed fades those parts in.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    // A hidden tab has no layout to compare against; start over when it is shown again instead of sliding every row.
    if (!list.getClientRects().length) return void layout.current.clear()
    const animate = layout.current.size > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches
    const origin = list.getBoundingClientRect().top - list.scrollTop
    const next = new Map<string, { top: number; look?: string }>()
    for (const element of list.querySelectorAll<HTMLElement>("[data-flip]")) {
      for (const running of element.getAnimations()) if (!(running instanceof CSSAnimation)) running.cancel()
      const now = { top: element.getBoundingClientRect().top - origin, look: element.dataset.look }
      const before = layout.current.get(element.dataset.flip!)
      next.set(element.dataset.flip!, now)
      if (!animate) continue
      if (!before) element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" })
      else if (Math.abs(before.top - now.top) > 0.5)
        element.animate([{ transform: `translateY(${before.top - now.top}px)` }, { transform: "none" }], { duration: 400, easing: "cubic-bezier(0.19, 1, 0.22, 1)" })
      if (before && before.look !== now.look)
        for (const part of element.querySelectorAll<HTMLElement>("[data-fade]")) part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" })
    }
    layout.current = next
  }, [sessions, query, collapsed, settling])
  const toggle = (id: Group) => setCollapsed(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return <div className="noa-threads-panel flex min-h-0 flex-1 flex-col font-ui text-chat-sm leading-5">
    <div className="px-3 pt-3 pb-1">
      <label className="flex h-[30px] items-center gap-[11px] rounded-lg bg-[var(--fill-hover)] px-[9px] text-body text-[var(--text-tertiary)]">
        <Search size={14} />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Escape" && query && !event.nativeEvent.isComposing) { event.stopPropagation(); setQuery("") } }}
          placeholder="Search, or filter with is:"
          aria-label="Search threads"
          className="min-w-0 flex-1 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </label>
    </div>
    <div ref={listRef} className="scrollbar-on-scroll noa-scroll-fade [--edge-fade-distance:24px] min-h-0 flex-1 overflow-y-auto ps-3 pe-1 pt-3 pb-5 [scrollbar-gutter:stable]">
      {!shown.length && <p className="m-0 px-2 py-1 text-[var(--text-tertiary)]">{threads.length ? "No matching threads" : "No threads yet"}</p>}
      {GROUPS.map(({ id, title }) => {
        const items = shown.filter(session => groupFor(session) === id)
        if (!items.length) return null
        const open = !collapsed.has(id)
        return <section key={id} className="mb-4">
          <button type="button" data-flip={`group:${id}`} aria-expanded={open} onClick={() => toggle(id)} className="mb-1.5 flex h-6 items-center gap-1 rounded-md ps-[9px] pe-2 text-chat-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            {title} · {items.length}
            <ChevronDown size={14} className={open ? "" : "-rotate-90"} />
          </button>
          {open && <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {/* Hover and selection cover the whole thread, PR line included; the PR line's padding keeps the rail's end clear of the next row. */}
            {items.map(session => <li key={session.id} data-flip={session.id} data-look={[groupFor(session), line(session), session.pr?.state, session.remindAt, session.resolvedAt].join("\0")} className={`group relative rounded-lg hover:bg-[var(--fill-hover)] ${session.id === activeId ? "bg-[var(--fill-hover)]" : ""} ${session.pr ? "pb-1" : ""}`}>
              <button
                type="button"
                aria-current={session.id === activeId ? "page" : undefined}
                onClick={() => onSelect(session.id)}
                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left"
              >
                <span data-fade className="flex h-5 items-center"><StatusGlyph group={groupOf(session)} label={statusLabel(session)} spin={session.status === "running"} /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{session.title}</span>
                    <span className={`shrink-0 text-caption tabular-nums text-[var(--text-tertiary)] ${onRemind ? "group-hover:invisible group-focus-within:invisible" : ""}`}>{ageLabel(session.updatedAt)}</span>
                  </span>
                  {line(session) && <span data-fade className="truncate text-caption leading-4 text-[var(--text-secondary)]">{line(session)}</span>}
                  {session.remindAt && <span data-fade className="truncate text-caption leading-4 text-[var(--text-tertiary)]">Reminder · {reminderLabel(session.remindAt)}</span>}
                </span>
              </button>
              {settling.has(session.id) && session.resolvedAt && <div data-fade className="-mt-1.5 flex h-5 items-center gap-1 ps-[33px] pb-1 text-caption text-[var(--text-tertiary)]">
                Resolved{onResolve && <> · <button type="button" onClick={() => onResolve(session.id, false)} className="rounded-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline">Undo</button></>}
              </div>}
              {onRemind && <button
                type="button"
                aria-label={`Thread actions for ${session.title}`}
                aria-haspopup="menu"
                onClick={event => { const trigger = event.currentTarget; setMenu(current => current?.trigger === trigger ? undefined : { session, anchor: anchorBelow(trigger), trigger }) }}
                className="absolute end-1.5 top-[7px] flex size-[22px] items-center justify-center rounded-md text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
              ><MoreHorizontal size={14} /></button>}
              {/* Rail from under the status glyph, turning into the PR row. */}
              {session.pr && <span aria-hidden className="pointer-events-none absolute start-[15.5px] top-[30px] bottom-[14px] w-[16px] rounded-es-lg border-s border-b border-[var(--text-tertiary)] opacity-50" />}
              {session.pr && <div data-fade className="mt-0.5 flex h-5 items-center ps-[33px] text-chat-sm">
                <a href={session.pr.url} target="_blank" rel="noreferrer" title={session.pr.repository ? `${session.pr.repository}#${session.pr.number}` : undefined} className="flex items-center gap-1.5 rounded-sm text-[var(--text-primary)] hover:underline">
                  <PullRequestGlyph state={session.pr.state} />#{session.pr.number}
                </a>
              </div>}
            </li>)}
          </ul>}
        </section>
      })}
    </div>
    {menu && onRemind && <PopupMenu
      anchor={menu.anchor}
      trigger={menu.trigger}
      label="Thread actions"
      onClose={() => setMenu(undefined)}
      entries={[
        ...(onResolve && !menu.session.status ? [
          { label: menu.session.resolvedAt ? "Reopen" : "Resolve", onSelect: () => onResolve(menu.session.id, !menu.session.resolvedAt) },
          { kind: "separator" as const },
        ] : []),
        { kind: "heading", label: "Remind me" },
        ...reminderTimes().map(({ label, at }) => ({ label, onSelect: () => onRemind(menu.session.id, at) })),
        ...(menu.session.remindAt ? [{ kind: "separator" as const }, { label: "Clear reminder", onSelect: () => onRemind(menu.session.id, null) }] : []),
      ]}
    />}
  </div>
}
