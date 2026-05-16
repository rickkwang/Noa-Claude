// @ts-nocheck
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text, useInput } from '../../ink.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { Pane } from '../design-system/Pane.js';

type ReleaseNoteEntry = {
  kind: 'all' | 'version';
  title: string;
  count: number;
  version?: string;
  notes?: string[];
};

type Props = {
  notes: Array<[string, string[]]>;
  onClose: (result?: string, options?: { display?: 'skip' | 'system' | 'user' }) => void;
};

type RenderedNoteLine =
  | { kind: 'version'; text: string }
  | { kind: 'note'; text: string };

const MIN_VISIBLE_NOTES = 3;
const MAX_VISIBLE_NOTES = 8;
const MIN_VISIBLE_ENTRIES = 3;
const MAX_VISIBLE_ENTRIES = 10;
const CHROME_ROWS = 11;
const LIST_BREATHING_ROWS = 2;
const DETAIL_RESERVED_ROWS = 4;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function windowAround<T>(items: T[], focusedIndex: number, visibleCount: number): { visible: T[]; start: number } {
  const safeVisibleCount = Math.max(1, visibleCount);
  const start = clampNumber(focusedIndex - safeVisibleCount + 1, 0, Math.max(0, items.length - safeVisibleCount));
  return {
    visible: items.slice(start, start + safeVisibleCount),
    start,
  };
}

function renderNotes(notes: string[], visibleCount: number, offset = 0): React.ReactNode {
  const lines: RenderedNoteLine[] = notes.map(note => ({ kind: 'note', text: note }));
  return renderDetailLines(lines, visibleCount, offset);
}

function buildAllNoteLines(entries: Array<[string, string[]]>): RenderedNoteLine[] {
  return entries.flatMap(([version, notes]) => [
    { kind: 'version' as const, text: `Version ${version}` },
    ...notes.map(note => ({ kind: 'note' as const, text: note })),
  ]);
}

function renderAllNotes(entries: Array<[string, string[]]>, visibleCount: number, offset = 0): React.ReactNode {
  return renderDetailLines(buildAllNoteLines(entries), visibleCount, offset);
}

function renderDetailLines(
  lines: RenderedNoteLine[],
  visibleCount: number,
  offset = 0,
): React.ReactNode {
  if (lines.length === 0) {
    return <Text dimColor={true}>No notes available.</Text>;
  }
  const contentRows = Math.max(1, visibleCount - DETAIL_RESERVED_ROWS);
  const safeOffset = clampNumber(offset, 0, Math.max(0, lines.length - contentRows));
  const visibleLines = lines.slice(safeOffset, safeOffset + contentRows);
  const remainingAbove = safeOffset;
  const remainingBelow = lines.length - safeOffset - visibleLines.length;
  const hasAbove = remainingAbove > 0;
  const hasBelow = remainingBelow > 0;
  const paddedLines = [...visibleLines, ...Array(Math.max(0, contentRows - visibleLines.length)).fill(null)];

  return (
    <Box flexDirection="column">
      <Text dimColor={true} wrap="truncate-end">
        {hasAbove ? `${remainingAbove} more lines above` : ' '}
      </Text>
      <Text> </Text>
      {paddedLines.map((line, index) => (
        line === null
          ? <Text key={`${safeOffset + index}-pad`}> </Text>
          : (
        line.kind === 'version'
          ? <Text key={`${safeOffset + index}-${line.text}`} bold={true} color="claude" wrap="truncate-end">{line.text}</Text>
          : <Text key={`${safeOffset + index}-${line.text}`} wrap="truncate-end"><Text color="claude">•</Text> {line.text}</Text>
          )
      ))}
      <Text> </Text>
      <Text dimColor={true} wrap="truncate-end">
        {hasBelow ? `+ ${remainingBelow} more lines below` : ' '}
      </Text>
    </Box>
  );
}

