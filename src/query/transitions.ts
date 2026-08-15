import type { AutoCompactTrackingState } from '../services/compact/autoCompact.js'
import type { ToolUseContext } from '../Tool.js'
import type { Message, ToolUseSummaryMessage } from '../types/message.js'

// -- query loop transitions
//
// Every queryLoop iteration ends in exactly one of two ways: a Terminal
// return (the turn is over) or a Continue transition (state is rebuilt and
// the loop re-enters). These discriminated unions enumerate both sets so
// tests can assert which path fired without inspecting message contents,
// and so a new exit/continue site can't invent an unchecked reason string.

// Why the previous iteration continued. Stored on State.transition;
// undefined on the first iteration.
export type Continue =
  // A withheld prompt-too-long was recovered by draining staged
  // context-collapses; retry with the drained view.
  | { reason: 'collapse_drain_retry'; committed: number }
  // A withheld prompt-too-long (or media-size error) was recovered by
  // reactive compaction; retry with the post-compact messages.
  | { reason: 'reactive_compact_retry' }
  // max_output_tokens hit at the capped default; retry the SAME request
  // with the escalated cap before falling back to multi-turn recovery.
  | { reason: 'max_output_tokens_escalate' }
  // max_output_tokens recovery: inject a meta resume prompt and continue.
  | { reason: 'max_output_tokens_recovery'; attempt: number }
  // A Stop hook returned blocking errors; feed them back to the model.
  | { reason: 'stop_hook_blocking' }
  // Token-budget auto-continue nudged the model to keep working.
  | { reason: 'token_budget_continuation' }
  // Goal evaluator judged the goal unmet and asked for another turn.
  | { reason: 'goal_auto_continue' }
  // Normal turn boundary: tool results collected, recurse.
  | { reason: 'next_turn' }

// Why queryLoop returned. Reached via `yield* queryLoop(...)` in query().
export type Terminal =
  | { reason: 'completed' }
  // Preempted before the API call: context over the hard blocking limit
  // with automatic compaction disabled.
  | { reason: 'blocking_limit' }
  // Image/PDF validation or media-size rejection with no recovery left.
  | { reason: 'image_error' }
  // Prompt-too-long with all recovery stages (collapse drain, reactive
  // compact) exhausted or unavailable.
  | { reason: 'prompt_too_long' }
  // queryModelWithStreaming threw (it normally yields synthetic error
  // messages instead — this path is a runtime bug surfacing).
  | { reason: 'model_error'; error: unknown }
  | { reason: 'aborted_streaming' }
  | { reason: 'aborted_tools' }
  // Autocompact rapid-refill breaker tripped: context refilled past the
  // threshold within RAPID_REFILL_TURN_WINDOW turns of the previous compact,
  // RAPID_REFILL_MAX_CONSECUTIVE times in a row. Compaction can't win
  // against whatever is re-inflating context — stop instead of paying a
  // summary call every few turns forever.
  | { reason: 'rapid_refill_breaker' }
  // A Stop hook set preventContinuation.
  | { reason: 'stop_hook_prevented' }
  // A tool-phase hook emitted hook_stopped_continuation.
  | { reason: 'hook_stopped' }
  | { reason: 'max_turns'; turnCount: number }

// Mutable state carried between loop iterations. The loop body destructures
// this at the top of each iteration; continue sites rebuild it via
// nextState() instead of writing all fields by hand.
export type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  // Consecutive stop-hook blocking continues. Loop-safety counter — carried
  // by nextState like maxOutputTokensRecoveryCount, explicitly reset on real
  // progress (next_turn / token_budget / goal continuations). Capped at
  // CLAUDE_CODE_STOP_HOOK_BLOCK_CAP (default 8) in query.ts.
  stopHookBlockingCount: number
  turnCount: number
  // Why the previous iteration continued. Undefined on first iteration.
  // Lets tests assert recovery paths fired without inspecting message contents.
  transition: Continue | undefined
}

// Fields every continue site must decide afresh: messages and
// autoCompactTracking are recomputed within the iteration (prev's values are
// stale), toolUseContext gains queryTracking/fallback-model updates, and
// transition names the path taken.
type RequiredNextFields = Pick<
  State,
  'messages' | 'toolUseContext' | 'autoCompactTracking' | 'transition'
>

/**
 * Build the next iteration's State. Defaults are chosen so that FORGETTING
 * an override fails benign, never as an infinite loop:
 *
 * - Carry forward: maxOutputTokensRecoveryCount, hasAttemptedReactiveCompact,
 *   stopHookBlockingCount, turnCount. These are loop-safety counters/guards — resetting one by
 *   accident re-arms a retry path (the stop_hook_blocking +
 *   hasAttemptedReactiveCompact reset bug burned thousands of API calls).
 *   A stale carry merely stops recovery one turn early.
 * - Reset to undefined: maxOutputTokensOverride, pendingToolUseSummary,
 *   stopHookActive. These are consumed within a single iteration by default.
 *   The max-output recovery path may opt back into carrying the internally
 *   escalated 64k cap so recovery retries do not waste an extra capped call;
 *   caller-supplied overrides still reset.
 */
export function nextState(
  prev: State,
  next: Partial<State> & RequiredNextFields,
): State {
  return {
    maxOutputTokensRecoveryCount: prev.maxOutputTokensRecoveryCount,
    hasAttemptedReactiveCompact: prev.hasAttemptedReactiveCompact,
    stopHookBlockingCount: prev.stopHookBlockingCount,
    turnCount: prev.turnCount,
    maxOutputTokensOverride: undefined,
    pendingToolUseSummary: undefined,
    stopHookActive: undefined,
    ...next,
  }
}
