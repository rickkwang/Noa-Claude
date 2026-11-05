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
  streaks: { currentStreak: number; longestStreak: number }
  dailyActivity: { date: string; messageCount: number }[]
  modelUsage: Record<string, Usage>
}

// Loaded by path at runtime so the GUI typecheck does not pull in the CLI's mostly unchecked sources.
async function cli() {
  const [stats, format, model] = await Promise.all([import(`${SRC}/stats.ts`), import(`${SRC}/format.ts`), import(`${SRC}/model/model.ts`)])
  return {
    aggregate: stats.aggregateClaudeCodeStatsForRange as (range: StatsDateRange) => Promise<CliStats>,
    formatNumber: format.formatNumber as (n: number) => string,
    renderModelName: model.renderModelName as (name: string) => string,
  }
}

export interface StatsSummary {
  range: StatsDateRange
  days: { date: string; messages: number }[]
  // The summary line under the title always reads all-time figures, whatever the range.
  allTimeMessages: string
  totalSessions: string
  totalTokens: string
  favoriteModel: string | null
  currentStreak: number
  longestStreak: number
  activeDays: number
}

// Same four token classes the CLI's Stats overview totals.
function tokens(usage: Usage): number {
  return (usage.inputTokens || 0) + (usage.outputTokens || 0) + (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0)
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
  return {
    range,
    days: stats.dailyActivity.map(day => ({ date: day.date, messages: day.messageCount })),
    allTimeMessages: formatNumber((allTime ?? stats).totalMessages),
    totalSessions: formatNumber(stats.totalSessions),
    totalTokens: formatNumber(models.reduce((sum, [, usage]) => sum + tokens(usage), 0)),
    favoriteModel: models[0] ? renderModelName(models[0][0]) : null,
    currentStreak: (allTime ?? stats).streaks.currentStreak,
    longestStreak: stats.streaks.longestStreak,
    activeDays: stats.activeDays,
  }
}
