// @ts-nocheck
import chalk from 'chalk'
import crypto from 'node:crypto'
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js'

// OSC 8 hyperlink escape sequences
// Format: \e]8;<params>;URL\e\\TEXT\e]8;;\e\\
// Using \x07 (BEL) as terminator which is more widely supported
export const OSC8_HEADER = '\x1b]8;'
export const OSC8_END = '\x07'

// Stable short id per URL so terminals group runs of the link across wrapped
// rows into a single clickable region. Without id=, only the first visible
// row of a wrapped long URL is clickable.
function hyperlinkId(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)
}

type HyperlinkOptions = {
  supportsHyperlinks?: boolean
}

/**
 * Create a clickable hyperlink using OSC 8 escape sequences.
 * Falls back to plain text if the terminal doesn't support hyperlinks.
 *
 * @param url - The URL to link to
 * @param content - Optional content to display as the link text (only when hyperlinks are supported).
 *                  If provided and hyperlinks are supported, this text is shown as a clickable link.
 *                  If hyperlinks are not supported, content is ignored and only the URL is shown.
 * @param options - Optional overrides for testing (supportsHyperlinks)
 */
export function createHyperlink(
  url: string,
  content?: string,
  options?: HyperlinkOptions,
): string {
  const hasSupport = options?.supportsHyperlinks ?? supportsHyperlinks()
  if (!hasSupport) {
    if (content && content !== url) {
      return `${content} (${url})`
    }
    return url
  }

  // Apply basic ANSI blue color - wrap-ansi preserves this across line breaks
  // RGB colors (like theme colors) are NOT preserved by wrap-ansi with OSC 8
  const displayText = content ?? url
  const coloredText = chalk.blue(displayText)
  // Embed id= so wrapped rows of a long URL stay grouped as one clickable link.
  // Open: \e]8;id=<id>;<url>\a  Close: \e]8;;\a (empty params terminates link)
  const idParam = `id=${hyperlinkId(url)}`
  return `${OSC8_HEADER}${idParam};${url}${OSC8_END}${coloredText}${OSC8_HEADER};${OSC8_END}`
}
