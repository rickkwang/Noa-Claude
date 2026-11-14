import { createPortal } from "react-dom"
import { memo, useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { fetchStats, type StatsRange, type StatsSummary } from "../api"
import { ChevronDown } from "../lib/icons"

const RANGES: { id: StatsRange; label: string; long: string }[] = [
  { id: "all", label: "All time", long: "All time" },
  { id: "30d", label: "30 days", long: "Last 30 days" },
  { id: "7d", label: "7 days", long: "Last 7 days" },
]
type View = "overview" | "models"
const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models" },
]
const GAP = 2
// The grid shows 26 weeks, widening to 44 when older activity exists.
const WEEKS = 26
const MAX_WEEKS = 44
const DAY_MS = 86_400_000
// Accent share for intensity levels 1-4; level 0 is a neutral empty cell.
const LEVELS = [0, 30, 50, 72, 100]
const MODEL_ROWS = 6

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
// Day keys are plain calendar dates; all date arithmetic runs in UTC so DST never shifts a cell.
function keyMs(key: string): number {
  const [year, month, day] = key.split("-").map(Number)
  return Date.UTC(year!, month! - 1, day)
}
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
// One formatter for every cell: toLocaleDateString builds a new one per call, which is slow across a year of cells.
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const shortDate = (key: string) => SHORT_DATE.format(keyMs(key))
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const compact = (n: number) => COMPACT.format(n).toLowerCase()
const percent = (share: number) => `${(share * 100).toFixed(1)}%`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

// Busiest day by message count; the first one wins a tie.
function busiest(days: StatsSummary["days"]) {
  let best: StatsSummary["days"][number] | null = null
  for (const day of days) if (day.messages > 0 && (!best || day.messages > best.messages)) best = day
  return best
}

function cellBackground(level: number): string {
  return level ? `color-mix(in srgb, var(--accent-color) ${LEVELS[level]}%, transparent)` : "color-mix(in srgb, var(--text-primary) 6%, transparent)"
}

// Weeks run Sunday to Saturday and end with the current week; non-zero days are
// bucketed by the 25th/50th/75th percentile of message counts.
function heatmap(days: StatsSummary["days"], weeks: number) {
  const counts = new Map(days.map(day => [day.date, day.messages]))
  const sorted = days.map(day => day.messages).filter(n => n > 0).sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.floor(sorted.length * q)]!
  const level = (n: number) => !n || !sorted.length ? 0 : n >= at(0.75) ? 4 : n >= at(0.5) ? 3 : n >= at(0.25) ? 2 : 1
  const today = keyMs(dateKey(new Date()))
  const start = today - new Date(today).getUTCDay() * DAY_MS - (weeks - 1) * 7 * DAY_MS
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const ms = start + i * DAY_MS, key = keyOf(ms), messages = counts.get(key) ?? 0
    return { key, level: level(messages), future: ms > today, tip: `${SHORT_DATE.format(ms)} — ${messages}` }
  })
}
function heatmapWeeks(days: StatsSummary["days"]): number {
  const today = keyMs(dateKey(new Date()))
  const start = keyOf(today - new Date(today).getUTCDay() * DAY_MS - (WEEKS - 1) * 7 * DAY_MS)
  return days.some(day => day.messages > 0 && day.date < start) ? MAX_WEEKS : WEEKS
}

// Memoized so collapsing the panel or switching to a cached range does not rebuild a year of cells.
const Heatmap = memo(function Heatmap({ days, summary }: { days: StatsSummary["days"]; summary: string }) {
  const weeks = useMemo(() => heatmapWeeks(days), [days])
  const cells = useMemo(() => heatmap(days, weeks), [days, weeks])
  // The tooltip mounts on the first hover; touch pointers never open it.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const hover = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tip]")
    if (event.pointerType === "touch" || !target) return setTip(null)
    const rect = target.getBoundingClientRect()
    const x = rect.left + rect.width / 2, text = target.dataset.tip!
    // Same cell as before: keep the state object so moving within a cell does not re-render the grid.
    setTip(current => current && current.text === text && current.x === x && current.y === rect.top ? current : { text, x, y: rect.top })
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="w-full" aria-label={summary} role="img" onPointerMove={hover} onPointerLeave={() => setTip(null)}>
        <div className="grid grid-flow-col" style={{ gridTemplateRows: "repeat(7, auto)", gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, gap: GAP }}>
          {cells.map(cell => (
            <span
              key={cell.key}
              data-tip={cell.future ? undefined : cell.tip}
              className={`aspect-square rounded-[2px] ${cell.future ? "" : "transition-[filter] hover:brightness-90"}`}
              style={{ background: cell.future ? "transparent" : cellBackground(cell.level) }}
            />
          ))}
        </div>
      </div>
      {tip && createPortal(
        // Portaled to body: an ancestor's transform would otherwise become the containing block of this fixed element.
        <span className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-[var(--text-primary)] px-2 py-1 text-[length:var(--text-micro)] text-[var(--bg-primary)]" style={{ left: tip.x, top: tip.y - 6 }}>{tip.text}</span>,
        document.body,
      )}
      <div className="flex items-center justify-end gap-1 text-[length:var(--text-micro)] leading-none text-[var(--text-tertiary)]" aria-hidden="true">
        Less
        <span className="flex gap-0.5">
          {LEVELS.map((_, level) => <span key={level} className="size-2 rounded-[2px]" style={{ background: cellBackground(level) }} />)}
        </span>
        More
      </div>
    </div>
  )
})

