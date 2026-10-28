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

function sameChord(a: Keystroke[], b: Keystroke[]): boolean {
  return chordToString(a as never) === chordToString(b as never)
}

/** Later bindings win: a later binding for the same chord in the same context
 *  overrides this one, whether it rebinds or unbinds it. */
function isShadowed(bindings: readonly Binding[], index: number): boolean {
  const binding = bindings[index]!
  for (let j = index + 1; j < bindings.length; j++) {
    const later = bindings[j]!
    if (later.context === binding.context && sameChord(later.chord, binding.chord)) {
      return true
    }
  }
  return false
}

/**
 * True when every chat:sendNow binding in Chat is overridden by a later
 * null-action binding for the same chord — the user explicitly unbound it.
 * The hint is hidden entirely in that case, as upstream does.
 */
export function isSendNowUnbound(bindings: readonly Binding[]): boolean {
  let seen = false
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]!
    if (binding.action !== 'chat:sendNow' || binding.context !== 'Chat') continue
    seen = true
    let winner: Binding | undefined
    for (let j = i + 1; j < bindings.length; j++) {
      const later = bindings[j]!
      if (later.context === binding.context && sameChord(later.chord, binding.chord)) {
        winner = later
      }
    }
    if (winner?.action !== null) return false
  }
  return seen
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
    .filter(
      (b, i) =>
        b.action === 'chat:sendNow' &&
        b.context === 'Chat' &&
        !isShadowed(bindings, i),
    )
    .map(b => b.chord)
  const chord =
    (canReportExtendedKeys
      ? undefined
      : chords.findLast(c => !needsExtendedKeys(c))) ?? chords.at(-1)
  // Shown lower-case: "ctrl+enter to send now", not "ctrl+Enter".
  return chord ? chordToString(chord as never).toLowerCase() : ''
}
