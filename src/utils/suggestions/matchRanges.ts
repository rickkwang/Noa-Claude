/**
 * Where a typeahead query matched inside a suggestion row.
 *
 * Ported from upstream Claude Code (>= 2.1.224). The old renderer sliced the
 * text at the first UTF-16 `indexOf` hit and recolored the slice; the new one
 * computes ranges first so the renderer can bold them instead — and so a
 * range never lands in the middle of a grapheme cluster.
 */
import { getGraphemeSegmenter } from '../intl.js'

/** `[start, end)` offsets into the original (un-lowercased) string. */
export type MatchRange = [number, number]

// Only text outside this range can combine (U+0300+ marks, surrogate pairs,
// ZWJ emoji), so pure ASCII/Latin rows skip the segmenter entirely.
const NEEDS_GRAPHEME_SNAP = /[^ -˿]/

/**
 * Widen each range out to grapheme-cluster boundaries and merge whatever
 * overlaps as a result, so a highlight can't split "👨‍👩‍👧" or a decomposed
 * "e" + U+0301 across two `<Text>` nodes (which renders as mojibake).
 */
function snapToGraphemes(text: string, ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0 || !NEEDS_GRAPHEME_SNAP.test(text)) return ranges

  const boundaries = new Set<number>()
  for (const { index } of getGraphemeSegmenter().segment(text)) {
    boundaries.add(index)
  }

  const snapped: MatchRange[] = []
  for (const [rawStart, rawEnd] of ranges) {
    let start = rawStart
    while (start > 0 && !boundaries.has(start)) start--
    let end = rawEnd
    while (end < text.length && !boundaries.has(end)) end++
    const last = snapped.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else snapped.push([start, end])
  }
  return snapped
}

/**
 * Compute the ranges of `text` that `query` matched, case-insensitively.
 *
 * Prefers the first contiguous occurrence. Falling back to a left-to-right
 * subsequence match mirrors the fuzzy search that put the row on screen —
 * except for descriptions, which pass `contiguousOnly` so a scattered
 * single-letter dusting doesn't show up as noise. Returns `[]` for no match.
 */
export function computeMatchRanges(
  text: string,
  query: string,
  contiguousOnly = false,
): MatchRange[] {
  if (!query || !text) return []

  // Upstream assumes callers pre-lowercase the query. Fold it here instead:
  // `matchedPrefix` is a public field on SuggestionItem, and a caller that
  // passes mixed case would otherwise silently get no highlighting at all.
  const needle = query.toLowerCase()
  const lower = text.toLowerCase()
  // Case folding that changes length (e.g. 'İ' → 'i̇') invalidates the offset
  // mapping back into `text`. Show the row unhighlighted rather than mangled.
  if (lower.length !== text.length) return []

  const contiguous = lower.indexOf(needle)
  if (contiguous !== -1) {
    return snapToGraphemes(text, [[contiguous, contiguous + needle.length]])
  }
  if (contiguousOnly) return []

  const ranges: MatchRange[] = []
  let from = 0
  // Iterate by code point, not code unit, so an astral query char advances
  // `from` by its full width.
  for (const char of needle) {
    const at = lower.indexOf(char, from)
    if (at === -1) return []
    const end = at + char.length
    const last = ranges.at(-1)
    if (last && last[1] === at) last[1] = end
    else ranges.push([at, end])
    from = end
  }
  return snapToGraphemes(text, ranges)
}
