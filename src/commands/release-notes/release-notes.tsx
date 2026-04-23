// @ts-nocheck
import * as React from 'react';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { getAllReleaseNotes } from '../../utils/releaseNotes.js';
import { getStoredChangelog } from '../../utils/releaseNotes.js';
import { PRODUCT_RELEASE_NOTES_URL } from '../../constants/docs.js';
import { ReleaseNotes } from '../../components/ReleaseNotes/ReleaseNotes.js';

export const call: LocalJSXCommandCall = async (onDone) => {
  const notes = getAllReleaseNotes(await getStoredChangelog());
  if (notes.length === 0) {
    return (
      <ReleaseNotes
        notes={[]}
        onClose={() => onDone(`See the bundled release notes at: ${PRODUCT_RELEASE_NOTES_URL}`, { display: 'system' })}
      />
    );
  }

  return (
    <ReleaseNotes
      notes={notes}
      onClose={onDone}
    />
  );
};
