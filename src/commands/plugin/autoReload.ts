/**
 * Deciding whether closing the /plugin menu should apply the changes it made.
 *
 * The menu writes settings immediately but the running session keeps the old
 * plugin set until refreshActivePlugins() runs. Rather than reload from inside
 * the dialog, closing it queues `/reload-plugins` as the next input — one code
 * path for activation, and a turn that is already in flight simply drains
 * first.
 */

export const RELOAD_COMMAND = '/reload-plugins'

/** Shown only when the reload cannot run until the current response ends. */
const RELOAD_QUEUED_NOTE = `Plugin changes apply when the current response finishes (${RELOAD_COMMAND} is queued).`

/**
 * Footer wording while the menu is still open on staged changes. Closing
 * messages don't repeat it — the queued reload reports itself.
 */
export const APPLIES_ON_CLOSE_HINT = 'Applies when you close this menu.'

type MenuAutoReloadOutcome =
  /** Nothing to activate — close the dialog as-is. */
  | 'none'
  /** Reload was queued and runs immediately. */
  | 'queued'
  /** Reload was queued behind the response that is still streaming. */
  | 'deferred'

type MenuAutoReloadInputs = {
  /** The menu changed something in this session (settings write landed). */
  dirty: boolean
  /** AppState still has an unconsumed refresh; something else may have taken it. */
  needsRefresh: boolean
  /** The dialog was opened mid-turn, so the queued command waits its turn. */
  midTurn: boolean
}

export function decideMenuAutoReload({
  dirty,
  needsRefresh,
  midTurn,
}: MenuAutoReloadInputs): MenuAutoReloadOutcome {
  if (!dirty || !needsRefresh) return 'none'
  return midTurn ? 'deferred' : 'queued'
}

/**
 * Append the deferred note to whatever message the menu was closing with.
 * A menu that closes silently still reports the queued reload, otherwise a
 * mid-turn toggle would look like it did nothing.
 */
export function withQueuedNote(message: string | undefined): string {
  return message ? `${message}\n${RELOAD_QUEUED_NOTE}` : RELOAD_QUEUED_NOTE
}
