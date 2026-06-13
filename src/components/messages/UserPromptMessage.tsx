// @ts-nocheck
import { feature } from 'bun:bundle';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useContext, useMemo } from 'react';
import { getKairosActive, getUserMsgOptIn } from '../../bootstrap/state.js';
import { Box, Text } from '../../ink.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useAppState } from '../../state/AppState.js';
import { getGlobalConfig } from '../../utils/config.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { logError } from '../../utils/log.js';
import { countCharInString } from '../../utils/stringUtils.js';
import { truncateToWidth } from '../../utils/truncate.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { HighlightedThinkingText } from './HighlightedThinkingText.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useQueuedMessage } from '../../context/QueuedMessageContext.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  isTranscriptMode?: boolean;
  timestamp?: string;
  highlightedPrefix?: string;
};

// Hard cap on displayed prompt text. Piping large files via stdin
// (e.g. `cat 11k-line-file | claude`) creates a single user message whose
// <Text> node the fullscreen Ink renderer must wrap/output on every frame,
// causing 500ms+ keystroke latency. React.memo skips the React render but
// the Ink output pass still iterates the full mounted text. Non-fullscreen
// avoids this via <Static> (print-and-forget to terminal scrollback).
// Head+tail because `{ cat file; echo prompt; } | claude` puts the user's
// actual question at the end.
const MAX_DISPLAY_CHARS = 10_000;
const TRUNCATE_HEAD_CHARS = 2_500;
const TRUNCATE_TAIL_CHARS = 2_500;
export function UserPromptMessage({
  addMargin,
  param: {
    text
  },
  isTranscriptMode,
  timestamp,
  highlightedPrefix
}: Props): React.ReactNode {
  // REPL.tsx passes isBriefOnly={viewedTeammateTask ? false : isBriefOnly}
  // but that prop isn't threaded this deep — replicate the override by
  // reading viewingAgentTaskId directly. Computed here (not in the child)
  // so the parent Box can drop its backgroundColor: in brief mode the
  // child renders a label-style layout, and Box backgroundColor paints
  // behind children unconditionally (they can't opt out).
  //
  // Hooks stay INSIDE feature() ternaries so external builds don't pay
  // the per-scrollback-message store subscription (useSyncExternalStore
  // bypasses React.memo). Runtime-gated like isBriefEnabled() but inlined
  // to avoid pulling BriefTool.ts → prompt.ts tool-name strings into
  // external builds.
  const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s => s.isBriefOnly) : false;
  const viewingAgentTaskId = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s_0 => s_0.viewingAgentTaskId) : null;
  // Hoisted to mount-time — per-message component, re-renders on every scroll.
  const briefEnvEnabled = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_BRIEF), []) : false;
  const useBriefLayout = feature('KAIROS') || feature('KAIROS_BRIEF') ? (getKairosActive() || getUserMsgOptIn() && (briefEnvEnabled || getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_brief', false))) && isBriefOnly && !isTranscriptMode && !viewingAgentTaskId : false;

  // Truncate before the early return so the hook order is stable.
  const displayText = useMemo(() => {
    if (text.length <= MAX_DISPLAY_CHARS) return text;
    const head = text.slice(0, TRUNCATE_HEAD_CHARS);
    const tail = text.slice(-TRUNCATE_TAIL_CHARS);
    const hiddenLines = countCharInString(text, '\n', TRUNCATE_HEAD_CHARS) - countCharInString(tail, '\n');
    return `${head}\n… +${hiddenLines} lines …\n${tail}`;
  }, [text]);
  const isSelected = useContext(MessageActionsSelectedContext);
  const queuedMessage = useQueuedMessage();
  const { columns } = useTerminalSize();
  if (!text) {
    logError(new Error('No content found in user prompt message'));
    return null;
  }
  if (useBriefLayout) {
    return (
      <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor={isSelected ? 'messageActionsBackground' : undefined} paddingRight={0}>
        <HighlightedThinkingText text={displayText} useBriefLayout={true} timestamp={timestamp} showPointer={false} />
      </Box>
    );
  }
  const safeColumns = Math.max(0, columns);
  // Match the actual drawable width inside the queued-message container.
  // Over-reserving columns here makes the frame visibly shorter than the
  // terminal width, especially in wide windows.
  const frameColumns = Math.max(0, safeColumns - (queuedMessage?.paddingWidth ?? 0));
  const displayName = getGlobalConfig().oauthAccount?.displayName?.trim() || 'You';
  const maxHeaderNameWidth = Math.max(0, frameColumns - stringWidth('╭─ ╮'));
  const headerName = truncateToWidth(displayName, maxHeaderNameWidth);
  const headerLabel = `─ ${headerName} `;
  const headerFill = Math.max(0, frameColumns - stringWidth(`╭${headerLabel}╮`));
  const footerFill = Math.max(0, frameColumns - stringWidth('╰╯'));
  const autoCommandPrefix = !highlightedPrefix && displayText.startsWith('/') ? (displayText.match(/^\/\S+/)?.[0] ?? '') : '';
  const effectivePrefix = highlightedPrefix || autoCommandPrefix;
  const shouldHighlightPrefix = !!effectivePrefix && displayText.startsWith(effectivePrefix);
  const highlightedRest = shouldHighlightPrefix ? displayText.slice(effectivePrefix.length) : displayText;
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      <Text color="claude">{`╭${headerLabel}${'─'.repeat(headerFill)}╮`}</Text>
      <Box backgroundColor={isSelected ? 'messageActionsBackground' : undefined} paddingLeft={2} paddingRight={useBriefLayout ? 0 : 2} width={frameColumns}>
        {shouldHighlightPrefix ? (
          <Box flexDirection="row">
            <Box backgroundColor="userMessageBackground" paddingX={1}>
              <Text color="text">{effectivePrefix}</Text>
            </Box>
            {highlightedRest ? <Text color="text">{highlightedRest}</Text> : null}
          </Box>
        ) : (
          <HighlightedThinkingText text={displayText} useBriefLayout={useBriefLayout} timestamp={useBriefLayout ? timestamp : undefined} showPointer={false} />
        )}
      </Box>
      <Text color="claude">{`╰${'─'.repeat(footerFill)}╯`}</Text>
    </Box>
  );
}
