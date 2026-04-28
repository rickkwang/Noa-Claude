import type { TerminalQuerier } from '../ink/terminal-querier.js'
import { oscColor } from '../ink/terminal-querier.js'
import {
  setCachedSystemTheme,
  themeFromOscColor,
  type SystemTheme,
} from './systemTheme.js'

const BACKGROUND_COLOR_OSC = 11
const POLL_INTERVAL_MS = 2000

/**
 * Poll the terminal background color and report dark/light changes.
 *
 * Terminal theme changes do not have a portable push notification, so this
 * uses OSC 11 queries. TerminalQuerier's DA1 sentinel resolves unsupported
 * OSC queries without a timer, and the in-flight guard prevents piling up
 * queries if a terminal never answers.
 */
export function watchSystemTheme(
  querier: TerminalQuerier,
  onChange: (theme: SystemTheme) => void,
): () => void {
  let stopped = false
  let inFlight = false
  let lastTheme: SystemTheme | undefined

  const poll = async () => {
    if (stopped || inFlight) return
    inFlight = true

    try {
      const responsePromise = querier.send(oscColor(BACKGROUND_COLOR_OSC))
      const flushPromise = querier.flush()
      const response = await responsePromise
      await flushPromise

      if (stopped || response === undefined) return

      const nextTheme = themeFromOscColor(response.data)
      if (nextTheme === undefined || nextTheme === lastTheme) return

      lastTheme = nextTheme
      setCachedSystemTheme(nextTheme)
      onChange(nextTheme)
    } finally {
      inFlight = false
    }
  }

  void poll()
  const interval = setInterval(() => {
    void poll()
  }, POLL_INTERVAL_MS)

  return () => {
    stopped = true
    clearInterval(interval)
  }
}