// Token and session comparisons: one random pick per panel mount.
const BOOKS: [string, number][] = [
  ["The Little Prince", 22e3], ["The Old Man and the Sea", 35e3], ["A Christmas Carol", 37e3], ["Animal Farm", 39e3],
  ["Fahrenheit 451", 6e4], ["The Great Gatsby", 62e3], ["Slaughterhouse-Five", 64e3], ["Brave New World", 83e3],
  ["The Catcher in the Rye", 95e3], ["Harry Potter and the Philosopher’s Stone", 103e3], ["The Hobbit", 123e3], ["1984", 123e3],
  ["To Kill a Mockingbird", 13e4], ["Pride and Prejudice", 156e3], ["Dune", 244e3], ["Moby-Dick", 268e3],
  ["Crime and Punishment", 274e3], ["A Game of Thrones", 381e3], ["Anna Karenina", 468e3], ["Don Quixote", 52e4],
  ["The Lord of the Rings", 576e3], ["The Count of Monte Cristo", 603e3], ["Les Misérables", 689e3], ["War and Peace", 73e4],
]
const SESSION_COMPARISONS: [string, number][] = [
  ["a TED talk", 18], ["an episode of The Office", 22], ["listening to Abbey Road", 47], ["a yoga class", 60],
  ["a World Cup soccer match", 90], ["a half marathon (average time)", 120], ["the movie Inception", 148],
  ["watching Titanic", 195], ["a transatlantic flight", 420], ["a full night of sleep", 480],
]
function funFacts(stats: StatsSummary): string[] {
  const facts: string[] = []
  const tokens = stats.usage.input + stats.usage.output
  for (const [book, size] of BOOKS) {
    const times = Math.floor(tokens / size)
    if (times >= 1) facts.push(times >= 2 ? `Your input and output are ~${times}× the tokens in ${book}.` : `Your input and output are about as many tokens as ${book}.`)
  }
  if (stats.longestSessionMs !== null) {
    for (const [what, minutes] of SESSION_COMPARISONS) {
      const times = Math.floor(stats.longestSessionMs / 60_000 / minutes)
      if (times >= 2) facts.push(`Your longest session is ~${times}× longer than ${what}.`)
    }
  }
  return facts
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="noa-stats-tile flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2">
      <span className="truncate text-[length:var(--text-micro)] leading-none text-[var(--text-tertiary)]">{label}</span>
      <span className="truncate text-[length:var(--text-body)] font-medium leading-none text-[var(--text-primary)]" title={value}>{value}</span>
    </div>
  )
}

const modelColor = (index: number) => `color-mix(in srgb, var(--accent-color) ${Math.max(30, 100 - index * 14)}%, transparent)`

// Round tick values up to 4-6 steps at 1/2/5/10/20/50 x a power of ten.
function ticks(max: number): number[] {
  if (max <= 0) return []
  const base = 10 ** Math.floor(Math.log10(max / 6))
  const best = [1, 2, 5, 10, 20, 50].map(m => ({ step: Math.max(1, m * base), steps: Math.ceil(max / Math.max(1, m * base)) }))
    .filter(c => c.steps <= 6)
    .reduce((a, c) => c.step * c.steps < a.step * a.steps || (c.step * c.steps === a.step * a.steps && Math.abs(c.steps - 4) < Math.abs(a.steps - 4)) ? c : a)
  return Array.from({ length: best.steps + 1 }, (_, i) => i * best.step)
}

