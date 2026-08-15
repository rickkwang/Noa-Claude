// @ts-nocheck
import {
  formatAutoModeClassifierUsage,
  formatTotalCost,
} from '../../cost-tracker.js'
import { currentLimits } from '../../services/claudeAiLimits.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

export const call: LocalCommandCall = async () => {
  if (isClaudeAISubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your Noa Claude usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your Noa Claude usage'
    }

    if (process.env.USER_TYPE === 'ant') {
      value += `\n\n[ANT-ONLY] Showing cost anyway:\n ${formatTotalCost()}`
    }
    // Counts and latencies, not spend — safe to show a subscriber, and this
    // is the only surface that reports them.
    const autoMode = formatAutoModeClassifierUsage()
    if (autoMode) value += `\n${autoMode}`
    return { type: 'text', value }
  }
  return { type: 'text', value: formatTotalCost() }
}
