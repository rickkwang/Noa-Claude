// @ts-nocheck
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { Select } from '../CustomSelect/select.js';
import { Byline } from '../design-system/Byline.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { Pane } from '../design-system/Pane.js';
import { plural } from '../../utils/stringUtils.js';
import { formatAllReleaseNotes, formatReleaseNotesForVersion } from '../../utils/releaseNotes.js';

const SHOW_ALL = '__show_all__';

type Props = {
  notes: Array<[string, string[]]>;
  onSelect: (text: string) => void;
  onCancel: () => void;
};

export function ReleaseNotesPicker({ notes, onSelect, onCancel }: Props): React.ReactNode {
  const options = [
    { label: 'Show all', value: SHOW_ALL, description: `${notes.length} ${plural(notes.length, 'version')}` },
    ...notes.map(([version, versionNotes]) => ({
      label: `Version ${version}`,
      value: version,
      description: `${versionNotes.length} ${plural(versionNotes.length, 'item')}`,
    })),
  ];

  const handleChange = (value: string) => {
    if (value === SHOW_ALL) {
      onSelect(formatAllReleaseNotes(notes));
      return;
    }
    const entry = notes.find(([version]) => version === value);
    if (!entry) {
      onCancel();
      return;
    }
    onSelect(formatReleaseNotesForVersion(entry[0], entry[1]));
  };

  return (
    <Pane color="professionalBlue">
      <Box flexDirection="column" gap={1}>
        <Text bold={true}>Release notes</Text>
        <Text dimColor={true}>Select a version to view its notes.</Text>
        <Select options={options} visibleOptionCount={10} onChange={handleChange} onCancel={onCancel} />
        <Text dimColor={true}>
          <Byline>
            <KeyboardShortcutHint shortcut="esc" action="cancel" />
          </Byline>
        </Text>
      </Box>
    </Pane>
  );
}
