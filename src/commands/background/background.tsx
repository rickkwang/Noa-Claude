import * as React from 'react';
import { useEffect, useRef } from 'react';
import { abandonableTasks, BackgroundConfirmDialog } from '../../components/BackgroundConfirmDialog.js';
import { Text } from '../../ink.js';
import type { LocalJSXCommandCall, LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { isBgSession, requestBgDetach } from '../../utils/background/bgJob.js';
import { forkToBackground, formatBackgrounded, hasConversationToBackground } from '../../utils/background/fork.js';
import { getBackgroundBlock, getQueuedMessagesBlock } from '../../utils/background/gate.js';
import { stopTurnForHandoff } from '../../utils/background/handoff.js';
import { errorMessage } from '../../utils/errors.js';
import { gracefulShutdown, suppressResumeHint } from '../../utils/gracefulShutdown.js';

/**
 * /background: fork this conversation into a background session and exit,
 * freeing the terminal (← on an empty prompt is the gesture that opens the
 * agents view instead). Typed while a turn runs, the turn is stopped and the
 * background session finishes it.
 */
async function moveToBackground(prompt: string, context: LocalJSXCommandContext, onDone: LocalJSXCommandOnDone): Promise<void> {
  const midTurn = context.dispatchedAsImmediate === true;
  let short: string;
  try {
    const prefill = midTurn ? await stopTurnForHandoff() : undefined;
    short = await forkToBackground({
      appState: context.getAppState(),
      prompt: prompt || undefined,
      replyOnResume: midTurn,
      prefill
    });
  } catch (e) {
    onDone(`Couldn't background this session — ${errorMessage(e)}`, {
      display: 'system'
    });
    return;
  }
  onDone(undefined, {
    display: 'skip'
  });
  // Resuming the original here would run the conversation twice.
  suppressResumeHint();
  await gracefulShutdown(0, 'prompt_input_exit', {
    finalMessage: formatBackgrounded(short)
  });
}

function Backgrounding({
  prompt,
  context,
  onDone
}: {
  prompt: string;
  context: LocalJSXCommandContext;
  onDone: LocalJSXCommandOnDone;
}): React.ReactNode {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void moveToBackground(prompt, context, onDone);
  }, [prompt, context, onDone]);
  return <Text dimColor>Backgrounding…</Text>;
}

function ConfirmThenBackground(props: {
  prompt: string;
  context: LocalJSXCommandContext;
  onDone: LocalJSXCommandOnDone;
  count: number;
  summary: string;
}): React.ReactNode {
  const [confirmed, setConfirmed] = React.useState(false);
  if (confirmed) return <Backgrounding prompt={props.prompt} context={props.context} onDone={props.onDone} />;
  return <BackgroundConfirmDialog count={props.count} summary={props.summary} onConfirm={() => setConfirmed(true)} onCancel={() => props.onDone(undefined, {
    display: 'skip'
  })} />;
}

export const call: LocalJSXCommandCall = async (onDone, context, args): Promise<React.ReactNode> => {
  // Already a background session: /bg just returns to the agents view.
  if (isBgSession()) {
    onDone(undefined, {
      display: 'skip'
    });
    requestBgDetach();
    return null;
  }
  const block = getBackgroundBlock();
  if (block) {
    onDone(block === 'persistence' ? 'Cannot background — session persistence is disabled, so the forked job would have nothing to resume.' : 'Cannot background — background sessions are not available here.', {
      display: 'system'
    });
    return null;
  }
  const queuedBlock = getQueuedMessagesBlock();
  if (queuedBlock) {
    onDone(`Cannot background — ${queuedBlock[0]}. ${queuedBlock[1]}`, {
      display: 'system'
    });
    return null;
  }
  const prompt = (args ?? '').trim();
  if (!prompt && !hasConversationToBackground(context.messages)) {
    onDone('Nothing to background yet — send a message first.', {
      display: 'system'
    });
    return null;
  }
  const tasks = abandonableTasks(context.getAppState().tasks);
  if (tasks.count > 0) {
    return <ConfirmThenBackground prompt={prompt} context={context} onDone={onDone} count={tasks.count} summary={tasks.summary} />;
  }
  return <Backgrounding prompt={prompt} context={context} onDone={onDone} />;
};
