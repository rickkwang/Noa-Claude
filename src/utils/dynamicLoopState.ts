import { randomUUID } from 'node:crypto'

export const DYNAMIC_LOOP_MAX_ITERATIONS = 24
export const DYNAMIC_LOOP_MAX_WALL_CLOCK_MS = 24 * 60 * 60 * 1000
export const DYNAMIC_LOOP_STATE_PREFIX = '--noa-loop-state='

export type DynamicLoopState = {
  chainId: string
  iteration: number
  startedAtMs: number
}

type RegistryEntry = {
  state: DynamicLoopState
  status: 'issued' | 'scheduled'
}

const MAX_PENDING_STATES = 256
const registry = new Map<string, RegistryEntry>()

function stateIsWithinBudget(state: DynamicLoopState, nowMs: number): boolean {
  return (
    state.iteration >= 1 &&
    state.iteration <= DYNAMIC_LOOP_MAX_ITERATIONS &&
    state.startedAtMs > 0 &&
    state.startedAtMs <= nowMs &&
    nowMs - state.startedAtMs < DYNAMIC_LOOP_MAX_WALL_CLOCK_MS
  )
}

function pruneExpired(nowMs: number): void {
  for (const [token, entry] of registry) {
    if (!stateIsWithinBudget(entry.state, nowMs)) registry.delete(token)
  }
  // Size-cap eviction only ever takes 'issued' entries. A 'scheduled' one has a
  // cron job already pointing at it, so evicting it silently kills a live chain
  // at its next fire. Entries expire on the wall-clock budget above regardless,
  // so the map stays bounded even when the cap cannot be enforced here.
  while (registry.size >= MAX_PENDING_STATES) {
    let evicted = false
    for (const [token, entry] of registry) {
      if (entry.status !== 'issued') continue
      registry.delete(token)
      evicted = true
      break
    }
    if (!evicted) break
  }
}

/** Stable, user-facing identifier for a chain. Never a scheduling token. */
export function newDynamicLoopChainId(): string {
  return randomUUID()
}

/**
 * Returns a single-use scheduling token. The token is the capability that lets
 * one cron job re-enter the chain, so it stays distinct from `chainId`, which
 * is a stable label the model prints back to the user. Reusing one value for
 * both would put a live token into user-facing text.
 */
export function issueDynamicLoopState(
  state: Omit<DynamicLoopState, 'chainId'> & { chainId?: string },
  createToken: () => string = randomUUID,
  nowMs = Date.now(),
): string {
  pruneExpired(nowMs)
  let token = createToken()
  while (!token || token.length > 128 || registry.has(token)) token = randomUUID()
  registry.set(token, {
    state: { ...state, chainId: state.chainId ?? newDynamicLoopChainId() },
    status: 'issued',
  })
  return token
}

const INVALID_STATE_MESSAGE =
  'This dynamic /loop state is invalid, forged, or already scheduled. Invoke /loop through the Skill tool to start a fresh chain.'

/**
 * The scheduling token carried by a `/loop --noa-loop-state=<token> ...` prompt,
 * or null when the prompt is not one. Single parser so the cron validate,
 * reserve, and release paths cannot drift apart on marker syntax.
 */
function tokenFromScheduledPrompt(scheduledPrompt: string): string | null {
  const args = scheduledPrompt
    .trim()
    .match(/^\/loop(?:\s+([\s\S]*))?$/)?.[1]
    ?.trim()
  if (!args?.startsWith(DYNAMIC_LOOP_STATE_PREFIX)) return null
  const tokenEnd = args.search(/\s/)
  const marker = tokenEnd === -1 ? args : args.slice(0, tokenEnd)
  return marker.slice(DYNAMIC_LOOP_STATE_PREFIX.length)
}

export function reserveDynamicLoopState(
  token: string,
  nowMs = Date.now(),
): string | null {
  if (!token || token.length > 128) return 'invalid'
  const entry = registry.get(token)
  if (!entry || entry.status !== 'issued') return 'unknown_or_replayed'
  if (!stateIsWithinBudget(entry.state, nowMs)) {
    registry.delete(token)
    return 'exhausted'
  }
  entry.status = 'scheduled'
  return null
}

export function reserveDynamicLoopScheduledPrompt(
  scheduledPrompt: string,
  recurring: boolean,
  durable: boolean,
  nowMs = Date.now(),
): string | null {
  const error = validateDynamicLoopScheduledPrompt(
    scheduledPrompt,
    recurring,
    durable,
    nowMs,
  )
  if (error) return error

  const token = tokenFromScheduledPrompt(scheduledPrompt)
  // Not a state-carrying /loop prompt: validate already cleared it, and there
  // is nothing to reserve.
  if (token === null) return null
  // Re-checks the same conditions validate just passed. That is deliberate:
  // validateInput and call are separate turns, so this is the only check that
  // is atomic with taking the token.
  return reserveDynamicLoopState(token, nowMs) === null
    ? null
    : INVALID_STATE_MESSAGE
}

export function validateDynamicLoopScheduledPrompt(
  scheduledPrompt: string,
  recurring: boolean,
  durable: boolean,
  nowMs = Date.now(),
): string | null {
  const match = scheduledPrompt.trim().match(/^\/loop(?:\s+([\s\S]*))?$/)
  if (!match) return null
  const args = match[1]?.trim() ?? ''
  if (!args.startsWith(DYNAMIC_LOOP_STATE_PREFIX)) {
    return 'Do not schedule a "/loop ..." wrapper via cron. Invoke /loop through the Skill tool now, or schedule the effective prompt body directly.'
  }
  if (recurring || durable) {
    return 'A "/loop ..." prompt cannot be scheduled as a recurring or durable cron job. Schedule the effective prompt body instead.'
  }
  const token = tokenFromScheduledPrompt(scheduledPrompt)
  if (!token || token.length > 128) return INVALID_STATE_MESSAGE
  const entry = registry.get(token)
  if (entry && entry.status === 'issued' && !stateIsWithinBudget(entry.state, nowMs)) {
    return `This dynamic /loop chain is past its budget (${DYNAMIC_LOOP_MAX_ITERATIONS} iterations or 24 hours). Do not schedule another run.`
  }
  return entry && entry.status === 'issued' ? null : INVALID_STATE_MESSAGE
}

export function releaseDynamicLoopScheduledPrompt(scheduledPrompt: string): void {
  const token = tokenFromScheduledPrompt(scheduledPrompt)
  if (token === null) return
  const entry = registry.get(token)
  if (entry?.status === 'scheduled') entry.status = 'issued'
}

export function consumeDynamicLoopState(
  token: string,
): DynamicLoopState | undefined {
  if (!token || token.length > 128) return undefined
  const entry = registry.get(token)
  if (!entry || entry.status !== 'scheduled') return undefined
  registry.delete(token)
  return entry.state
}
