import type { RateLimitInfo } from "../agent/protocol"
import { AlertTriangle } from "../lib/icons"

const WINDOWS: Record<NonNullable<RateLimitInfo["rateLimitType"]>, string> = {
  five_hour: "5-hour",
  seven_day: "weekly",
  seven_day_opus: "weekly Opus",
  seven_day_sonnet: "weekly Sonnet",
  overage: "extra usage",
}

export function rateLimitText(info: RateLimitInfo): string {
  const window = info.rateLimitType ? `${WINDOWS[info.rateLimitType]} usage limit` : "usage limit"
  const reset = info.resetsAt ? ` Resets ${new Date(info.resetsAt * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : ""
  if (info.status === "rejected") return `You've hit your ${window}.${reset}`
  const used = info.utilization !== undefined ? ` (${Math.round(info.utilization * 100)}% used)` : ""
  return `Approaching your ${window}${used}.${reset}`
}

export function RateLimitNotice({ info }: { info: RateLimitInfo }) {
  return (
    <p role="status" className={`m-0 flex items-center gap-1.5 px-1 text-caption ${info.status === "rejected" ? "text-[#C24444]" : "text-[var(--sidebar-text-muted)]"}`}>
      <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
      {rateLimitText(info)}
    </p>
  )
}
