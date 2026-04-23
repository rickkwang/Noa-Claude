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

function renderNotes(notes: string[], emptyLabel = 'No notes available.'): React.ReactNode {
  if (notes.length === 0) {
    return <Text dimColor={true}>{emptyLabel}</Text>;
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
        <Box key={version} flexDirection="column" gap={0}>
          <Text bold={true} color="claude">
            Version {version}
          </Text>
          <Box marginTop={0}>
            {renderNotes(notes)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function ReleaseNotes({ notes, onClose }: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const entries = useMemo<ReleaseNoteEntry[]>(() => {
    return [
      {
        kind: 'all',
        title: 'Show all',
        count: notes.length,
      },
      ...notes.map(([version, versionNotes]) => ({
        kind: 'version',
        title: `Version ${version}`,
        version,
        count: versionNotes.length,
        notes: versionNotes,
      })),
    ];
  }, [notes]);

  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    setFocusedIndex(0);
    setSelectedIndex(null);
  }, [entries.length]);

  useEffect(() => {
    setFocusedIndex(i => Math.max(0, Math.min(i, entries.length - 1)));
  }, [entries.length]);

  useEffect(() => {
    if (selectedIndex === null) {
      return;
    }
    if (selectedIndex >= entries.length) {
      setSelectedIndex(entries.length > 0 ? entries.length - 1 : null);
    }
  }, [entries.length, selectedIndex]);

  const focusedEntry = entries[focusedIndex];
  const selectedEntry = selectedIndex === null ? null : entries[selectedIndex] ?? null;

  useInput((input, key) => {
    if (key.upArrow || (key.ctrl && input === 'p')) {
      setFocusedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      setFocusedIndex(i => Math.min(entries.length - 1, i + 1));
      return;
    }
    if (key.return) {
      if (focusedEntry) {
        setSelectedIndex(focusedIndex);
      }
      return;
    }
    if (key.escape || (key.ctrl && (input === 'c' || input === 'd'))) {
      onClose('Release notes dismissed', { display: 'system' });
    }
  });

  const useSideBySide = columns >= 116;
  const listWidth = useSideBySide
    ? Math.min(50, Math.max(34, Math.floor(columns * 0.38)))
    : undefined;
  const countColumnWidth = 11;

  const detail = selectedEntry === null ? (
    <Text dimColor={true}>Select a version and press Enter to view its notes.</Text>
  ) : selectedEntry.kind === 'all' ? (
    renderAllNotes(notes)
  ) : (
    <Box flexDirection="column" gap={1}>
      <Text bold={true} color="claude">
        {selectedEntry.title}
      </Text>
      {renderNotes(selectedEntry.notes ?? [])}
    </Box>
  );

  return (
    <Pane color="professionalBlue">
      <Box flexDirection="column" gap={1}>
        <Text bold={true} color="professionalBlue">
          Release notes
        </Text>
        <Text dimColor={true}>Select a version to view its notes.</Text>
        <Box flexDirection={useSideBySide ? 'row' : 'column'} gap={2} marginTop={1}>
          <Box flexDirection="column" flexShrink={0} width={listWidth}>
            {entries.map((entry, index) => {
              const isFocused = index === focusedIndex;
              const isSelected = index === selectedIndex;
              const prefix = isFocused ? '>' : ' ';
              const labelColor = isFocused || isSelected ? 'professionalBlue' : undefined;
              const countLabel =
                entry.kind === 'all'
                  ? `${entry.count} ${plural(entry.count, 'version')}`
                  : `${entry.count} ${plural(entry.count, 'item')}`;

              return (
                <Box
                  key={entry.kind === 'all' ? 'all' : entry.version}
                  flexDirection="row"
                  justifyContent="space-between"
                  flexShrink={0}
                >
                  <Text color={labelColor} bold={isFocused || isSelected} wrap="truncate-end">
                    {prefix} {index + 1}. {entry.title}
                  </Text>
                  <Box width={countColumnWidth} justifyContent="flex-end" flexShrink={0}>
                    <Text dimColor={true}>{countLabel}</Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
          {useSideBySide ? (
            <Box flexShrink={0} marginLeft={1} marginRight={1}>
              <Text dimColor={true}>│</Text>
            </Box>
          ) : null}
          <Box flexDirection="column" flexGrow={1} marginTop={useSideBySide ? 0 : 1} minWidth={0}>
            <Box flexDirection="column" gap={1}>
              <Text bold={true}>Details</Text>
              {detail}
            </Box>
          </Box>
        </Box>
        <Text dimColor={true}>↑/↓ select · Enter view · Esc close</Text>
      </Box>
    </Pane>
  );
}
