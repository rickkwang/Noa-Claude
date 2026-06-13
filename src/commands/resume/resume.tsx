// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import type { UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js';
import type { CommandResultDisplay, ResumeEntrypoint } from '../../commands.js';
import { LogSelector } from '../../components/LogSelector.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { ResumeSummaryGate } from '../../components/ResumeSummaryGate.js';
import { Spinner } from '../../components/Spinner.js';
import { Select } from '../../components/CustomSelect/select.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { setClipboard } from '../../ink/termio/osc.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { LogOption } from '../../types/logs.js';
import { agenticSessionSearch } from '../../utils/agenticSessionSearch.js';
import { checkCrossProjectResume } from '../../utils/crossProjectResume.js';
import { logDebugDiagnosticWarn } from '../../utils/debugDiagnostics.js';
import { getErrnoCode } from '../../utils/errors.js';
import { getWorktreePaths } from '../../utils/getWorktreePaths.js';
import { logError } from '../../utils/log.js';
import { shouldUseResumeSummaryGate } from '../../utils/resumeSummaryGate.js';
import { getLastSessionLog, getSessionIdFromLog, isCustomTitleEnabled, isLiteLog, loadAllProjectsMessageLogs, loadFullLog, loadSameRepoMessageLogs, RESUME_PICKER_MAX_SESSIONS, searchSessionsByCustomTitle } from '../../utils/sessionStorage.js';
import { validateUuid } from '../../utils/uuid.js';
type ResumeResult = {
  resultType: 'sessionNotFound';
  arg: string;
} | {
  resultType: 'multipleMatches';
  arg: string;
};

type ResumeErrorCode =
  | 'SESSION_LIST_LOAD_IO_ERROR'
  | 'SESSION_LIST_LOAD_PERMISSION_ERROR'
  | 'SESSION_LIST_LOAD_PARSE_ERROR'
  | 'SESSION_LIST_LOAD_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_COMPAT_ERROR'
  | 'SESSION_RESTORE_INTERRUPTED'
  | 'SESSION_UNKNOWN_ERROR'

function classifyResumeListLoadError(error: unknown): {
  code: ResumeErrorCode
  message: string
} {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? 'unknown error')
  const normalized = rawMessage.toLowerCase()
  const errno = getErrnoCode(error)

  if (errno === 'EACCES' || errno === 'EPERM') {
    return {
      code: 'SESSION_LIST_LOAD_PERMISSION_ERROR',
      message:
        'Failed to load conversations due to file permission restrictions.',
    }
  }

  if (
    errno === 'ENOENT' ||
    errno === 'ENOTDIR' ||
    errno === 'EISDIR' ||
    errno === 'EIO' ||
    errno === 'EMFILE' ||
    errno === 'ENFILE'
  ) {
    return {
      code: 'SESSION_LIST_LOAD_IO_ERROR',
      message: 'Failed to load conversations due to local I/O issues.',
    }
  }

  if (
    normalized.includes('parse') ||
    normalized.includes('json') ||
    normalized.includes('invalid transcript')
  ) {
    return {
      code: 'SESSION_LIST_LOAD_PARSE_ERROR',
      message:
        'Failed to load conversations because session metadata is malformed.',
    }
  }

  return {
    code: 'SESSION_LIST_LOAD_FAILED',
    message: 'Failed to load conversations due to an unexpected error.',
  }
}

export function _classifyResumeListLoadErrorForTesting(
  error: unknown,
): ResumeErrorCode {
  return classifyResumeListLoadError(error).code
}

export function _formatResumeListLoadFailureForTesting(error?: unknown): string {
  const classified = classifyResumeListLoadError(error)
  return `${classified.message} Run /doctor if this persists. (${classified.code})`
}

export function _logResumeListLoadFailureForTesting(error: unknown): void {
  logDebugDiagnosticWarn('resume', 'failed to load conversation list', error)
}

function classifyResumeError(error: unknown): {
  code: ResumeErrorCode
  message: string
} {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? 'unknown error')
  const normalized = rawMessage.toLowerCase()
  const errno = getErrnoCode(error)

  if (errno === 'ENOENT' || errno === 'ENOTDIR') {
    return {
      code: 'SESSION_NOT_FOUND',
      message: 'Conversation not found. Check the session ID and try again.',
    }
  }

  if (errno === 'EACCES' || errno === 'EPERM') {
    return {
      code: 'SESSION_UNKNOWN_ERROR',
      message: 'Resume failed: insufficient permissions to read conversation.',
    }
  }

  if (
    normalized.includes('not found') ||
    normalized.includes('no conversation') ||
    normalized.includes('missing session')
  ) {
    return {
      code: 'SESSION_NOT_FOUND',
      message: 'Conversation not found. Check the session ID and try again.',
    }
  }

  if (
    normalized.includes('compat') ||
    normalized.includes('schema') ||
    normalized.includes('deserialize') ||
    normalized.includes('invalid transcript')
  ) {
    return {
      code: 'SESSION_COMPAT_ERROR',
      message: 'Conversation data is incompatible with this build.',
    }
  }

  if (
    normalized.includes('aborted') ||
    normalized.includes('interrupt') ||
    normalized.includes('cancel')
  ) {
    return {
      code: 'SESSION_RESTORE_INTERRUPTED',
      message: 'Resume was interrupted before completion.',
    }
  }

  return {
    code: 'SESSION_UNKNOWN_ERROR',
    message: 'Resume failed due to an unexpected error.',
  }
}

