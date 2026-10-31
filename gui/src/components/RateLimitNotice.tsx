import type { RateLimitInfo } from "../agent/protocol"
import { Gauge, X } from "../lib/icons"

const WINDOWS: Record<NonNullable<RateLimitInfo["rateLimitType"]>, string> = {
  five_hour: "5-hour",
  seven_day: "weekly",
  seven_day_opus: "weekly Opus",
  seven_day_sonnet: "weekly Sonnet",
  overage: "extra usage",
}

// Identifies one limit state, so a dismissed notice stays hidden until the state changes.
export function rateLimitKey(info: RateLimitInfo) {
  return `${info.status}:${info.rateLimitType}:${info.resetsAt}`
}

// `inline` fills the environment strip above the composer instead of standing alone above it.
export function RateLimitNotice({ info, onDismiss, inline = false }: { info: RateLimitInfo; onDismiss: () => void; inline?: boolean }) {
  const window = info.rateLimitType ? `${WINDOWS[info.rateLimitType]} usage limit` : "usage limit"
  const rejected = info.status === "rejected"
  const used = !rejected && info.utilization !== undefined ? ` (${Math.round(info.utilization * 100)}% used)` : ""
  const reset = info.resetsAt ? `Resets ${new Date(info.resetsAt * 1000).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""
  const frame = inline
    ? "flex h-7 min-w-0 flex-1 items-center gap-2 px-2"
    : "flex min-h-9 items-center gap-2 rounded-xl bg-[var(--fill-hover)] py-1 pl-3 pr-1.5"
  return (
    <div role="status" className={`${frame} text-caption`}>
      <Gauge size={14} className={`shrink-0 ${rejected ? "text-[#C24444]" : "text-[var(--text-secondary)]"}`} aria-hidden="true" />
      <span className={`min-w-0 truncate ${rejected ? "text-[#C24444]" : "text-[var(--text-primary)]"}`}>
        {rejected ? `You've hit your ${window}` : `Approaching your ${window}${used}`}
      </span>
      {reset && <span className="min-w-0 truncate text-[var(--text-tertiary)]">{reset}</span>}
      <button type="button" aria-label="Dismiss usage notice" onClick={onDismiss} className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
        <X size={12} />
      </button>
    </div>
  )
}
