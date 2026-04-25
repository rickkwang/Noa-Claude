// @ts-nocheck
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text, useInput } from '../../ink.js';
import { plural } from '../../utils/stringUtils.js';
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

function renderNotes(notes: string[]): React.ReactNode {
  if (notes.length === 0) {
    return <Text dimColor={true}>No notes available.</Text>;
  }
  return (
    <Box flexDirection="column" gap={1}>
      {notes.map((note, index) => (
        <Text key={`${index}-${note}`}>
          <Text color="claude">•</Text> {note}
        </Text>
      ))}
    </Box>
  );
}

function renderAllNotes(entries: Array<[string, string[]]>): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1}>
      {entries.map(([version, notes]) => (
        <Box key={version} flexDirection="column">
          <Text bold={true} color="claude">Version {version}</Text>
          {renderNotes(notes)}
        </Box>
      ))}
    </Box>
  );
}

export function ReleaseNotes({ notes, onClose }: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const useSideBySide = columns >= 100;

  // In narrow mode omit "Show all" — a vertical dump of all versions overflows easily.
  const entries = useMemo<ReleaseNoteEntry[]>(() => {
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
  }, [useSideBySide, entries.length]);

  useEffect(() => {
    setFocusedIndex(i => Math.max(0, Math.min(i, entries.length - 1)));
  }, [entries.length]);

  const focusedEntry = entries[focusedIndex];

  useInput((input, key) => {
    if (key.upArrow || (key.ctrl && input === 'p')) {
      setFocusedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      setFocusedIndex(i => Math.min(entries.length - 1, i + 1));
      return;
    }
    if (key.return || key.escape || (key.ctrl && (input === 'c' || input === 'd'))) {
      onClose('Release notes dismissed', { display: 'system' });
    }
  });

  const listWidth = useSideBySide
    ? Math.min(50, Math.max(34, Math.floor(columns * 0.35)))
    : undefined;
  const countColumnWidth = 11;

  const detail = !focusedEntry ? null : focusedEntry.kind === 'all' ? (
    renderAllNotes(notes)
  ) : (
    <Box flexDirection="column" gap={1}>
      <Text bold={true} color="claude">{focusedEntry.title}</Text>
      {renderNotes(focusedEntry.notes ?? [])}
    </Box>
  );

  return (
    <Pane color="professionalBlue">
      <Box flexDirection="column" gap={1}>
        <Text bold={true} color="professionalBlue">Release notes</Text>
        <Box flexDirection={useSideBySide ? 'row' : 'column'} gap={useSideBySide ? 0 : 1} marginTop={1}>
          {/* List */}
          <Box flexDirection="column" flexShrink={0} width={listWidth}>
            {entries.map((entry, index) => {
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
          </Box>

          {/* Separator */}
          {useSideBySide && (
            <Box flexShrink={0} marginLeft={2} marginRight={2}>
              <Text dimColor={true}>│</Text>
            </Box>
          )}

          {/* Detail — top-aligned with list, no extra header */}
          <Box flexDirection="column" flexGrow={1} minWidth={0}>
            {detail}
          </Box>
        </Box>
        <Text dimColor={true}>↑/↓ navigate · Enter/Esc close</Text>
      </Box>
    </Pane>
  );
}
