// @ts-nocheck
import { useEffect, useRef } from 'react'
import {
  getTerminalFocusState,
  subscribeTerminalFocus,
} from '../ink/terminal-focus-state.js'
import { generateAwaySummary } from '../services/awaySummary.js'
import type { Message } from '../types/message.js'
import { useAppState } from '../state/AppState.js'
import { createAwaySummaryMessage } from '../utils/messages.js'

// Official Claude Code default (Cwq): recap fires after 3 minutes of blur.
const BLUR_DELAY_MS = 3 * 60_000

// Mirrors official Claude Code: only the first few recaps carry the opt-out
// hint, after which it's just noise.
const RECAP_HINT = ' (disable recaps in /config)'
const MAX_HINTED_RECAPS = 3

type SetMessages = (updater: (prev: Message[]) => Message[]) => void

type DraftInputRef = { readonly current: string }

export function hasSummarySinceLastUserTurn(
  messages: readonly Message[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'user' && !m.isMeta && !m.isCompactSummary) return false
    if (m.type === 'system' && m.subtype === 'away_summary') return true
  }
  return false
}

export function isAwaySummaryEnabled(
  settings: { awaySummaryEnabled?: boolean },
): boolean {
  return settings.awaySummaryEnabled !== false
}

/**
 * Appends a "while you were away" summary message once the user has been idle
 * (no turn in progress) for 3 minutes *and* the terminal is blurred. The 3-min
 * countdown is anchored to when the last turn ended — not to when the terminal
 * lost focus — so stepping away after a long idle fires the recap immediately.
 *
 * Two paths, mirroring official Claude Code:
 *  - a timer scheduled at turn-end fires at turn-end + 3min, gated on blur; and
 *  - blurring while already idle ≥3min fires it right away.
 *
 * Fires only when there's no existing away_summary since the last user message
 * and no draft input pending (so a recap never lands on text being typed).
 * Focus state 'unknown' (terminal doesn't support DECSET 1004) is a no-op.
 */
export function useAwaySummary(
  messages: readonly Message[],
  setMessages: SetMessages,
  isLoading: boolean,
  draftInputRef?: DraftInputRef,
): void {
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const isLoadingRef = useRef(isLoading)
  const prevLoadingRef = useRef(isLoading)
  const lastTurnEndRef = useRef<number | null>(null)
  const recapCountRef = useRef(0)
  const generateRef = useRef<(() => Promise<void>) | null>(null)
  const awaySummaryEnabled = useAppState(s => s.settings.awaySummaryEnabled ?? true)

  messagesRef.current = messages
  isLoadingRef.current = isLoading
  // Anchor the countdown to the moment a turn finishes (loading true → false).
  if (prevLoadingRef.current && !isLoading) {
    lastTurnEndRef.current = Date.now()
  }
  prevLoadingRef.current = isLoading

  // Generation + focus subscription. The blur path fires immediately when the
  // user is already idle past the threshold.
  useEffect(() => {
    if (!awaySummaryEnabled) return

    function abortInFlight(): void {
      abortRef.current?.abort()
      abortRef.current = null
    }

    async function generate(): Promise<void> {
      if (hasSummarySinceLastUserTurn(messagesRef.current)) return
      if ((draftInputRef?.current ?? '') !== '') return
      abortInFlight()
      const controller = new AbortController()
      abortRef.current = controller
      const text = await generateAwaySummary(
        messagesRef.current,
        controller.signal,
      )
      if (controller.signal.aborted || text === null) return
      const content =
        recapCountRef.current < MAX_HINTED_RECAPS ? text + RECAP_HINT : text
      recapCountRef.current += 1
      setMessages(prev => {
        const summary = createAwaySummaryMessage(content)
        // Keep the recap above a trailing api_metrics line (matches official).
        const last = prev[prev.length - 1]
        if (last?.type === 'system' && last.subtype === 'api_metrics') {
          return [...prev.slice(0, -1), summary, last]
        }
        return [...prev, summary]
      })
    }
    generateRef.current = generate

    function isIdlePastThreshold(): boolean {
      const anchor = lastTurnEndRef.current
      return anchor !== null && Date.now() - anchor >= BLUR_DELAY_MS
    }

    function onFocusChange(): void {
      const state = getTerminalFocusState()
      if (state === 'blurred') {
        if (!isLoadingRef.current && isIdlePastThreshold()) void generate()
      } else if (state === 'focused') {
        abortInFlight()
      }
      // 'unknown' → no-op
    }

    const unsubscribe = subscribeTerminalFocus(onFocusChange)
    // Handle the case where we're already blurred when the effect mounts
    onFocusChange()

    return () => {
      unsubscribe()
      abortInFlight()
      generateRef.current = null
    }
  }, [setMessages, awaySummaryEnabled])

  // Timer anchored to turn-end: fires at turn-end + 3min if still blurred. Re-runs
  // (and reschedules from the new anchor) whenever a turn starts or ends.
  useEffect(() => {
    if (!awaySummaryEnabled) return
    if (isLoading) return
    const anchor = lastTurnEndRef.current
    if (anchor === null) return
    const remaining = Math.max(0, BLUR_DELAY_MS - (Date.now() - anchor))
    const id = setTimeout(() => {
      if (getTerminalFocusState() !== 'blurred') return
      if (isLoadingRef.current) return
      void generateRef.current?.()
    }, remaining)
    return () => clearTimeout(id)
  }, [isLoading, awaySummaryEnabled])
}
