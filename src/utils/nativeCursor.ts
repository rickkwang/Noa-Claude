import { isEnvTruthy } from './envUtils.js'

/**
 * Whether to park the terminal's own (hardware) cursor at the focused input's
 * caret and let it render, instead of drawing a software caret with SGR 7.
 *
 * A software caret is a reverse-video cell: SGR 7 swaps the terminal's
 * *default* foreground/background (SGR 39/49). That pair is a different
 * setting from both the 16 indexed ANSI colors and the emulator's dedicated
 * "cursor color" — most color schemes customize the latter two and leave
 * default-foreground at white, so the caret reads as a flat white block that
 * ignores the user's theme. Wrapping the caret in an indexed color before
 * inverting doesn't fix it either: the dedicated cursor color is reachable
 * only by a real, visible cursor.
 *
 * So this is not merely a rendering-cost tradeoff — the hardware cursor is
 * the only path to the emulator's cursor color, shape, and blink settings,
 * and it is what IME preedit and screen magnifiers already follow (ink.tsx
 * has parked it at the caret all along; it was just kept invisible).
 *
 * Opt out with NOA_CLAUDE_NATIVE_CURSOR=0 (legacy CLAUDE_CODE_NATIVE_CURSOR
 * accepted) to fall back to the software caret — e.g. on a terminal whose
 * cursor is invisible against the theme, or when a recorder/multiplexer
 * mangles DECTCEM.
 */
export function isNativeCursorEnabled(): boolean {
  // Cached: called from renderPlaceholder and VimTextInput, which re-run on
  // every keystroke. Terminal capability doesn't change mid-session, and
  // upstream memoizes the equivalent check too.
  if (cached === undefined) cached = resolve()
  return cached
}

let cached: boolean | undefined

function resolve(): boolean {
  const raw =
    process.env.NOA_CLAUDE_NATIVE_CURSOR ?? process.env.CLAUDE_CODE_NATIVE_CURSOR
  if (raw === undefined || raw.trim() === '') return true
  return isEnvTruthy(raw)
}

/** Test-only: drop the cached value so a changed env var is picked up. */
export function resetNativeCursorCacheForTesting(): void {
  cached = undefined
}
