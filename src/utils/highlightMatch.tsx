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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIlRleHQiLCJoaWdobGlnaHRNYXRjaCIsInRleHQiLCJxdWVyeSIsIlJlYWN0Tm9kZSIsInF1ZXJ5TG93ZXIiLCJ0b0xvd2VyQ2FzZSIsInRleHRMb3dlciIsInBhcnRzIiwib2Zmc2V0IiwiaWR4IiwiaW5kZXhPZiIsInB1c2giLCJzbGljZSIsImxlbmd0aCJdLCJzb3VyY2VzIjpbImhpZ2hsaWdodE1hdGNoLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBSZWFjdCBmcm9tICdyZWFjdCdcbmltcG9ydCB7IFRleHQgfSBmcm9tICcuLi9pbmsuanMnXG5cbi8qKlxuICogSW52ZXJzZS1oaWdobGlnaHQgZXZlcnkgb2NjdXJyZW5jZSBvZiBgcXVlcnlgIGluIGB0ZXh0YCAoY2FzZS1pbnNlbnNpdGl2ZSkuXG4gKiBVc2VkIGJ5IHNlYXJjaCBkaWFsb2dzIHRvIHNob3cgd2hlcmUgdGhlIHF1ZXJ5IG1hdGNoZWQgaW4gcmVzdWx0IHJvd3NcbiAqIGFuZCBwcmV2aWV3IHBhbmVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaGlnaGxpZ2h0TWF0Y2godGV4dDogc3RyaW5nLCBxdWVyeTogc3RyaW5nKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgaWYgKCFxdWVyeSkgcmV0dXJuIHRleHRcbiAgY29uc3QgcXVlcnlMb3dlciA9IHF1ZXJ5LnRvTG93ZXJDYXNlKClcbiAgY29uc3QgdGV4dExvd2VyID0gdGV4dC50b0xvd2VyQ2FzZSgpXG4gIGNvbnN0IHBhcnRzOiBSZWFjdC5SZWFjdE5vZGVbXSA9IFtdXG4gIGxldCBvZmZzZXQgPSAwXG4gIGxldCBpZHggPSB0ZXh0TG93ZXIuaW5kZXhPZihxdWVyeUxvd2VyLCBvZmZzZXQpXG4gIGlmIChpZHggPT09IC0xKSByZXR1cm4gdGV4dFxuICB3aGlsZSAoaWR4ICE9PSAtMSkge1xuICAgIGlmIChpZHggPiBvZmZzZXQpIHBhcnRzLnB1c2godGV4dC5zbGljZShvZmZzZXQsIGlkeCkpXG4gICAgcGFydHMucHVzaChcbiAgICAgIDxUZXh0IGtleT17aWR4fSBpbnZlcnNlPlxuICAgICAgICB7dGV4dC5zbGljZShpZHgsIGlkeCArIHF1ZXJ5Lmxlbmd0aCl9XG4gICAgICA8L1RleHQ+LFxuICAgIClcbiAgICBvZmZzZXQgPSBpZHggKyBxdWVyeS5sZW5ndGhcbiAgICBpZHggPSB0ZXh0TG93ZXIuaW5kZXhPZihxdWVyeUxvd2VyLCBvZmZzZXQpXG4gIH1cbiAgaWYgKG9mZnNldCA8IHRleHQubGVuZ3RoKSBwYXJ0cy5wdXNoKHRleHQuc2xpY2Uob2Zmc2V0KSlcbiAgcmV0dXJuIDw+e3BhcnRzfTwvPlxufVxuIl0sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUtBLEtBQUssTUFBTSxPQUFPO0FBQzlCLFNBQVNDLElBQUksUUFBUSxXQUFXOztBQUVoQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsT0FBTyxTQUFTQyxjQUFjQSxDQUFDQyxJQUFJLEVBQUUsTUFBTSxFQUFFQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUVKLEtBQUssQ0FBQ0ssU0FBUyxDQUFDO0VBQzNFLElBQUksQ0FBQ0QsS0FBSyxFQUFFLE9BQU9ELElBQUk7RUFDdkIsTUFBTUcsVUFBVSxHQUFHRixLQUFLLENBQUNHLFdBQVcsQ0FBQyxDQUFDO0VBQ3RDLE1BQU1DLFNBQVMsR0FBR0wsSUFBSSxDQUFDSSxXQUFXLENBQUMsQ0FBQztFQUNwQyxNQUFNRSxLQUFLLEVBQUVULEtBQUssQ0FBQ0ssU0FBUyxFQUFFLEdBQUcsRUFBRTtFQUNuQyxJQUFJSyxNQUFNLEdBQUcsQ0FBQztFQUNkLElBQUlDLEdBQUcsR0FBR0gsU0FBUyxDQUFDSSxPQUFPLENBQUNOLFVBQVUsRUFBRUksTUFBTSxDQUFDO0VBQy9DLElBQUlDLEdBQUcsS0FBSyxDQUFDLENBQUMsRUFBRSxPQUFPUixJQUFJO0VBQzNCLE9BQU9RLEdBQUcsS0FBSyxDQUFDLENBQUMsRUFBRTtJQUNqQixJQUFJQSxHQUFHLEdBQUdELE1BQU0sRUFBRUQsS0FBSyxDQUFDSSxJQUFJLENBQUNWLElBQUksQ0FBQ1csS0FBSyxDQUFDSixNQUFNLEVBQUVDLEdBQUcsQ0FBQyxDQUFDO0lBQ3JERixLQUFLLENBQUNJLElBQUksQ0FDUixDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQ0YsR0FBRyxDQUFDLENBQUMsT0FBTztBQUM3QixRQUFRLENBQUNSLElBQUksQ0FBQ1csS0FBSyxDQUFDSCxHQUFHLEVBQUVBLEdBQUcsR0FBR1AsS0FBSyxDQUFDVyxNQUFNLENBQUM7QUFDNUMsTUFBTSxFQUFFLElBQUksQ0FDUixDQUFDO0lBQ0RMLE1BQU0sR0FBR0MsR0FBRyxHQUFHUCxLQUFLLENBQUNXLE1BQU07SUFDM0JKLEdBQUcsR0FBR0gsU0FBUyxDQUFDSSxPQUFPLENBQUNOLFVBQVUsRUFBRUksTUFBTSxDQUFDO0VBQzdDO0VBQ0EsSUFBSUEsTUFBTSxHQUFHUCxJQUFJLENBQUNZLE1BQU0sRUFBRU4sS0FBSyxDQUFDSSxJQUFJLENBQUNWLElBQUksQ0FBQ1csS0FBSyxDQUFDSixNQUFNLENBQUMsQ0FBQztFQUN4RCxPQUFPLEVBQUUsQ0FBQ0QsS0FBSyxDQUFDLEdBQUc7QUFDckIiLCJpZ25vcmVMaXN0IjpbXX0=