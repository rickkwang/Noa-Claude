/**
 * Per-session limits on model-initiated feedback drafting.
 *
 * Two separate budgets, because they bound different harms:
 *
 * - `MAX_DRAFTS_PER_SESSION` bounds writes. Without it a model stuck in a loop
 *   could churn the draft directory all session; the queue cap alone only
 *   bounds what is *kept*, not how often it is rewritten.
 * - `MAX_NOTICES_PER_SESSION` bounds interruptions. Drafting keeps working past
 *   it, silently — a person who has already been told twice does not need to be
 *   told a third time to keep the feature honest.
 *
 * Module-level state: one CLI process is one session, and this resets with it.
 */
export const MAX_DRAFTS_PER_SESSION = 20
export const MAX_NOTICES_PER_SESSION = 3

let draftCount = 0
let noticeCount = 0

/**
 * Books one drafting slot. Returns false when the session budget is spent, in
 * which case the caller tells the model to stop rather than silently dropping
 * the draft.
 */
export function tryConsumeDraftBudget(): boolean {
  if (draftCount >= MAX_DRAFTS_PER_SESSION) return false
  draftCount++
  return true
}

/** True when a queued draft should also raise a notice. */
export function shouldShowDraftNotice(): boolean {
  if (noticeCount >= MAX_NOTICES_PER_SESSION) return false
  noticeCount++
  return true
}

/** Test seam; production never needs to rewind a session's budgets. */
export function resetFeedbackDraftSessionForTesting(): void {
  draftCount = 0
  noticeCount = 0
}
