import { getSessionId } from '../bootstrap/state.js'
import { hasOpus5PromptBundle } from '../constants/systemPromptCompact.js'
import { isThirdPartyModelProvider } from './model/providers.js'

/**
 * Upstream's subagent steer. "default" carries the prompt lines that nudge
 * toward delegating and running agents in parallel; "no_nudges" drops them;
 * "counter_steer" drops them and adds the delegation guidance.
 */
export type SubagentSteer = 'default' | 'no_nudges' | 'counter_steer'

function parseSteer(value: string | undefined): SubagentSteer | undefined {
  return value === 'default' || value === 'no_nudges' || value === 'counter_steer'
    ? value
    : undefined
}

let latched: { sessionId: string; steer: SubagentSteer } | undefined

/**
 * Latched per session like upstream, so the system prompt, the Agent tool
 * description and the agent listing agree even if the model changes later.
 * Upstream drops the nudges for models with the Opus 5 prompt bundle; Noa
 * also drops them for third-party providers, whose models fan out readily.
 */
export function getSubagentSteer(model: string | undefined): SubagentSteer {
  const sessionId = getSessionId()
  if (latched?.sessionId === sessionId) return latched.steer
  const steer =
    parseSteer(process.env.NOA_CLAUDE_SUBAGENT_STEER ?? process.env.CLAUDE_CODE_THISTLE_GREBE) ??
    (hasOpus5PromptBundle(model) || isThirdPartyModelProvider() ? 'no_nudges' : 'default')
  // Callers such as /context render the Agent tool without a model; latching
  // then would pin "default" before the session's model is known.
  if (model !== undefined) latched = { sessionId, steer }
  return steer
}

export function resetSubagentSteerLatch(): void {
  latched = undefined
}
