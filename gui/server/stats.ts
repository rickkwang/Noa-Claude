// Usage stats for the new-task page, computed by the same aggregation the CLI's /stats uses.
import { resolve } from "node:path"

type StatsDateRange = "7d" | "30d" | "all"
const RANGES: StatsDateRange[] = ["7d", "30d", "all"]
const SRC = resolve(import.meta.dir, "../../src/utils")

type Usage = Record<string, number | undefined>
interface CliStats {
  totalSessions: number
  totalMessages: number
  activeDays: number
  longestSession: { duration: number } | null
  peakActivityHour: number | null
  dailyModelTokens: { date: string; tokensByModel: Record<string, number> }[]
  streaks: { currentStreak: number; longestStreak: number }
  dailyActivity: { date: string; messageCount: number }[]
  modelUsage: Record<string, Usage>
}

// Loaded by path at runtime so the GUI typecheck does not pull in the CLI's mostly unchecked sources.
// No extension: a source checkout resolves the .ts files, a packaged app the bundled .js ones.
async function cli() {
  const [stats, format, model] = await Promise.all([import(`${SRC}/stats`), import(`${SRC}/format`), import(`${SRC}/model/model`)])
  return {
    aggregate: stats.aggregateClaudeCodeStatsForRange as (range: StatsDateRange) => Promise<CliStats>,
    formatNumber: format.formatNumber as (n: number) => string,
    renderModelName: model.renderModelName as (name: string) => string,
  }
}

export interface StatsSummary {
  range: StatsDateRange
  days: { date: string; messages: number }[]
  // The heatmap always draws all-time activity, whatever the range.
  heatmapDays: { date: string; messages: number }[]
  // The summary line under the title always reads all-time figures, whatever the range.
  allTimeMessages: string
  totalSessions: string
  totalTokens: string
  favoriteModel: string | null
  currentStreak: number
  longestStreak: number
  activeDays: number
  rangeDays: number
  longestSessionMs: number | null
  totalMessages: string
  peakActivityHour: number | null
  usage: ModelUsage
  // Model rows by total tokens; names are display names, same-name models merged.
  models: { name: string; tokens: number; usage: ModelUsage }[]
  chartDays: { date: string; tokensByModel: Record<string, number> }[]
}

export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// Same four token classes the CLI's Stats overview totals.
function tokens(usage: Usage): number {
  return (usage.inputTokens || 0) + (usage.outputTokens || 0) + (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0)
}

const RANGE_LENGTH: Record<StatsDateRange, number | null> = { "7d": 7, "30d": 30, all: null }

// Fixed 7/30 for the short ranges; all-time spans first to last active day, never fewer than the active days.
function rangeDays(range: StatsDateRange, stats: CliStats): number {
  const fixed = RANGE_LENGTH[range]
  if (fixed !== null) return fixed
  const times = stats.dailyActivity.map(day => Date.parse(`${day.date}T00:00:00Z`)).filter(Number.isFinite)
  const span = times.length ? (Math.max(...times) - Math.min(...times)) / 86_400_000 + 1 : 0
  return Math.max(span, stats.activeDays)
}

function addUsage(into: ModelUsage, usage: Usage) {
  into.input += usage.inputTokens || 0
  into.output += usage.outputTokens || 0
  into.cacheRead += usage.cacheReadInputTokens || 0
  into.cacheWrite += usage.cacheCreationInputTokens || 0
}

export async function statsSummary(raw: string | null): Promise<StatsSummary> {
  const range = RANGES.includes(raw as StatsDateRange) ? (raw as StatsDateRange) : "all"
  const { aggregate, formatNumber, renderModelName } = await cli()
  // The title summary and current streak are always all-time, matching the CLI.
  const [stats, allTime] = await Promise.all([
    aggregate(range),
    range === "all" ? null : aggregate("all"),
  ])
  const models = Object.entries(stats.modelUsage).sort(([, a], [, b]) => tokens(b) - tokens(a))
  const usage: ModelUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const byName = new Map<string, { name: string; tokens: number; usage: ModelUsage }>()
  for (const [model, modelUsage] of models) {
    addUsage(usage, modelUsage)
    const name = renderModelName(model)
    const row = byName.get(name) ?? { name, tokens: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    row.tokens += tokens(modelUsage)
    addUsage(row.usage, modelUsage)
    byName.set(name, row)
  }
  const chartDays = stats.dailyModelTokens.map(day => {
    const tokensByModel: Record<string, number> = {}
    for (const [model, count] of Object.entries(day.tokensByModel)) {
      const name = renderModelName(model)
      tokensByModel[name] = (tokensByModel[name] ?? 0) + count
    }
    return { date: day.date, tokensByModel }
  })
  return {
    range,
    days: stats.dailyActivity.map(day => ({ date: day.date, messages: day.messageCount })),
    heatmapDays: (allTime ?? stats).dailyActivity.map(day => ({ date: day.date, messages: day.messageCount })),
    allTimeMessages: formatNumber((allTime ?? stats).totalMessages),
    totalSessions: formatNumber(stats.totalSessions),
    totalTokens: formatNumber(models.reduce((sum, [, usage]) => sum + tokens(usage), 0)),
    favoriteModel: models[0] ? renderModelName(models[0][0]) : null,
    currentStreak: (allTime ?? stats).streaks.currentStreak,
    longestStreak: stats.streaks.longestStreak,
    activeDays: stats.activeDays,
    rangeDays: rangeDays(range, stats),
    longestSessionMs: stats.longestSession?.duration ?? null,
    totalMessages: formatNumber(stats.totalMessages),
    peakActivityHour: stats.peakActivityHour,
    usage,
    models: [...byName.values()].sort((a, b) => b.tokens - a.tokens),
    chartDays,
  }
}