export function ReleaseNotes({ notes, onClose }: Props): React.ReactNode {
  const { columns, rows } = useTerminalSize();
  const useSideBySide = columns >= 100;
  const visibleNoteCount = clampNumber(rows - CHROME_ROWS, MIN_VISIBLE_NOTES, MAX_VISIBLE_NOTES);
  const visibleEntryCount = clampNumber(
    rows - CHROME_ROWS - LIST_BREATHING_ROWS,
    MIN_VISIBLE_ENTRIES,
    MAX_VISIBLE_ENTRIES,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [detailOffset, setDetailOffset] = useState(0);

  // In narrow mode omit "Show all" — a vertical dump of all versions overflows easily.
  const entries = useMemo<ReleaseNoteEntry[]>(() => {
    if (notes.length === 0) {
      return [{ kind: 'all' as const, title: 'No release notes', count: 0 }];
    }

    const versionEntries = notes.map(([version, versionNotes]) => ({
      kind: 'version' as const,
      title: `Version ${version}`,
      version,
      count: versionNotes.length,
      notes: versionNotes,
    }));
    if (!useSideBySide) return versionEntries;
    return [
      { kind: 'all' as const, title: 'Show all', count: notes.length },
      ...versionEntries,
    ];
  }, [notes, useSideBySide]);

  // Default to first version (index 1 in wide mode, index 0 in narrow).
  const [focusedIndex, setFocusedIndex] = useState(() => useSideBySide && entries.length > 1 ? 1 : 0);

  useEffect(() => {
    setFocusedIndex(useSideBySide && entries.length > 1 ? 1 : 0);
    setIsExpanded(false);
    setDetailOffset(0);
  }, [useSideBySide, entries.length]);

  useEffect(() => {
    setFocusedIndex(i => Math.max(0, Math.min(i, entries.length - 1)));
  }, [entries.length]);

  const focusedEntry = entries[focusedIndex];
  const { visible: visibleEntries, start: visibleEntryStart } = windowAround(entries, focusedIndex, visibleEntryCount);
  const hiddenEntryCount = entries.length - visibleEntries.length;
  const focusedDetailLineCount = focusedEntry?.kind === 'all'
    ? buildAllNoteLines(notes).length
    : (focusedEntry?.notes?.length ?? 0) + 1;
  const detailContentRows = Math.max(1, visibleNoteCount - DETAIL_RESERVED_ROWS);
  const maxDetailOffset = Math.max(0, focusedDetailLineCount - detailContentRows);

  useInput((input, key) => {
    if (key.upArrow || (key.ctrl && input === 'p')) {
      if (isExpanded) {
        setDetailOffset(i => Math.max(0, i - 1));
        return;
      }
      setFocusedIndex(i => Math.max(0, i - 1));
      setIsExpanded(false);
      setDetailOffset(0);
      return;
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      if (isExpanded) {
        setDetailOffset(i => Math.min(maxDetailOffset, i + 1));
        return;
      }
      setFocusedIndex(i => Math.min(entries.length - 1, i + 1));
      setIsExpanded(false);
      setDetailOffset(0);
      return;
    }
    if (key.return) {
      setIsExpanded(expanded => {
        setDetailOffset(0);
        return !expanded;
      });
      return;
    }
    if (key.escape || (key.ctrl && (input === 'c' || input === 'd'))) {
      onClose('Release notes dismissed', { display: 'system' });
    }
  });

  const listWidth = useSideBySide
    ? Math.min(50, Math.max(34, Math.floor(columns * 0.35)))
    : undefined;
  const countColumnWidth = 11;
  const separatorRows = visibleEntryCount;

  const detail = !focusedEntry ? null : focusedEntry.kind === 'all' ? (
    renderAllNotes(notes, visibleNoteCount, isExpanded ? detailOffset : 0)
  ) : (
    renderDetailLines(
      [
        { kind: 'version', text: focusedEntry.title },
        ...(focusedEntry.notes ?? []).map(note => ({ kind: 'note' as const, text: note })),
      ],
      visibleNoteCount,
      isExpanded ? detailOffset : 0,
    )
  );

  return (
    <Pane color="professionalBlue">
      <Box flexDirection="column" gap={1}>
        <Text bold={true} color="professionalBlue">Release notes</Text>
        <Box flexDirection={useSideBySide ? 'row' : 'column'} gap={useSideBySide ? 0 : 1} marginTop={1}>
          {/* List */}
          <Box flexDirection="column" flexShrink={0} width={listWidth}>
            <Text dimColor={true} wrap="truncate-end">
              {visibleEntryStart > 0 ? `  ${visibleEntryStart} more above` : ' '}
            </Text>
            <Text> </Text>
            {visibleEntries.map((entry, visibleIndex) => {
              const index = visibleEntryStart + visibleIndex;
              const isFocused = index === focusedIndex;
              const countLabel = entry.kind === 'all'
                ? `${entry.count} ${plural(entry.count, 'version')}`
                : `${entry.count} ${plural(entry.count, 'item')}`;
              return (
                <Box
                  key={entry.kind === 'all' ? 'all' : entry.version}
                  flexDirection="row"
                  justifyContent="space-between"
                  flexShrink={0}
                >
                  <Text color={isFocused ? 'claude' : undefined} bold={isFocused} wrap="truncate-end">
                    {isFocused ? '❯' : ' '} {entry.title}
                  </Text>
                  <Box width={countColumnWidth} justifyContent="flex-end" flexShrink={0}>
                    <Text dimColor={true}>{countLabel}</Text>
                  </Box>
                </Box>
              );
            })}
            <Text> </Text>
            <Text dimColor={true} wrap="truncate-end">
              {hiddenEntryCount > visibleEntryStart
                ? `  ${hiddenEntryCount - visibleEntryStart} more below`
                : ' '}
            </Text>
          </Box>

          {/* Separator */}
          {useSideBySide && (
            <Box flexShrink={0} marginLeft={3} marginRight={3}>
              <Box flexDirection="column">
                <Text> </Text>
                <Text> </Text>
                {Array.from({ length: separatorRows }).map((_, i) => (
                  <Text key={`sep-${i}`} dimColor={true}>│</Text>
                ))}
                <Text> </Text>
                <Text> </Text>
              </Box>
            </Box>
          )}

          {/* Detail — top-aligned with list, no extra header */}
          <Box flexDirection="column" flexGrow={1} minWidth={0}>
            {detail}
          </Box>
        </Box>
        <Text dimColor={true} italic={true}>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action={isExpanded ? 'scroll' : 'navigate'} />
            <KeyboardShortcutHint shortcut="Enter" action={isExpanded ? 'collapse' : 'expand'} />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" />
          </Byline>
        </Text>
      </Box>
    </Pane>
  );
}
