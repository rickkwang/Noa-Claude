import type { AssistantMessage, UserMessage } from '../types/message.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { isDirectFirstParty } from './model/providers.js'
import type { EffortLevel } from './effort.js'

// Models whose Messages API accepts a `role: "system"` message carrying
// `output_config.effort` mid-conversation (docs: Per-message effort). Changing
// the top-level effort between requests invalidates the cached prefix; this
// does not.
const PER_TURN_EFFORT_MODELS = [
  'opus-5',
  'sonnet-5-5',
  'haiku-5-5',
  'fable-5-1',
  'fable-5-2',
  'mythos-5-1',
  'mythos-5-2',
]

export function modelSupportsPerTurnEffort(model: string): boolean {
  const canonical = getCanonicalName(model).toLowerCase()
  return PER_TURN_EFFORT_MODELS.some(name => canonical.includes(name))
}

// Beta header and system messages are sent to the Claude API only: other
// endpoints (proxies, Bedrock, Vertex) reject or ignore them.
export function shouldUsePerTurnEffort(model: string): boolean {
  return (
    modelSupportsPerTurnEffort(model) &&
    isDirectFirstParty() &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)
  )
}

export type PerTurnEffortPlan = {
  // Top-level output_config.effort: held at the conversation's first level so
  // the cached prefix keeps matching.
  baseEffort: EffortLevel
  // Level for the reply being requested.
  turnEffort: EffortLevel
  // Effort-only system messages to insert before the user message at `index`.
  insertions: { index: number; effort: EffortLevel }[]
}

// A user turn with new input; tool_result-only turns continue the same turn.
function isNewInput(message: UserMessage | AssistantMessage): boolean {
  if (message.type !== 'user') return false
  const content = message.message.content
  return (
    typeof content === 'string' ||
    content.some(block => block.type !== 'tool_result')
  )
}

/**
 * Plans the effort-only system messages for a request, from the effort each
 * earlier reply was generated with. Pure over the history, so a resumed or
 * forked transcript produces the same messages at the same positions as the
 * requests that were already cached.
 */
export function planPerTurnEffort(
  messages: (UserMessage | AssistantMessage)[],
  currentEffort: EffortLevel,
): PerTurnEffortPlan {
  // The top-level effort the latest request sent. Replies from before this
  // feature (or from a model without it) carry no `perTurnEffort`: they stay
  // as they were sent, never gaining system messages retroactively.
  const base =
    messages.findLast(
      (m): m is AssistantMessage => m.type === 'assistant' && m.effort !== undefined,
    )?.effort ?? currentEffort

  const insertions: PerTurnEffortPlan['insertions'] = []
  let previous: EffortLevel = base
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (!isNewInput(message)) continue
    // The reply to this turn: the first assistant message before the next
    // user turn with new input. The turn being requested has none yet.
    let level: EffortLevel | undefined
    let answered = false
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]!
      if (isNewInput(next)) break
      if (next.type === 'assistant' && !next.isApiErrorMessage) {
        answered = true
        level = next.perTurnEffort
        break
      }
    }
    if (!answered) level = currentEffort
    if (level === undefined || level === previous) continue
    // A system message cannot lead the conversation.
    if (i > 0) insertions.push({ index: i, effort: level })
    previous = level
  }
  return { baseEffort: base, turnEffort: previous, insertions }
}

export function insertPerTurnEffort<T>(
  params: T[],
  insertions: PerTurnEffortPlan['insertions'],
): (T | { role: 'system'; content: []; output_config: { effort: EffortLevel } })[] {
  const out: (T | { role: 'system'; content: []; output_config: { effort: EffortLevel } })[] = []
  const byIndex = new Map(insertions.map(i => [i.index, i.effort]))
  params.forEach((param, index) => {
    const effort = byIndex.get(index)
    if (effort !== undefined) {
      out.push({ role: 'system', content: [], output_config: { effort } })
    }
    out.push(param)
  })
  return out
}
