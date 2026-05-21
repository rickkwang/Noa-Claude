// @ts-nocheck
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text, useInput } from '../../ink.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';

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
const LIST_BREATHING_ROWS = 1;
const PANEL_HEADER_ROWS = 2;
const PANEL_FOOTER_ROWS = 1;

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

function buildAllNoteLines(entries: Array<[string, string[]]>): RenderedNoteLine[] {
  return entries.flatMap(([version, notes]) => [
    { kind: 'version' as const, text: `Version ${version}` },
    ...notes.map(note => ({ kind: 'note' as const, text: note })),
  ]);
}

function renderAllNotes(entries: Array<[string, string[]]>, visibleCount: number, offset = 0): React.ReactNode {
  return renderDetailPanel(buildAllNoteLines(entries), visibleCount, offset);
}

function getDetailWindow(
  lines: RenderedNoteLine[],
  bodyRows: number,
  offset = 0,
) {
  if (lines.length === 0) {
    return {
      paddedLines: [null],
      hasBelow: false,
      remainingBelow: 0,
    };
  }
  const visibleRows = Math.max(1, bodyRows);
  const safeOffset = clampNumber(offset, 0, Math.max(0, lines.length - visibleRows));
  const visibleLines = lines.slice(safeOffset, safeOffset + visibleRows);
  const remainingBelow = lines.length - safeOffset - visibleLines.length;
  const hasBelow = remainingBelow > 0;
  const paddedLines = [...visibleLines, ...Array(Math.max(0, visibleRows - visibleLines.length)).fill(null)];

  return { paddedLines, hasBelow, remainingBelow };
}

function renderDetailPanel(
  lines: RenderedNoteLine[],
  bodyRows: number,
  offset = 0,
): React.ReactNode {
  const { paddedLines, hasBelow, remainingBelow } = getDetailWindow(
    lines,
    bodyRows,
    offset,
  )

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {paddedLines.map((line, index) => (
        line === null
          ? <Text key={`detail-pad-${index}`}> </Text>
          : (
        line.kind === 'version'
          ? <Text key={`detail-${index}-${line.text}`} bold={true} color="claude" wrap="truncate-end">{line.text}</Text>
          : <Text key={`detail-${index}-${line.text}`} wrap="truncate-end"><Text color="claude">•</Text> {line.text}</Text>
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
  const visibleEntryCount = clampNumber(
    rows - CHROME_ROWS - LIST_BREATHING_ROWS,
    MIN_VISIBLE_ENTRIES,
    MAX_VISIBLE_ENTRIES,
  );
  const panelBodyRows = Math.max(1, visibleEntryCount);
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
  const maxDetailOffset = Math.max(0, focusedDetailLineCount - panelBodyRows);

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
    }
  });

  const listWidth = useSideBySide
    ? Math.min(52, Math.max(36, Math.floor(columns * 0.36)))
    : undefined;
  const countColumnWidth = 11;
  const dividerHeight = panelBodyRows;

  const detail = !focusedEntry ? null : focusedEntry.kind === 'all' ? (
    renderAllNotes(notes, panelBodyRows, isExpanded ? detailOffset : 0)
  ) : (
    renderDetailPanel(
      [
        { kind: 'version', text: focusedEntry.title },
        ...(focusedEntry.notes ?? []).map(note => ({ kind: 'note' as const, text: note })),
      ],
      panelBodyRows,
      isExpanded ? detailOffset : 0,
    )
  );

  const dialogSubtitle = notes.length === 0
    ? 'No bundled release notes available'
    : `${notes.length} ${plural(notes.length, 'version')} · ${isExpanded ? 'Expanded detail view' : 'Browse versions'}`;

  return (
    <Dialog
      title="Release Notes"
      subtitle={dialogSubtitle}
      color="professionalBlue"
      onCancel={() => onClose('Release notes dismissed', { display: 'system' })}
      inputGuide={() => (
        <Byline>
          <KeyboardShortcutHint shortcut="↑/↓" action={isExpanded ? 'scroll' : 'navigate'} />
          <KeyboardShortcutHint shortcut="Enter" action={isExpanded ? 'collapse' : 'expand'} />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" />
        </Byline>
      )}
    >
      <Box flexDirection={useSideBySide ? 'row' : 'column'} gap={useSideBySide ? 2 : 1}>
        <Box flexDirection="column" flexShrink={0} width={listWidth}>
          <Text dimColor={true}>
            Versions
            {notes.length > 0 ? ` · ${focusedIndex + 1}/${entries.length}` : ''}
          </Text>
          <Text> </Text>
          {[
            ...visibleEntries,
            ...Array(Math.max(0, panelBodyRows - visibleEntries.length)).fill(null),
          ].map((entry, visibleIndex) => {
            if (entry === null) {
              return <Text key={`entry-pad-${visibleIndex}`}> </Text>
            }
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

        {useSideBySide && (
          <Box flexDirection="column" flexShrink={0} paddingX={1}>
            <Text> </Text>
            <Text> </Text>
            {Array.from({ length: dividerHeight }).map((_, i) => (
              <Text key={`divider-${i}`} dimColor={true}>│</Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column" flexGrow={1} minWidth={0}>
          <Text dimColor={true}>
            Details
            {focusedEntry?.kind === 'version' ? ` · ${focusedEntry.title}` : focusedEntry?.kind === 'all' ? ' · All versions' : ''}
          </Text>
          {detail}
        </Box>
      </Box>
    </Dialog>
  );
}
