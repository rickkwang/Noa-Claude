import sample from 'lodash-es/sample.js';
import React, { useState } from 'react';
import { getSessionCronTasks } from '../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../commands.js';
import { stopSessionCronTasks } from '../utils/cronResume.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { recordTranscript } from '../utils/sessionStorage.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { WorktreeExitDialog } from './WorktreeExitDialog.js';

const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];

type Props = {
  onDone: (message?: string) => void;
  onCancel: () => void;
  showWorktree: boolean;
  confirmScheduledTasks: boolean;
  context: LocalJSXCommandContext;
};

export function ExitFlow({ onDone, onCancel, showWorktree, confirmScheduledTasks, context }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  async function exit(message?: string, stopSchedules = confirmed) {
    if (stopSchedules && !context.isTurnRunning?.()) {
      const messages = stopSessionCronTasks(getSessionCronTasks().map(task => task.id), context.setMessages);
      if (messages) await recordTranscript(messages);
    }
    onDone(message ?? sample(GOODBYE_MESSAGES) ?? 'Goodbye!');
    await gracefulShutdown(0, 'prompt_input_exit');
  }
  if (confirmScheduledTasks && !confirmed) {
    return <Dialog title="Scheduled work is pending" subtitle="This session’s scheduled tasks will not run again on resume." onCancel={onCancel}>
      <Select options={[{ label: 'Exit and stop tasks', value: 'exit' }, { label: 'Stay', value: 'stay' }]} defaultFocusValue="stay" onChange={(value: 'exit' | 'stay') => {
        if (value === 'stay') onCancel();
        else if (showWorktree) setConfirmed(true);
        else void exit(undefined, true);
      }} />
    </Dialog>;
  }
  return showWorktree ? <WorktreeExitDialog onDone={message => exit(message)} onCancel={onCancel} /> : null;
}
