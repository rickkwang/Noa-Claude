import type { PromptInputMode } from '../../types/textInputTypes.js'
import type { PastedContent } from '../../utils/config.js'

export type StashedPrompt = {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
  // The input mode travels with the text: a `!` prompt stashes its body
  // without the `!`, so restoring it in prompt mode would silently turn a
  // shell command into a chat message.
  mode: PromptInputMode
}

export type StashAction =
  | { type: 'push'; stash: StashedPrompt }
  | { type: 'pop'; stash: StashedPrompt }
  | { type: 'none' }

/**
 * chat:stash (ctrl+s) toggles: non-empty input is pushed, empty input pops an
 * existing stash. Pushing always leaves the input in prompt mode — staying in
 * bash mode would make the next `/` complete file paths instead of commands.
 */
export function getStashAction(
  current: StashedPrompt,
  stashed: StashedPrompt | undefined,
): StashAction {
  if (current.text.trim() === '') {
    return stashed === undefined ? { type: 'none' } : { type: 'pop', stash: stashed }
  }
  return { type: 'push', stash: current }
}
