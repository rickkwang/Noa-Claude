import { should1hCacheTTL } from '../../services/api/claude.js'

export const SCHEDULE_WAKEUP_TOOL_NAME = 'ScheduleWakeup'

export const SCHEDULE_WAKEUP_DESCRIPTION =
  'Schedule when to resume work in /loop dynamic mode (always pass the `prompt` arg unless stopping). Call before ending the turn to keep the loop alive; call with `stop: true` to end the loop immediately.'

const INTRO = `Schedule when to resume work in /loop dynamic mode — the user invoked /loop without an interval, asking you to self-pace iterations of a specific task.

Do NOT schedule a short-interval wakeup to poll for background work you started — when harness-tracked work finishes, you are re-invoked automatically, so polling is wasted. Instead schedule a long fallback (1200s+) so the loop survives if the work hangs or never notifies. The exception is external work the harness cannot track (a CI run, a deploy, a remote queue) — there, pick a delay matched to how fast that state actually changes.

Pass the same /loop prompt back via \`prompt\` each turn so the next firing repeats the task. For a /loop with no prompt, pass \`/loop\` itself. To end the loop, call this tool with \`stop: true\` (omit every other field) — the loop ends immediately and no further wakeups fire.`

const DELAY_5M = `## Picking delaySeconds

This session's requests use the default 5-minute Anthropic prompt-cache TTL. Sleeping past 300 seconds means the next wake-up reads your full conversation context uncached — slower and more expensive. So the natural breakpoints:

- **Under 5 minutes (60s–270s)**: cache stays warm. Right for actively polling external state the harness can't notify you about — a CI run, a deploy, a remote queue.
- **5 minutes to 1 hour (300s–3600s)**: pay the cache miss. Right when there's no point checking sooner — waiting on something that takes minutes to change, genuinely idle, or as the long fallback heartbeat when something else is the primary wake signal.

**Don't pick 300s.** It's the worst-of-both: you pay the cache miss without amortizing it. If you're tempted to "wait 5 minutes," either drop to 270s (stay in cache) or commit to 1200s+ (one cache miss buys a much longer wait). Don't think in round-number minutes — think in cache windows.

For idle ticks with no specific signal to watch, default to **1200s–1800s** (20–30 min). The loop checks back, you don't burn cache 12× per hour for nothing, and the user can always interrupt if they need you sooner.

Think about what you're actually waiting for, not just "how long should I sleep." If you're polling a CI run that takes ~8 minutes, sleeping 60s burns the cache 8 times before it finishes — sleep ~270s twice instead.

The runtime clamps to [60, 3600], so you don't need to clamp yourself.`

const DELAY_1H = `## Picking delaySeconds

This session's requests use a 1-hour Anthropic prompt-cache TTL, so effectively every allowed delay (the runtime clamps to [60, 3600]) wakes up with your conversation context still cached. There is no cache cliff inside that range to pace around, and scheduling extra wakeups just to keep the cache warm is pure waste — never do that.

Match the delay to what you're actually waiting for:

- **Actively polling external state the harness can't notify you about** (a CI run, a deploy, a remote queue): pick the delay from how fast that state actually changes. A CI run that takes ~8 minutes deserves one ~480s check, not eight 60s ones.
- **The long fallback heartbeat** (something else — a Monitor, a task notification — is the primary wake signal): 1200s+, so quiet wakeups stay rare.
- **Idle ticks with no specific signal to watch**: default to **1200s–1800s** (20–30 min). The loop still checks back regularly, and the user can always interrupt if they need you sooner.

Don't think in cache windows — think about what you're actually waiting for.`

const REASON = `## The reason field

One short sentence on what you chose and why. It is shown back to the user. "watching CI run" beats "waiting." The user reads this to understand what you're doing without having to predict your cadence in advance — make it specific.`

export function buildScheduleWakeupPrompt(): string {
  const oneHour =
    should1hCacheTTL('repl_main_thread') && should1hCacheTTL('sdk')
  return `${INTRO}\n\n${oneHour ? DELAY_1H : DELAY_5M}\n\n${REASON}\n`
}
