// @ts-nocheck
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useInterval } from 'usehooks-ts';
import type { CommandResultDisplay } from '../../commands.js';
import { Byline } from '../../components/design-system/Byline.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { Markdown } from '../../components/Markdown.js';
import { SpinnerGlyph } from '../../components/Spinner/SpinnerGlyph.js';
import { getSystemPrompt } from '../../constants/prompts.js';
import { useModalOrTerminalSize } from '../../context/modalContext.js';
import { getSystemContext, getUserContext } from '../../context.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import ScrollBox, { type ScrollBoxHandle } from '../../ink/components/ScrollBox.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { setClipboard } from '../../ink/termio/osc.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { createAbortController } from '../../utils/abortController.js';
import { type BtwExchange, getBtwHistory } from '../../utils/btwHistory.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { errorMessage } from '../../utils/errors.js';
import { type CacheSafeParams, getLastCacheSafeParams } from '../../utils/forkedAgent.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js';
import { runSideQuestion, type SideQuestionRetry } from '../../utils/sideQuestion.js';
import { asSystemPrompt } from '../../utils/systemPromptType.js';
import { truncateToWidth } from '../../utils/truncate.js';
import { stepBrowse, VISIBLE_HISTORY } from './browse.js';
type BtwComponentProps = {
  question: string;
  /** Reopening the last exchange (bare `/btw`): show it, don't ask again. */
  initialResponse?: string;
  context: ProcessUserInputContext;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type RetryState = SideQuestionRetry & {
  retryAt: number;
};
const CHROME_ROWS = 5;
const OUTER_CHROME_ROWS = 6;
const SCROLL_LINES = 3;
const COPIED_NOTICE_MS = 2000;
function BtwSideQuestion({
  question,
  initialResponse,
  context,
  onDone
}: BtwComponentProps) {
  const history = getBtwHistory();
  const [response, setResponse] = useState<string | null>(initialResponse ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<RetryState | null>(null);
  const [frame, setFrame] = useState(0);
  // Earlier exchanges, snapshotted at open: the answer to this question lands
  // in history while the panel is up, and must not list itself above itself.
  const [previous, setPrevious] = useState<readonly BtwExchange[]>(() => initialResponse !== undefined ? history.exchanges.slice(0, -1) : history.exchanges);
  const previousRef = useRef(previous);
  const browsedRef = useRef<number | null>(null);
  const [browsed, setBrowsed] = useState<number | null>(null);
  const [copyCount, setCopyCount] = useState(0);
  const dismissedRef = useRef(false);
  const scrollRef = useRef<ScrollBoxHandle>(null);
  const {
    rows,
    columns
  } = useModalOrTerminalSize(useTerminalSize());
  useInterval(() => setFrame(f => f + 1), response || error ? null : 80);
  useEffect(() => {
    if (!copyCount) return;
    const timer = setTimeout(setCopyCount, COPIED_NOTICE_MS, 0);
    return () => clearTimeout(timer);
  }, [copyCount]);
  function close() {
    dismissedRef.current = true;
    onDone(undefined, {
      display: 'skip'
    });
  }
  function showBrowsed(next: number | null) {
    browsedRef.current = next;
    setBrowsed(next);
    scrollRef.current?.scrollTo(0);
  }
  function browse(direction: 'older' | 'newer', wrap = false) {
    const next = stepBrowse(previousRef.current.length, browsedRef.current, direction, wrap);
    if (next !== browsedRef.current) showBrowsed(next);
  }
  function handleKeyDown(e: KeyboardEvent) {
    const plain = !e.ctrl && !e.meta;
    if (e.key === 'escape' || e.key === 'return' || e.key === ' ' || e.ctrl && (e.key === 'c' || e.key === 'd')) {
      e.preventDefault();
      close();
      return;
    }
    if ((e.key === '[' || e.key === ']') && plain) {
      e.preventDefault();
      browse(e.key === '[' ? 'older' : 'newer');
      return;
    }
    if (e.key === 'tab' && plain) {
      e.preventDefault();
      browse(e.shift ? 'newer' : 'older', true);
      return;
    }
    if (e.key === 'left' || e.key === 'right') {
      e.preventDefault();
      if (e.shift && !(e.ctrl || e.meta || e.fn || e.superKey)) {
        browse(e.key === 'left' ? 'older' : 'newer');
      }
      return;
    }
    if (e.key === 'x' && plain && previousRef.current.length > 0) {
      e.preventDefault();
      const cleared = new Set(previousRef.current);
      history.replace(history.exchanges.filter(exchange => !cleared.has(exchange)));
      previousRef.current = [];
      setPrevious([]);
      showBrowsed(null);
      return;
    }
    const shownResponse = browsedRef.current !== null ? previousRef.current[browsedRef.current]?.response : response;
    if (e.key === 'c' && plain && shownResponse) {
      e.preventDefault();
      // setClipboard returns the OSC 52 sequence; the caller writes it.
      void setClipboard(shownResponse).then(raw => {
        if (raw) process.stdout.write(raw);
      });
      setCopyCount(n => n + 1);
      return;
    }
    if (e.key === 'up' || e.ctrl && e.key === 'p') {
      e.preventDefault();
      scrollRef.current?.scrollBy(-SCROLL_LINES);
    }
    if (e.key === 'down' || e.ctrl && e.key === 'n') {
      e.preventDefault();
      scrollRef.current?.scrollBy(SCROLL_LINES);
    }
  }
  useEffect(() => {
    if (initialResponse !== undefined) return;
    const abortController = createAbortController();
    void (async () => {
      let result;
      try {
        result = await runSideQuestion({
          question,
          cacheSafeParams: await buildCacheSafeParams(context),
          abortController,
          onRetry: next => {
            if (abortController.signal.aborted) return;
            setRetry({
              ...next,
              retryAt: Date.now() + next.retryInMs
            });
          }
        });
      } catch (err) {
        if (abortController.signal.aborted) return;
        showBrowsed(null);
        setError(errorMessage(err) || 'Failed to get response');
        return;
      }
      if (abortController.signal.aborted || result.aborted) return;
      showBrowsed(null);
      if (result.response) {
        setResponse(result.response);
      } else {
        setError('No response received');
      }
    })();
    return () => {
      // Only a dismissal cancels the question. If the panel is torn down any
      // other way, let it finish so the answer still lands in /btw history.
      if (dismissedRef.current) abortController.abort();
    };
  }, [question, context, initialResponse]);
  const listed = previous.slice(-VISIBLE_HISTORY);
  const hiddenCount = previous.length - listed.length;
  const browsedExchange = browsed !== null ? previous[browsed] : null;
  const historyRows = listed.length + (hiddenCount > 0 ? 1 : 0);
  const questionWidth = Math.max(20, columns - 7);
  const maxContentHeight = Math.max(5, rows - CHROME_ROWS - OUTER_CHROME_ROWS - historyRows);
  return <Box flexDirection="column" paddingLeft={2} marginTop={1} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>
      {hiddenCount > 0 && <Text dimColor={true}>(+{hiddenCount} earlier /btw)</Text>}
      {listed.map((exchange, i) => {
      const index = hiddenCount + i;
      return <Text key={index} dimColor={browsed !== index} bold={browsed === index}>
            /btw {oneLine(exchange.question, questionWidth)}
          </Text>;
    })}
      <Text>
        <Text color={browsedExchange ? undefined : 'warning'} bold={!browsedExchange} dimColor={!!browsedExchange}>
          /btw{' '}
        </Text>
        <Text dimColor={true}>{oneLine(question, questionWidth)}</Text>
      </Text>
      <Box marginTop={1} marginLeft={2} maxHeight={maxContentHeight}>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1} stickyScroll={false}>
          {browsedExchange ? <Markdown>{browsedExchange.response}</Markdown> : error ? <Text color="error">{error}</Text> : response ? <Markdown>{response}</Markdown> : <AnsweringStatus frame={frame} retry={retry} />}
        </ScrollBox>
      </Box>
      <Box marginTop={1}>
        <Text dimColor={true}>
          <Byline>
            {previous.length > 0 ? <KeyboardShortcutHint shortcut={'⇧←/→'} action="browse" /> : (browsedExchange || response || error) && <KeyboardShortcutHint shortcut={'↑/↓'} action="scroll" />}
            {(browsedExchange || response) && (copyCount > 0 ? <Text color="success">Copied to clipboard</Text> : <KeyboardShortcutHint shortcut="c" action="copy" />)}
            {previous.length > 0 && <KeyboardShortcutHint shortcut="x" action="clear history" />}
            <KeyboardShortcutHint shortcut="Esc" action="close" />
          </Byline>
        </Text>
      </Box>
    </Box>;
}
function AnsweringStatus({
  frame,
  retry
}: {
  frame: number;
  retry: RetryState | null;
}) {
  // Once the backoff elapses the retry is in flight; a "retrying in 0s" line
  // would read as still stuck.
  if (!retry || retry.retryAt <= Date.now()) {
    return <Box>
        <SpinnerGlyph frame={frame} messageColor="warning" />
        <Text color="warning">Answering…</Text>
      </Box>;
  }
  const seconds = Math.max(0, Math.ceil((retry.retryAt - Date.now()) / 1000));
  return <Box>
      <SpinnerGlyph frame={frame} messageColor="warning" />
      <Text color="warning">{retryLabel(retry.status)}</Text>
      <Text dimColor={true}>
        {' · retrying in '}
        {seconds}
        {'s · attempt '}
        {retry.retryAttempt}/{retry.maxRetries}
      </Text>
    </Box>;
}
function retryLabel(status: number | undefined): string {
  switch (status) {
    case 429:
      return 'Rate limited';
    case 529:
      return 'API overloaded';
    case 401:
    case 403:
      return 'Authentication failed';
    default:
      return 'API error';
  }
}
function oneLine(text: string, width: number): string {
  return truncateToWidth(text.replace(/\s+/g, ' ').trim(), width);
}

/**
 * Build CacheSafeParams for the side question fork.
 *
 * The preferred source is getLastCacheSafeParams — the exact
 * systemPrompt/userContext/systemContext bytes the main thread sent on its
 * last request (captured in stopHooks). Reusing them guarantees a byte-
 * identical prefix and thus a prompt cache hit. We pair these with the
 * current toolUseContext (for thinkingConfig/tools) and current messages
 * (for up-to-date context).
 *
 * Fallback (first turn before stop hooks fire, or prompt-suggestion
 * disabled): rebuild from scratch. This may miss the cache if the main loop
 * applied buildEffectiveSystemPrompt extras (--agent, --system-prompt,
 * --append-system-prompt, coordinator mode).
 */
function stripInProgressAssistantMessage(messages: Message[]): Message[] {
  const last = messages.at(-1);
  if (last?.type === 'assistant' && last.message.stop_reason === null) {
    return messages.slice(0, -1);
  }
  return messages;
}
async function buildCacheSafeParams(context: ProcessUserInputContext): Promise<CacheSafeParams> {
  const forkContextMessages = getMessagesAfterCompactBoundary(stripInProgressAssistantMessage(context.messages));
  const saved = getLastCacheSafeParams();
  if (saved) {
    return {
      systemPrompt: saved.systemPrompt,
      userContext: saved.userContext,
      systemContext: saved.systemContext,
      toolUseContext: context,
      forkContextMessages
    };
  }
  const [rawSystemPrompt, userContext, systemContext] = await Promise.all([getSystemPrompt(context.options.tools, context.options.mainLoopModel, [], context.options.mcpClients), getUserContext(), getSystemContext()]);
  return {
    systemPrompt: asSystemPrompt(rawSystemPrompt),
    userContext,
    systemContext,
    toolUseContext: context,
    forkContextMessages
  };
}
export async function call(onDone: LocalJSXCommandOnDone, context: ProcessUserInputContext, args: string): Promise<React.ReactNode> {
  const question = args?.trim();
  if (!question) {
    // Bare /btw reopens the last answer instead of asking nothing.
    const last = getBtwHistory().exchanges.at(-1);
    if (!last) {
      onDone('Usage: /btw <your question>', {
        display: 'system'
      });
      return null;
    }
    return <BtwSideQuestion question={last.question} initialResponse={last.response} context={context} onDone={onDone} />;
  }
  saveGlobalConfig(current => ({
    ...current,
    btwUseCount: current.btwUseCount + 1
  }));
  return <BtwSideQuestion question={question} context={context} onDone={onDone} />;
}