function DailyTokenChart({ stats }: { stats: StatsSummary }) {
  const keys = shownModels(stats).models.map(model => model.name)
  const days = stats.chartDays.map(day => {
    const segments = keys.flatMap((name, i) => day.tokensByModel[name] ? [{ name, tokens: day.tokensByModel[name]!, color: modelColor(i) }] : [])
    return { date: day.date, segments, total: segments.reduce((sum, s) => sum + s.tokens, 0) }
  })
  const axis = ticks(Math.max(0, ...days.map(day => day.total)))
  const top = axis.at(-1) ?? 1
  if (!days.length) return null
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[length:var(--text-caption)] text-[var(--text-primary)]">Tokens per day</span>
      <div className="flex gap-2">
        <div className="flex flex-col-reverse items-end justify-between text-[length:var(--text-micro)] leading-none text-[var(--text-tertiary)]" aria-hidden="true">
          {axis.map(tick => <span key={tick}>{compact(tick)}</span>)}
        </div>
        <div className="flex h-24 min-w-0 flex-1 items-end border-b border-[var(--border-default)]" role="img" aria-label="Daily tokens by model">
          {days.map(day => (
            <div key={day.date} title={`${shortDate(day.date)} — ${day.segments.map(s => `${s.name}: ${compact(s.tokens)}`).join(", ")}`} className="group flex h-full min-w-0 flex-1 flex-col-reverse items-center">
              {day.segments.map(s => <div key={s.name} className="w-[72%] shrink-0 group-hover:brightness-90" style={{ height: `${s.tokens / top * 100}%`, background: s.color }} />)}
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between pl-8 text-[length:var(--text-micro)] text-[var(--text-tertiary)]" aria-hidden="true">
        <span>{shortDate(days[0]!.date)}</span>
        <span>{shortDate(days.at(-1)!.date)}</span>
      </div>
    </div>
  )
}

// Models under 0.05% of all tokens are left out of the list, the chart and the report; shares still count them.
const MIN_MODEL_SHARE = 5e-4
function shownModels(stats: StatsSummary) {
  const total = stats.models.reduce((sum, model) => sum + model.tokens, 0)
  return { total, models: stats.models.filter(model => model.tokens >= total * MIN_MODEL_SHARE) }
}

function ModelsView({ stats, rangeLabel }: { stats: StatsSummary; rangeLabel: string }) {
  const [all, setAll] = useState(false)
  const { total, models } = shownModels(stats)
  const rows = all ? models : models.slice(0, MODEL_ROWS)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <span className="truncate text-[length:var(--text-micro)] text-[var(--text-tertiary)]">Share of tokens · {rangeLabel}</span>
        {rows.map((model, i) => (
          <div key={model.name} className="flex flex-col gap-1 text-[length:var(--text-caption)]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: modelColor(i) }} aria-hidden="true" />
                <span className="truncate">{model.name}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5 text-[var(--text-tertiary)]">
                {compact(model.tokens)} tokens <span className="text-[var(--text-primary)]">{percent(total ? model.tokens / total : 0)}</span>
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]" role="progressbar" aria-valuenow={Math.round((total ? model.tokens / total : 0) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={model.name}>
              <div className="h-full rounded-full" style={{ width: `${total ? model.tokens / total * 100 : 0}%`, background: modelColor(i) }} />
            </div>
            <span className="text-[length:var(--text-micro)] text-[var(--text-tertiary)]">
              {compact(model.usage.input)} in · {compact(model.usage.output)} out · {compact(model.usage.cacheRead)} cache read · {compact(model.usage.cacheWrite)} cache write
            </span>
          </div>
        ))}
        {!models.length && <span className="text-[length:var(--text-caption)] text-[var(--text-tertiary)]">No model usage in this range</span>}
        {models.length > MODEL_ROWS && (
          <button type="button" onClick={() => setAll(value => !value)} aria-expanded={all} className="self-start text-[length:var(--text-caption)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            {all ? "Show less" : `Show ${models.length - MODEL_ROWS} more`}
          </button>
        )}
      </div>
      <DailyTokenChart stats={stats} />
    </div>
  )
}

// Per-range results for this app session, so switching back to a range paints at once
// while a background fetch refreshes it.
const cache = new Map<StatsRange, StatsSummary>()

