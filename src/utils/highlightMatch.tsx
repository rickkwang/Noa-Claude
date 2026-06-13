// @ts-nocheck
import * as React from 'react';
import { Text } from '../ink.js';

/**
 * Inverse-highlight every occurrence of `query` in `text` (case-insensitive).
 * Used by search dialogs to show where the query matched in result rows
 * and preview panes.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let offset = 0;
  let idx = textLower.indexOf(queryLower, offset);
  if (idx === -1) return text;

  // Grapheme boundaries so we don't split surrogate pairs or ZWJ emoji
  // sequences (e.g. 👨‍👩‍👧‍👦). UTF-16 indexOf can land mid-cluster.
  const segmenter =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  const boundaries: Set<number> | null = segmenter ? new Set([0]) : null;
  if (segmenter && boundaries) {
    for (const seg of segmenter.segment(text)) {
      boundaries.add(seg.index + seg.segment.length);
    }
  }
  const snap = (i: number, dir: -1 | 1): number => {
    if (!boundaries || boundaries.has(i)) return i;
    let j = i;
    while (j > 0 && j < text.length && !boundaries.has(j)) j += dir;
    return j;
  };

  while (idx !== -1) {
    const start = snap(idx, -1);
    const end = snap(idx + query.length, 1);
    if (start > offset) parts.push(text.slice(offset, start));
    parts.push(<Text key={start} inverse>
        {text.slice(start, end)}
      </Text>);
    offset = end;
    idx = textLower.indexOf(queryLower, offset);
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return <>{parts}</>;
}
