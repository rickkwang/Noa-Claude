// @ts-nocheck
import * as React from 'react';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { getAllReleaseNotes, getStoredChangelog } from '../../utils/releaseNotes.js';
import { createReleaseNotesMessage } from '../../utils/messages.js';
import { PRODUCT_RELEASE_NOTES_URL } from '../../constants/docs.js';
import { ReleaseNotesPicker } from '../../components/ReleaseNotes/ReleaseNotes.js';

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const notes = getAllReleaseNotes(await getStoredChangelog());
  if (notes.length === 0) {
    context.setMessages(prev => [...prev, createReleaseNotesMessage(`See the full changelog at: ${PRODUCT_RELEASE_NOTES_URL}`)]);
    onDone(undefined, { display: 'skip' });
    return null;
  }

  return (
    <ReleaseNotesPicker
      notes={notes}
      onSelect={text => {
        context.setMessages(prev => [...prev, createReleaseNotesMessage(text)]);
        onDone(undefined, { display: 'skip' });
      }}
      onCancel={() => onDone(undefined, { display: 'skip' })}
    />
  );
};