// Radio-group keyboard model: arrows move and select, focus follows the checked option.
function radioKeys<T extends string>(items: readonly { id: T }[], current: T, pick: (id: T) => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = (items.findIndex(item => item.id === current) + step + items.length) % items.length
    pick(items[index]!.id)
    ;(event.currentTarget.children[index] as HTMLElement | undefined)?.focus()
  }
}

export function StatsPanel() {
  const [range, setRange] = useState<StatsRange>(() => stored("noa-agent.statsRange", ["7d", "30d", "all"], "all"))
  const [view, setView] = useState<View>("overview")
  const [open, setOpen] = useState(() => stored("noa-agent.statsCollapsed", ["true", "false"], "false") !== "true")
  const [stats, setStats] = useState<StatsSummary | null>(() => cache.get(range) ?? null)
  const [failed, setFailed] = useState(false)
  const [pickIndex] = useState(Math.random)

  useEffect(() => {
    let live = true
    const cached = cache.get(range)
    if (cached) setStats(cached)
    fetchStats(range).then(next => { cache.set(range, next); if (live) { setStats(next); setFailed(false) } }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [range])

  const toggle = () => setOpen(value => { store("noa-agent.statsCollapsed", String(value)); return !value })
  const pick = (next: StatsRange) => { setRange(next); store("noa-agent.statsRange", next) }
  const loading = !stats || stats.range !== range
  const rangeLabel = RANGES.find(item => item.id === range)!.long
  // The heatmap and its caption are all-time in every range, so the grid never changes shape.
  const heat = stats?.heatmapDays ?? []
  const top = useMemo(() => busiest(heat), [heat])
  const topLabel = top ? shortDate(top.date) : null
  const heatActive = useMemo(() => heat.filter(day => day.messages > 0).length, [heat])
  const summary = `Daily message activity: ${plural(heatActive, "active day")}${topLabel ? `, most active on ${topLabel}` : ""}`
  const fact = useMemo(() => {
    const facts = stats ? funFacts(stats) : []
    return facts.length ? facts[Math.floor(pickIndex * facts.length)] : null
  }, [stats, pickIndex])
  if (failed && !stats) return <span className="text-[length:var(--text-caption)] text-[var(--text-tertiary)]">Couldn’t load usage stats</span>

  return (
    <section className="flex w-full max-w-[560px] flex-col items-center text-left" aria-label="Usage stats">
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
          <div className={`noa-stats-card mt-2 flex flex-col gap-3 rounded-[var(--radius-panel)] p-2.5 transition-opacity ${loading ? "opacity-70" : ""}`} aria-busy={loading}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Stats view" onKeyDown={radioKeys(VIEWS, view, setView)}>
                {VIEWS.map(item => (
                  <button key={item.id} type="button" role="radio" aria-checked={view === item.id} tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)} className="noa-stats-range-option rounded-md px-2 py-0.5 text-[length:var(--text-caption)]">{item.label}</button>
                ))}
              </div>
              <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Stats range" onKeyDown={radioKeys(RANGES, range, pick)}>
                {RANGES.map(item => (
                  <button key={item.id} type="button" role="radio" aria-checked={range === item.id} tabIndex={range === item.id ? 0 : -1} onClick={() => pick(item.id)} className="noa-stats-range-option rounded-md px-2 py-0.5 text-[length:var(--text-caption)]">{item.label}</button>
                ))}
              </div>
            </div>
            {stats && view === "models" ? <ModelsView stats={stats} rangeLabel={rangeLabel} /> : (
              <>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <Metric label="Sessions" value={stats?.totalSessions ?? "–"} />
                  <Metric label="Messages" value={stats?.totalMessages ?? "–"} />
                  <Metric label="Total tokens" value={stats?.totalTokens ?? "–"} />
                  <Metric label="Active days" value={stats ? `${stats.activeDays}${stats.rangeDays > 0 ? `/${stats.rangeDays}` : ""}` : "–"} />
                  <Metric label="Current streak" value={stats ? `${stats.currentStreak}d` : "–"} />
                  <Metric label="Longest streak" value={stats ? `${stats.longestStreak}d` : "–"} />
                  <Metric label="Peak hour" value={stats?.peakActivityHour != null ? String(stats.peakActivityHour) : "–"} />
                  <Metric label="Favorite model" value={stats?.favoriteModel ?? "–"} />
                </div>
                <Heatmap days={heat} summary={summary} />
                {fact && <span className="text-[length:var(--text-micro)] text-[var(--text-tertiary)]">{fact}</span>}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
