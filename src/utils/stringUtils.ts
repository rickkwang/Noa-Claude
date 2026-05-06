// @ts-nocheck
/**
 * General string utility functions and classes for safe string accumulation
 */

/**
 * Escapes special regex characters in a string so it can be used as a literal
 * pattern in a RegExp constructor.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Uppercases the first character of a string, leaving the rest unchanged.
 * Unlike lodash `capitalize`, this does NOT lowercase the remaining characters.
 *
 * @example capitalize('fooBar') → 'FooBar'
 * @example capitalize('hello world') → 'Hello world'
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Returns the singular or plural form of a word based on count.
 * Replaces the inline `word${n === 1 ? '' : 's'}` idiom.
 *
 * @example plural(1, 'file') → 'file'
 * @example plural(3, 'file') → 'files'
 * @example plural(2, 'entry', 'entries') → 'entries'
 */
export function plural(
  n: number,
  word: string,
  pluralWord = word + 's',
): string {
  return n === 1 ? word : pluralWord
}

/**
 * Returns the first line of a string without allocating a split array.
 * Used for shebang detection in diff rendering.
 */
export function firstLineOf(s: string): string {
  const nl = s.indexOf('\n')
  return nl === -1 ? s : s.slice(0, nl)
}

/**
 * Counts occurrences of `char` in `str` using indexOf jumps instead of
 * per-character iteration. Structurally typed so Buffer works too
 * (Buffer.indexOf accepts string needles).
 */
export function countCharInString(
  str: { indexOf(search: string, start?: number): number },
  char: string,
  start = 0,
): number {
  let count = 0
  let i = str.indexOf(char, start)
  while (i !== -1) {
    count++
    i = str.indexOf(char, i + 1)
  }
  return count
}

/**
 * Normalize full-width (zenkaku) digits to half-width digits.
 * Useful for accepting input from Japanese/CJK IMEs.
 */
export function normalizeFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  )
}

/**
 * Normalize full-width (zenkaku) space to half-width space.
 * Useful for accepting input from Japanese/CJK IMEs (U+3000 → U+0020).
 */
export function normalizeFullWidthSpace(input: string): string {
  return input.replace(/\u3000/g, ' ')
}

// Keep in-memory accumulation modest to avoid blowing up RSS.
// Overflow beyond this limit is spilled to disk by ShellCommand.
const MAX_STRING_LENGTH = 2 ** 25

/**
 * Safely joins an array of strings with a delimiter, truncating if the result exceeds maxSize.
 *
 * @param lines Array of strings to join
 * @param delimiter Delimiter to use between strings (default: ',')
 * @param maxSize Maximum size of the resulting string
 * @returns The joined string, truncated if necessary
 */
export function safeJoinLines(
  lines: string[],
  delimiter: string = ',',
  maxSize: number = MAX_STRING_LENGTH,
): string {
  const truncationMarker = '...[truncated]'
  let result = ''

  for (const line of lines) {
    const delimiterToAdd = result ? delimiter : ''
    const fullAddition = delimiterToAdd + line

    if (result.length + fullAddition.length <= maxSize) {
      // The full line fits
      result += fullAddition
    } else {
      // Need to truncate
      const remainingSpace =
        maxSize -
        result.length -
        delimiterToAdd.length -
        truncationMarker.length

      if (remainingSpace > 0) {
        // Add delimiter and as much of the line as will fit
        result +=
          delimiterToAdd + line.slice(0, remainingSpace) + truncationMarker
      } else {
        // No room for any of this line, just add truncation marker
        result += truncationMarker
      }
      return result
    }
  }
  return result
}

/**
 * A string accumulator that handles large outputs by keeping a fixed-size
 * prefix (head) and a sliding suffix (tail), discarding the middle when the
 * total exceeds maxSize. This preserves both the start (setup/context) and
 * the end (errors/results), which is what users care about for shell output.
 *
 * Long-running build/test commands typically print the most important info
 * (failure summary, exit reason) at the end; keeping only the head loses it.
 */
export class HeadAndTailAccumulator {
  private head: string = ''
  private tail: string = ''
  private isTruncated = false
  private totalBytesReceived = 0
  private readonly headMax: number
  private readonly tailMax: number

  /**
   * @param maxSize Total maximum size in characters before truncation kicks in
   * @param headRatio Fraction of maxSize reserved for the prefix (default 0.25)
   */
  constructor(
    private readonly maxSize: number = MAX_STRING_LENGTH,
    headRatio: number = 0.25,
  ) {
    this.headMax = Math.floor(maxSize * headRatio)
    this.tailMax = maxSize - this.headMax
  }

  append(data: string | Buffer): void {
    const str = typeof data === 'string' ? data : data.toString()
    if (str.length === 0) return
    this.totalBytesReceived += str.length

    let remaining = str

    // Fill head until full
    if (this.head.length < this.headMax) {
      const room = this.headMax - this.head.length
      if (remaining.length <= room) {
        this.head += remaining
        return
      }
      this.head += remaining.slice(0, room)
      remaining = remaining.slice(room)
    }

    // Append to tail with sliding window — keep the most recent tailMax chars
    if (this.tail.length + remaining.length <= this.tailMax) {
      this.tail += remaining
      return
    }

    if (remaining.length >= this.tailMax) {
      // Single chunk overflows — keep only its tail
      this.tail = remaining.slice(remaining.length - this.tailMax)
    } else {
      // Drop oldest part of tail to make room
      const combined = this.tail + remaining
      this.tail = combined.slice(combined.length - this.tailMax)
    }
    this.isTruncated = true
  }

  toString(): string {
    if (!this.isTruncated) {
      return this.head + this.tail
    }
    const droppedBytes =
      this.totalBytesReceived - this.head.length - this.tail.length
    const droppedKB = Math.round(droppedBytes / 1024)
    return `${this.head}\n... [output truncated - ${droppedKB}KB removed from middle]\n${this.tail}`
  }

  clear(): void {
    this.head = ''
    this.tail = ''
    this.isTruncated = false
    this.totalBytesReceived = 0
  }

  get length(): number {
    return this.head.length + this.tail.length
  }

  get truncated(): boolean {
    return this.isTruncated
  }

  get totalBytes(): number {
    return this.totalBytesReceived
  }
}

/**
 * @deprecated Use HeadAndTailAccumulator. Old name kept for compat — behavior
 * has changed: previously kept only the head, now keeps head + tail.
 */
export const EndTruncatingAccumulator = HeadAndTailAccumulator

/**
 * Truncates text to a maximum number of lines, adding an ellipsis if truncated.
 *
 * @param text The text to truncate
 * @param maxLines Maximum number of lines to keep
 * @returns The truncated text with ellipsis if truncated
 */
export function truncateToLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) {
    return text
  }
  return lines.slice(0, maxLines).join('\n') + '…'
}
