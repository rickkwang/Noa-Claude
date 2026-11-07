import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { fetchStats, type StatsRange, type StatsSummary } from "../api"
import { ChevronDown } from "../lib/icons"

const RANGES: { id: StatsRange; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "30d", label: "30 days" },
  { id: "7d", label: "7 days" },
]
const CELL = 11
const GAP = 3
// Accent share for intensity levels 1-4; level 0 is a neutral empty cell.
const LEVELS = [0, 30, 50, 72, 100]

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch { return fallback }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
// One formatter for every cell: toLocaleDateString builds a new one per call, which is slow across a year of cells.
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

// Mirrors src/utils/heatmap.ts: weeks start on Sunday, end at today, and
// non-zero days are bucketed by the 25th/50th/75th percentile of message counts.
function heatmap(days: StatsSummary["days"], weeks: number) {
  const counts = new Map(days.map(day => [day.date, day.messages]))
  const sorted = days.map(day => day.messages).filter(n => n > 0).sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.floor(sorted.length * q)]!
  const level = (n: number) => !n || !sorted.length ? 0 : n >= at(0.75) ? 4 : n >= at(0.5) ? 3 : n >= at(0.25) ? 2 : 1
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay() - (weeks - 1) * 7)
  const cells: { key: string; level: number; future: boolean; title?: string }[] = []
  for (const date = new Date(start); cells.length < weeks * 7; date.setDate(date.getDate() + 1)) {
    const key = dateKey(date), messages = counts.get(key) ?? 0, future = date > today
    const title = future ? undefined : `${SHORT_DATE.format(date)}: ${messages} ${messages === 1 ? "message" : "messages"}`
    cells.push({ key, level: level(messages), future, title })
  }
  return cells
}

function Heatmap({ days }: { days: StatsSummary["days"] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [weeks, setWeeks] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    // Same 10-52 week bounds the CLI applies to the terminal width.
    const measure = () => setWeeks(Math.min(52, Math.max(10, Math.floor((element.clientWidth + GAP) / (CELL + GAP)))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const cells = useMemo(() => weeks ? heatmap(days, weeks) : [], [days, weeks])
  return (
    <div ref={ref} className="w-full overflow-hidden" aria-label="Daily message activity" role="img">
      <div className="grid grid-flow-col" style={{ gridTemplateRows: "repeat(7, auto)", gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, gap: GAP }}>
        {cells.map(cell => (
          <span
            key={cell.key}
            title={cell.title}
            className="aspect-square rounded-[3px]"
            style={{ background: cell.future ? "transparent" : cell.level ? `color-mix(in srgb, var(--accent-color) ${LEVELS[cell.level]}%, transparent)` : "color-mix(in srgb, var(--text-primary) 6%, transparent)" }}
          />
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="noa-stats-tile flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2">
      <span className="truncate text-[length:var(--text-micro)] text-[var(--text-tertiary)]">{label}</span>
      <span className="truncate text-[length:var(--text-chat-sm)] font-medium text-[var(--text-primary)]" title={value}>{value}</span>
    </div>
  )
}

export function StatsPanel() {
  const [range, setRange] = useState<StatsRange>(() => stored("noa-agent.statsRange", ["7d", "30d", "all"], "all"))
  const [open, setOpen] = useState(() => stored("noa-agent.statsCollapsed", ["true", "false"], "false") !== "true")
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetchStats(range).then(next => { if (live) { setStats(next); setFailed(false) } }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [range])

  const toggle = () => setOpen(value => { store("noa-agent.statsCollapsed", String(value)); return !value })
  const pick = (next: StatsRange) => { setRange(next); store("noa-agent.statsRange", next) }
  const loading = !stats || stats.range !== range
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`
  if (failed && !stats) return null

  return (
    <section className="flex w-full max-w-[600px] flex-col items-center text-left" aria-label="Usage stats">
      <button type="button" onClick={toggle} aria-expanded={open} className="noa-stats-toggle flex items-center gap-1.5 rounded-full px-3 py-1 text-[length:var(--text-caption)] text-[var(--text-tertiary)]">
        <span className={stats ? "" : "opacity-0"}>
          <span className="text-[var(--text-secondary)]">{stats?.allTimeMessages ?? "0"}</span> messages
          <span className="mx-1.5 opacity-60">·</span>
          <span className="text-[var(--text-secondary)]">{stats?.currentStreak ?? 0}-day</span> streak
        </span>
        <ChevronDown size={13} className="noa-stats-chevron" />
      </button>
      <div className="noa-stats-collapse w-full" data-open={open} inert={!open}>
        <div className="min-h-0 overflow-hidden">
          <div className={`noa-stats-card mt-3 flex flex-col gap-3 rounded-[var(--radius-panel)] p-4 transition-opacity ${loading ? "opacity-70" : ""}`} aria-busy={loading}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[length:var(--text-caption)] text-[var(--text-secondary)]">
                Activity <span className="text-[var(--text-tertiary)]">· {days(stats?.activeDays ?? 0)} active</span>
              </span>
              <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Stats range">
                {RANGES.map(item => (
                  <button key={item.id} type="button" role="radio" aria-checked={range === item.id} onClick={() => pick(item.id)} className="noa-stats-range-option rounded-md px-2 py-0.5 text-[length:var(--text-caption)]">{item.label}</button>
                ))}
              </div>
            </div>
            <Heatmap days={stats?.days ?? []} />
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Metric label="Sessions" value={stats?.totalSessions ?? "–"} />
              <Metric label="Tokens" value={stats?.totalTokens ?? "–"} />
              <Metric label="Longest streak" value={stats ? days(stats.longestStreak) : "–"} />
              <Metric label="Favorite model" value={stats?.favoriteModel ?? "–"} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
