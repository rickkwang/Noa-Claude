// @ts-nocheck
import chalk from 'chalk'
import { isNativeCursorEnabled } from '../utils/nativeCursor.js'

type PlaceholderRendererProps = {
  placeholder?: string
  value: string
  showCursor?: boolean
  focus?: boolean
  terminalFocus: boolean
  invert?: (text: string) => string
  hidePlaceholderText?: boolean
}

export function renderPlaceholder({
  placeholder,
  value,
  showCursor,
  focus,
  terminalFocus = true,
  invert = chalk.inverse,
  hidePlaceholderText = false,
}: PlaceholderRendererProps): {
  renderedPlaceholder: string | undefined
  showPlaceholder: boolean
} {
  let renderedPlaceholder: string | undefined = undefined

  // The hardware cursor already marks the caret on an empty input; a
  // software caret on the placeholder's first char would double it.
  const drawSoftwareCaret = showCursor && focus && terminalFocus &&
    !isNativeCursorEnabled()

  if (placeholder) {
    if (hidePlaceholderText) {
      // Voice recording: show only the cursor, no placeholder text. The
      // waveform bar is the recording indicator, not a caret, so it stays
      // even when the hardware cursor is doing the caret duty.
      renderedPlaceholder =
        showCursor && focus && terminalFocus ? invert(' ') : ''
    } else {
      renderedPlaceholder = chalk.dim(placeholder)

      // Show inverse cursor only when both input and terminal are focused
      if (drawSoftwareCaret) {
        renderedPlaceholder =
          placeholder.length > 0
            ? invert(placeholder[0]!) + chalk.dim(placeholder.slice(1))
            : invert(' ')
      }
    }
  }

  const showPlaceholder = value.length === 0 && Boolean(placeholder)

  return {
    renderedPlaceholder,
    showPlaceholder,
  }
}
