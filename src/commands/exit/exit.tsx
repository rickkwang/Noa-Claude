// @ts-nocheck
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { ExitFlow } from '../../components/ExitFlow.js';
import { getSessionCronTasks } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isBgSession, requestBgDetach } from '../../utils/background/bgJob.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';
const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];
function getRandomGoodbyeMessage(): string {
  return sample(GOODBYE_MESSAGES) ?? 'Goodbye!';
}
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  // A background session outlives its terminal: /exit lets go of it
  // (/stop ends the session).
  if (isBgSession()) {
    onDone(undefined, {
      display: 'skip'
    });
    requestBgDetach();
    return null;
  }
  const showWorktree = getCurrentWorktreeSession() !== null;
  const confirmScheduledTasks = getSessionCronTasks().length > 0 && !context.isTurnRunning?.() && !context.dispatchedAsImmediate;
  if (showWorktree || confirmScheduledTasks) {
    return <ExitFlow showWorktree={showWorktree} confirmScheduledTasks={confirmScheduledTasks} context={context} onDone={onDone} onCancel={() => onDone()} />;
  }
  onDone(getRandomGoodbyeMessage());
  await gracefulShutdown(0, 'prompt_input_exit');
  return null;
}