function resumeHelpMessage(result: ResumeResult): string {
  switch (result.resultType) {
    case 'sessionNotFound':
      return `Session ${chalk.bold(result.arg)} was not found.`;
    case 'multipleMatches':
      return `Found multiple sessions matching ${chalk.bold(result.arg)}. Please use /resume to pick a specific session.`;
  }
}
function ResumeError(t0) {
  const $ = _c(10);
  const {
    message,
    args,
    onDone
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onDone) {
    t1 = () => {
      const timer = setTimeout(onDone, 0);
      return () => clearTimeout(timer);
    };
    t2 = [onDone];
    $[0] = onDone;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  React.useEffect(t1, t2);
  let t3;
  if ($[3] !== args) {
    t3 = <Text dimColor={true}>{figures.pointer} /resume {args}</Text>;
    $[3] = args;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== message) {
    t4 = <MessageResponse><Text>{message}</Text></MessageResponse>;
    $[5] = message;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== t3 || $[8] !== t4) {
    t5 = <Box flexDirection="column">{t3}{t4}</Box>;
    $[7] = t3;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}

function ResumeCommand({
  onDone,
  onResume
}: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onResume: (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => Promise<void>;
}): React.ReactNode {
  const [logs, setLogs] = React.useState<LogOption[]>([]);
  const [worktreePaths, setWorktreePaths] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [resuming, setResuming] = React.useState(false);
  const [summaryGateTarget, setSummaryGateTarget] = React.useState<{
    sessionId: UUID;
    log: LogOption;
  } | null>(null);
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const {
    rows,
    columns
  } = useTerminalSize();
  const insideModal = useIsInsideModal();
  // Store onDone in a ref so loadLogs doesn't need to re-run when the parent
  // re-renders with a new callback reference (avoids spurious reload of the list).
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;
  const loadGenRef = React.useRef(0);
  const loadLogs = React.useCallback(async (allProjects: boolean, paths: string[]) => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      const allLogs = allProjects
        ? await loadAllProjectsMessageLogs(undefined, { initialEnrichCount: RESUME_PICKER_MAX_SESSIONS })
        : await loadSameRepoMessageLogs(paths, undefined, RESUME_PICKER_MAX_SESSIONS);
      if (gen !== loadGenRef.current) return;
      const resumable = filterResumableSessions(allLogs, getSessionId());
      if (resumable.length === 0) {
        onDoneRef.current('No conversations found to resume');
        return;
      }
      setLogs(resumable);
    } catch (error) {
      if (gen !== loadGenRef.current) return;
      logError(error as Error);
      _logResumeListLoadFailureForTesting(error);
      onDoneRef.current(_formatResumeListLoadFailureForTesting(error));
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    async function init() {
      const paths_0 = await getWorktreePaths(getOriginalCwd());
      setWorktreePaths(paths_0);
      void loadLogs(false, paths_0);
    }
    void init();
  }, [loadLogs]);
  const handleToggleAllProjects = React.useCallback(() => {
    const newValue = !showAllProjects;
    setShowAllProjects(newValue);
    void loadLogs(newValue, worktreePaths);
  }, [showAllProjects, loadLogs, worktreePaths]);
  const handleSelect = React.useCallback(async (log: LogOption) => {
    const sessionId = validateUuid(getSessionIdFromLog(log));
    if (!sessionId) {
      onDoneRef.current('Failed to resume conversation');
      return;
    }

    // Load full messages for lite logs
    const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;

    // Check if this conversation is from a different directory
    const crossProjectCheck = checkCrossProjectResume(fullLog, showAllProjects, worktreePaths);
    if (crossProjectCheck.isCrossProject) {
      if (crossProjectCheck.isSameRepoWorktree) {
        // Same repo worktree - can resume directly
        setResuming(true);
        void onResume(sessionId, fullLog, 'slash_command_picker').finally(() => setResuming(false));
        return;
      }

      // Different project - show command instead of resuming
      const raw = await setClipboard(crossProjectCheck.command);
      if (raw) process.stdout.write(raw);

      // Format the output message
      const message = ['', 'This conversation is from a different directory.', '', 'To resume, run:', `  ${crossProjectCheck.command}`, '', '(Command copied to clipboard)', ''].join('\n');
      onDoneRef.current(message, {
        display: 'user'
      });
      return;
    }

    // Same directory - proceed with resume
    if (shouldShowResumeSummaryGate(fullLog)) {
      setSummaryGateTarget({
        sessionId,
        log: fullLog
      });
      return;
    }
    setResuming(true);
    void onResume(sessionId, fullLog, 'slash_command_picker').finally(() => setResuming(false));
  }, [showAllProjects, worktreePaths, onResume]);
  function handleCancel() {
    onDoneRef.current('Resume cancelled', {
      display: 'system'
    });
  }
  if (loading) {
    return <Box>
        <Spinner />
        <Text> Loading conversations…</Text>
      </Box>;
  }
  if (resuming) {
    return <Box>
        <Spinner />
        <Text> Resuming conversation…</Text>
      </Box>;
  }
  if (summaryGateTarget) {
    return <ResumeSummaryGate log={summaryGateTarget.log} useMessageResponse onContinue={() => {
      setSummaryGateTarget(null);
      setResuming(true);
      void onResume(summaryGateTarget.sessionId, summaryGateTarget.log, 'slash_command_picker').finally(() => setResuming(false));
    }} onBack={() => setSummaryGateTarget(null)} />;
  }
  return <LogSelector logs={logs} maxHeight={insideModal ? Math.floor(rows / 2) : rows - 2} forceWidth={insideModal ? Math.max(0, columns - 4) : undefined} showTopDivider={!insideModal} onCancel={handleCancel} onSelect={handleSelect} onLogsChanged={() => loadLogs(showAllProjects, worktreePaths)} showAllProjects={showAllProjects} onToggleAllProjects={handleToggleAllProjects} onAgenticSearch={agenticSessionSearch} />;
}
export function filterResumableSessions(logs: LogOption[], currentSessionId: string): LogOption[] {
  return logs.filter(l => !l.isSidechain && getSessionIdFromLog(l) !== currentSessionId);
}
function shouldShowResumeSummaryGate(log: LogOption): boolean {
  try {
    return shouldUseResumeSummaryGate(log);
  } catch (error) {
    logError(error as Error);
    return false;
  }
}
export const _shouldShowResumeSummaryGateForTesting = shouldShowResumeSummaryGate;
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const onResume = async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
    try {
      await context.resume?.(sessionId, log, entrypoint);
      onDone(undefined, {
        display: 'skip'
      });
    } catch (error) {
      logError(error as Error);
      const classified = classifyResumeError(error)
      onDone(`${classified.message} (${classified.code})`)
    }
  };
  const arg = args?.trim();
  const maybeSessionId = validateUuid(arg);

  // No argument provided - show picker
  if (!arg) {
    return <ResumeCommand onDone={onDone} onResume={onResume} />;
  }

  const resumeOrGate = (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint): React.ReactNode => {
    if (shouldShowResumeSummaryGate(log)) {
      return <ResumeSummaryGate log={log} useMessageResponse onContinue={() => {
        void onResume(sessionId, log, entrypoint);
      }} onBack={() => onDone('Resume cancelled', {
        display: 'system'
      })} backLabel="Cancel" />;
    }
    void onResume(sessionId, log, entrypoint);
    return null;
  };

  if (maybeSessionId) {
    let directLog: LogOption | null = null
    try {
      directLog = await getLastSessionLog(maybeSessionId);
    } catch (error) {
      logError(error as Error);
      const classified = classifyResumeError(error)
      const message = `${classified.message} (${classified.code})`
      return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />
    }
    if (directLog) {
      return resumeOrGate(maybeSessionId, directLog, 'slash_command_session_id');
    }

    const message = resumeHelpMessage({
      resultType: 'sessionNotFound',
      arg
    });
    return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
  }

  // Try exact custom title match (only if feature is enabled)
  if (isCustomTitleEnabled()) {
    const titleMatches = await searchSessionsByCustomTitle(arg, {
      exact: true,
      stopAfterDistinctMatches: 2
    });
    if (titleMatches.length === 1) {
      const log = titleMatches[0]!;
      const sessionId = getSessionIdFromLog(log);
      if (sessionId) {
        const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
        return resumeOrGate(sessionId, fullLog, 'slash_command_title');
      }
    }

    if (titleMatches.length > 1) {
      const message = resumeHelpMessage({
        resultType: 'multipleMatches',
        arg
      });
      return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
    }
  }

  // Direct arg paths only need to know whether any resumable same-repo
  // sessions exist before returning "not found", so keep this probe cheap.
  const worktreePaths = await getWorktreePaths(getOriginalCwd());
  let logs: LogOption[]
  try {
    logs = await loadSameRepoMessageLogs(worktreePaths, 1, 1);
  } catch (error) {
    logError(error as Error)
    _logResumeListLoadFailureForTesting(error)
    const message = _formatResumeListLoadFailureForTesting(error)
    return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />
  }
  if (logs.length === 0) {
    const message = 'No conversations found to resume.';
    return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
  }

  // No match found - show error
  const message = resumeHelpMessage({
    resultType: 'sessionNotFound',
    arg
  });
  return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
};
