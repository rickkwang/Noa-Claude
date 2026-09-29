/**
 * Whether the key being dispatched arrived alone in its stdin read. A key
 * that came in a burst (paste, a replayed escape sequence, input buffered
 * while the app was busy) wasn't a deliberate press, so gestures that act on
 * a single key (← opens agents) treat it as plain input.
 */
let solo = true

export function setSoloKeypress(value: boolean): void {
  solo = value
}

export function isSoloKeypress(): boolean {
  return solo
}
