import { chordToString } from './parser.js'

type Keystroke = {
  key: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  super?: boolean
}

type Binding = {
  action: string | null
  context: string
  chord: Keystroke[]
}

/** A chord a plain terminal can't deliver: ctrl/shift+enter or a super key. */
function needsExtendedKeys(chord: Keystroke[]): boolean {
  return chord.some(
    k => k.super || (k.key === 'enter' && (k.ctrl || k.shift)),
  )
}

/**
 * The chat:sendNow chord to advertise. Last binding wins, as for every other
 * shortcut, except that a terminal which can't report ctrl+enter (or runs
 * under tmux/screen, which drop it) gets the last binding it can actually
 * type — ctrl+x ctrl+s by default. Empty when sendNow is unbound.
 */
export function getSendNowShortcut(
  bindings: readonly Binding[],
  canReportExtendedKeys: boolean,
): string {
  const chords = bindings
    .filter(b => b.action === 'chat:sendNow' && b.context === 'Chat')
    .map(b => b.chord)
  const chord =
    (canReportExtendedKeys
      ? undefined
      : chords.findLast(c => !needsExtendedKeys(c))) ?? chords.at(-1)
  // Shown lower-case: "ctrl+enter to send now", not "ctrl+Enter".
  return chord ? chordToString(chord as never).toLowerCase() : ''
}
