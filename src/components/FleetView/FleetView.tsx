/**
 * The agents view: every background session, grouped by whether it needs
 * the user, is working, or has finished. Enter opens (attaches to) a
 * session; typing a task and pressing enter starts a new one.
 */
import { basename } from 'path';
import stripAnsi from 'strip-ansi';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDoublePress } from '../../hooks/useDoublePress.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text, useInput } from '../../ink.js';
import { AlternateScreen } from '../../ink/components/AlternateScreen.js';
import { useDeclaredCursor } from '../../ink/hooks/use-declared-cursor.js';
import instances from '../../ink/instances.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { attachToJob, readJobOutput } from '../../utils/background/attach.js';
import { dispatchJob } from '../../utils/background/dispatch.js';
import { ensureHost } from '../../utils/background/host.js';
import { queueJobReply } from '../../utils/background/replies.js';
import { DETACH_SEQUENCE } from '../../utils/background/ptyProtocol.js';
import { deleteJob, IDLE_DETAIL, IDLE_NEEDS, type Job, listJobs, patchJob, readJob, stopJob } from '../../utils/background/jobs.js';
import { getLogoDisplayData } from '../../utils/logoV2Utils.js';
import { getModeColor, permissionModeFromString, permissionModeIndicator, permissionModeSymbol, type PermissionMode } from '../../utils/permissions/PermissionMode.js';
import type { Theme } from '../../utils/theme.js';
import { getMainLoopModel, renderModelSetting } from '../../utils/model/model.js';
import { isNativeCursorEnabled } from '../../utils/nativeCursor.js';
import { truncateToWidth } from '../../utils/truncate.js';
import { Clawd } from '../LogoV2/Clawd.js';
import { getDefaultCharacters } from '../Spinner/utils.js';

const POLL_MS = 1000;
const PLACEHOLDER = 'describe a task for a new session';
/** Typed into the view and submitted, these quit it instead of starting a session. */
const EXIT_WORDS = ['exit', 'quit', ':q', ':q!', ':wq', ':wq!'];

type Group = 'needs' | 'working' | 'completed';
const GROUP_LABELS: Record<Group, string> = {
  needs: 'Needs input',
  working: 'Working',
  completed: 'Completed'
};
const GROUP_ORDER: Group[] = ['needs', 'working', 'completed'];
const HELP: Array<[string, string]> = [
  ['enter / →', 'open the selected session (← in it comes back here)'],
  ['↑ ↓', 'select'],
  ['type + enter', 'start a new session with that task'],
  ['space', 'preview the selected session and reply without opening it'],
  ['ctrl+s', 'send the draft to the selected session'],
  ['ctrl+x', 'stop the selected session, again to delete it'],
  ['ctrl+r', 'rename the selected session'],
  ['esc', 'clear the draft, return to the moved conversation, or quit'],
  ['ctrl+c ×2', 'quit — sessions keep running']
];

function groupOf(job: Job): Group {
  if (!job.alive || job.tempo === 'idle') return 'completed';
  return job.tempo === 'blocked' ? 'needs' : 'working';
}

function formatAge(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Stopped from the view or `noa stop`, rather than finished or crashed. */
function isStopped(job: Job): boolean {
  return !job.alive && (job.stopRequested === true || job.detail === 'stopped');
}

/** A moved conversation is named by its first prompt until it gets a title: first three words. */
function intentLabel(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const short = words.length > 3 ? `${words.slice(0, 3).join(' ')}…` : words.join(' ');
  return stringWidth(short) <= 25 ? short : `${truncateToWidth(short, 24).replace(/…$/, '')}…`;
}

function rowLabel(job: Job, isOrigin: boolean): string {
  if (job.name) return job.nameSource === 'auto' ? intentLabel(job.name) : job.name;
  return isOrigin ? 'current session' : 'new session';
}

function rowDetail(job: Job, isOrigin: boolean, isFocused: boolean): string {
  const idle = job.needs === IDLE_NEEDS;
  const hasDetail = !!job.detail && job.detail !== IDLE_DETAIL;
  if (isOrigin && isFocused && job.tempo === 'blocked') {
    if (!idle) return job.needs ?? job.detail;
    return hasDetail ? job.detail : basename(job.cwd) || job.cwd;
  }
  if (groupOf(job) === 'completed' && !isStopped(job) && job.state !== 'failed') return job.output?.result ?? job.detail;
  if (isOrigin && idle && hasDetail) return job.detail;
  if (job.tempo === 'blocked' && job.needs) return job.needs;
  return job.detail;
}

/** The mark before a row and its color: a spinner while working, ✻ when it needs the user, ∙ once finished. */
function rowIcon(job: Job, frame: string): { icon: string; color?: keyof Theme; dim: boolean } {
  const group = groupOf(job);
  if (group === 'completed') {
    if (isStopped(job)) return { icon: '∙', color: 'inactive', dim: false };
    return { icon: '∙', color: job.state === 'failed' ? 'error' : 'success', dim: false };
  }
  if (group === 'working') return { icon: frame, dim: true };
  return { icon: getDefaultCharacters()[4]!, color: 'warning', dim: false };
}

const SPINNER_MS = 120;

function useSpinnerFrame(active: boolean): string {
  const frames = useMemo(() => {
    const chars = getDefaultCharacters();
    return [...chars, ...[...chars].reverse()];
  }, []);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setI(n => (n + 1) % frames.length), SPINNER_MS);
    return () => clearInterval(timer);
  }, [active, frames.length]);
  return frames[i % frames.length]!;
}

/** The permission mode new sessions from this view start in, as the footer names it. */
function launchMode(flags: string[]): PermissionMode | undefined {
  if (flags.includes('--dangerously-skip-permissions')) return 'bypassPermissions';
  for (const flag of ['--permission-mode', '--inherit-permission-mode']) {
    const i = flags.indexOf(flag);
    if (i !== -1 && flags[i + 1]) {
      const mode = permissionModeFromString(flags[i + 1]!);
      return mode === 'default' ? undefined : mode;
    }
  }
  return undefined;
}

export type FleetViewProps = {
  /** The session that was just moved to the background (esc returns to it). */
  originShort?: string;
  /** Flags new sessions start with (model, permission mode…). */
  respawnFlags: string[];
  cwd: string;
  /** `noa agents --cwd`: only sessions started under this directory. */
  cwdFilter?: string;
  onExit: () => void;
};

export function FleetView({
  originShort,
  respawnFlags,
  cwd,
  cwdFilter,
  onExit
}: FleetViewProps): React.ReactNode {
  const { columns, rows } = useTerminalSize();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | undefined>(originShort);
  const [input, setInput] = useState('');
  const [hint, setHint] = useState<string | undefined>();
  const [peek, setPeek] = useState<{ job: Job; output: string; draft: string; sending?: boolean; error?: string }>();
  const [deleteArmed, setDeleteArmed] = useState<{ short: string; justKilled: boolean } | undefined>();
  const [helpOpen, setHelpOpen] = useState(false);
  // ctrl+r: the name being typed for a session, edited in its row.
  const [renaming, setRenaming] = useState<{ short: string; draft: string; taken?: boolean } | undefined>();
  const [now, setNow] = useState(Date.now());
  const attachingRef = useRef(false);
  const replySendingRef = useRef(false);
  // esc / ctrl+c while a session is still being opened: don't attach.
  const attachCancelledRef = useRef(false);
  const [exitPending, setExitPending] = useState(false);
  const handleCtrlC = useDoublePress(setExitPending, onExit);

  const refresh = useCallback(async () => {
    const list = await listJobs();
    setJobs(cwdFilter ? list.filter(j => j.cwd === cwdFilter || j.cwd.startsWith(`${cwdFilter}/`)) : list);
    setNow(Date.now());
  }, [cwdFilter]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!attachingRef.current) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Ordered rows: grouped, the origin session first in its group, then most
  // recently updated.
  const ordered = useMemo(() => {
    const byGroup: Record<Group, Job[]> = { needs: [], working: [], completed: [] };
    for (const job of jobs) byGroup[groupOf(job)].push(job);
    for (const group of GROUP_ORDER) {
      byGroup[group].sort((a, b) => {
        if (a.short === originShort) return -1;
        if (b.short === originShort) return 1;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
    }
    return byGroup;
  }, [jobs, originShort]);
  const flat = useMemo(() => GROUP_ORDER.flatMap(g => ordered[g]), [ordered]);
  const selectedIndex = Math.max(0, flat.findIndex(j => j.short === selected));
  const selectedJob = flat[selectedIndex];
  const selectedRef = useRef(selected);
  selectedRef.current = selectedJob?.short;
  // The moved conversation esc returns to — not one that failed to start,
  // or esc would bounce between it and the list.
  const originJob = originShort !== undefined ? flat.find(j => j.short === originShort) : undefined;
  const originUsable = originJob !== undefined && !(originJob.state === 'failed' && !originJob.alive);

  // Terminal tab title, like a regular session's.
  const needsCount = ordered.needs.length;
  useEffect(() => {
    const title = needsCount > 0 ? `${needsCount} awaiting input · noa agents` : 'noa agents';
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [needsCount]);

  const openJob = useCallback(async (job: Job) => {
    const ink = instances.get(process.stdout);
    if (!ink || attachingRef.current) return;
    attachingRef.current = true;
    attachCancelledRef.current = false;
    setHint(`Opening ${job.name ?? job.short}… · esc to cancel`);
    let outcome: Awaited<ReturnType<typeof attachToJob>> = 'unavailable';
    try {
      // The host may need reviving first; keys stay with the view until the
      // terminal is handed over, so esc / ctrl+c can still back out.
      const ready = await ensureHost(job);
      if (attachCancelledRef.current) {
        setHint(undefined);
        return;
      }
      setHint(undefined);
      if (ready) {
        ink.enterAlternateScreen();
        try {
          outcome = await attachToJob(job.short);
        } finally {
          ink.exitAlternateScreen();
        }
      }
    } finally {
      attachingRef.current = false;
    }
    if (outcome === 'unavailable') setHint(`Couldn't open ${job.name ?? job.short}`);
    if (outcome === 'exited') {
      // Don't leave a session that just died looking like a no-op: say why.
      const after = await readJob(job.short);
      if (after?.state === 'failed') setHint(`${after.name ?? 'Session'} exited: ${after.detail}`);
    }
    await refresh();
  }, [refresh]);

  const startJob = useCallback(async (prompt: string) => {
    try {
      const short = await dispatchJob({ cwd, prompt, respawnFlags });
      selectedRef.current = short;
      setSelected(short);
      await refresh();
    } catch (e) {
      setHint(`Couldn't start a session: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [cwd, respawnFlags, refresh]);

  const sendReply = useCallback(async (job: Job, text: string, onSaved: () => void): Promise<void> => {
    await queueJobReply(job.short, text);
    onSaved();
    const current = (await listJobs()).find(j => j.short === job.short);
    if (!current || (!current.alive && !current.sessionPid && !(await ensureHost(current)))) throw new Error('Reply saved; it will be delivered when this session resumes');
    setHint(`Reply queued for ${job.name ?? job.short}`);
    await refresh();
  }, [refresh]);

  useInput((char, key) => {
    if (attachingRef.current) {
      if (key.escape || key.ctrl && char === 'c') attachCancelledRef.current = true;
      return;
    }
    // Keys can arrive in one batch (↓ then ctrl+x): act on the selection the
    // earlier ones made, not the last render's.
    const selectedJob = flat.find(j => j.short === selectedRef.current) ?? flat[0];
    const selectedIndex = selectedJob ? flat.indexOf(selectedJob) : 0;
    const select = (short: string) => {
      selectedRef.current = short;
      setSelected(short);
    };
    if (peek) {
      if (key.escape || key.ctrl && char === 'c') setPeek(undefined);
      else if (!peek.sending && key.return && peek.draft.trim()) {
        const sending = { ...peek, sending: true, error: undefined };
        let saved = false;
        setPeek(sending);
        void sendReply(peek.job, peek.draft, () => { saved = true; }).then(
          () => setPeek(current => current === sending ? undefined : current),
          e => setPeek(current => current === sending ? { ...current, draft: saved ? '' : current.draft, sending: false, error: String(e) } : current)
        );
      } else if (!peek.sending && (key.backspace || key.delete)) setPeek({ ...peek, draft: peek.draft.slice(0, -1) });
      else if (!peek.sending && char && !key.ctrl && !key.meta && !key.tab) setPeek({ ...peek, draft: peek.draft + char.replace(/[\r\n]+/g, ' ') });
      return;
    }
    if (renaming) {
      if (key.escape || key.ctrl && char === 'c') {
        setRenaming(undefined);
      } else if (key.return) {
        const name = renaming.draft.trim();
        if (!name) {
          setRenaming(undefined);
          return;
        }
        const clash = flat.some(j => j.short !== renaming.short && j.name?.trim().toLowerCase() === name.toLowerCase());
        if (clash) {
          setRenaming({ ...renaming, taken: true });
          return;
        }
        const short = renaming.short;
        setRenaming(undefined);
        void patchJob(short, { name, nameSource: 'user' }).then(refresh, e => setHint(`Couldn't rename: ${e instanceof Error ? e.message : String(e)}`));
      } else if (key.backspace || key.delete) {
        setRenaming({ short: renaming.short, draft: renaming.draft.slice(0, -1) });
      } else if (char && !key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow) {
        setRenaming({ short: renaming.short, draft: renaming.draft + char.replace(/[\r\n]+/g, ' ') });
      }
      return;
    }
    // ctrl+c closes the help first; otherwise it clears the draft and counts
    // as the first of the two presses that quit.
    if (key.ctrl && char === 'c') {
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      setInput('');
      handleCtrlC();
      return;
    }
    // esc peels back one layer at a time: the help, the draft, a pending
    // delete, then the view itself — back into the moved conversation if
    // there is one, otherwise out.
    if (key.escape) {
      if (helpOpen) {
        setHelpOpen(false);
      } else if (input) {
        setInput('');
      } else if (deleteArmed) {
        setDeleteArmed(undefined);
      } else {
        if (originUsable) void openJob(originJob);
        else onExit();
      }
      return;
    }
    // Any other key but ? and up/down navigation closes the help.
    if (helpOpen && char !== '?' && !key.upArrow && !key.downArrow && !(key.ctrl && (char === 'p' || char === 'n'))) {
      setHelpOpen(false);
    }
    if (key.ctrl && char === 'r' && !input) {
      if (!selectedJob) return;
      setDeleteArmed(undefined);
      setRenaming({ short: selectedJob.short, draft: selectedJob.name ?? '' });
      return;
    }
    // ctrl+x on a running session stops it (transcript kept); on a stopped
    // one it asks, then deletes.
    if (key.ctrl && char === 'x') {
      if (!selectedJob) return;
      if (deleteArmed?.short === selectedJob.short) {
        setDeleteArmed(undefined);
        void deleteJob(selectedJob).then(refresh).catch(e => setHint(`Couldn't remove session: ${e instanceof Error ? e.message : String(e)}`));
        return;
      }
      if (selectedJob.alive || selectedJob.sessionPid) {
        const job = selectedJob;
        void stopJob(job).then(stopped => {
          if (stopped) setDeleteArmed({ short: job.short, justKilled: true });
          else setHint("Couldn't stop session: its process is still running or its identity could not be verified.");
          return refresh();
        }).catch(e => setHint(`Couldn't stop session: ${e instanceof Error ? e.message : String(e)}`));
        return;
      }
      setDeleteArmed({ short: selectedJob.short, justKilled: false });
      return;
    }
    if (deleteArmed) setDeleteArmed(undefined);
    if (char === '?' && !input) {
      setHelpOpen(v => !v);
      return;
    }
    if (char === ' ' && !input && selectedJob) {
      const job = selectedJob;
      setPeek({ job, output: job.output?.result ?? job.detail, draft: '' });
      void readJobOutput(job.short).then(output => {
        if (output !== null) setPeek(current => current?.job.short === job.short && !current.sending ? { ...current, output: stripAnsi(output.split(DETACH_SEQUENCE).join('')).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '').slice(-10_000) } : current);
      });
      return;
    }
    if (key.ctrl && char === 's' && input.trim() && selectedJob) {
      if (replySendingRef.current) return;
      const text = input;
      replySendingRef.current = true;
      void sendReply(selectedJob, text, () => setInput(current => current === text ? '' : current))
        .catch(e => setHint(String(e))).finally(() => { replySendingRef.current = false; });
      return;
    }
    // ↑/↓ wrap around the list and clear a stale hint.
    const step = key.upArrow || key.ctrl && char === 'p' ? -1 : key.downArrow || key.ctrl && char === 'n' ? 1 : 0;
    if (step !== 0) {
      setHint(undefined);
      const next = flat[(selectedIndex + step + flat.length) % flat.length];
      if (next) setSelected(next.short);
      return;
    }
    // → opens the selected session, the way ← in a session comes back.
    if (key.rightArrow && !input) {
      if (selectedJob) void openJob(selectedJob);
      return;
    }
    if (key.return) {
      const prompt = input.trim();
      if (EXIT_WORDS.includes(prompt.toLowerCase())) {
        setInput('');
        onExit();
      } else if (prompt) {
        setInput('');
        void startJob(prompt);
      } else if (selectedJob) {
        void openJob(selectedJob);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setInput(v => v.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta && !key.tab) {
      setHint(undefined);
      setInput(v => v + char.replace(/[\r\n]+/g, ' '));
    }
  });

  // One caret: park the terminal's own cursor at the input (as the REPL
  // prompt does), and only draw a fake one when the native cursor is off.
  const nativeCursor = useMemo(() => isNativeCursorEnabled(), []);
  const cursorRef = useDeclaredCursor({
    line: 0,
    column: Math.min(stringWidth(peek?.draft ?? input), Math.max(0, columns - 6)),
    active: true
  });

  const { version, cwd: displayCwd } = getLogoDisplayData();
  const model = renderModelSetting(getMainLoopModel());
  const counts = `${ordered.needs.length} awaiting input · ${ordered.working.length} working · ${ordered.completed.length} completed`;
  const frame = useSpinnerFrame(ordered.working.length > 0);
  const mode = useMemo(() => launchMode(respawnFlags), [respawnFlags]);

  // Columns: a label as wide as the longest name (12–40, or a third of a
  // wide screen), the age right-aligned, the detail taking the rest.
  const indent = columns >= 120 ? 1 : 0;
  const labelOf = (job: Job) => rowLabel(job, job.short === originShort);
  const ageWidth = Math.max(3, ...flat.map(j => stringWidth(formatAge(j.updatedAt, now))));
  const labelWidth = Math.min(Math.max(40, Math.floor(columns / 3)), Math.max(12, ...flat.map(j => stringWidth(labelOf(j))), renaming ? stringWidth(renaming.draft) + 1 : 0));

  // Keep the selected row visible when the list is taller than the screen.
  const headerRows = 5 + (originShort ? 2 : 0);
  const footerRows = 4 + (helpOpen ? HELP.length : 0);
  const listRows = Math.max(3, rows - headerRows - footerRows);
  const lines: Array<{ kind: 'label'; group: Group } | { kind: 'job'; job: Job } | { kind: 'gap' }> = [];
  for (const group of GROUP_ORDER) {
    if (ordered[group].length === 0) continue;
    if (lines.length) lines.push({ kind: 'gap' });
    lines.push({ kind: 'label', group });
    for (const job of ordered[group]) lines.push({ kind: 'job', job });
  }
  const selectedLine = lines.findIndex(l => l.kind === 'job' && l.job.short === selectedJob?.short);
  const windowStart = Math.max(0, Math.min(selectedLine - Math.floor(listRows / 2), lines.length - listRows));
  const visible = lines.slice(windowStart, windowStart + listRows);
  const focusedGroup = selectedJob ? groupOf(selectedJob) : undefined;

  const footer: React.ReactNode[] = [];
  if (exitPending) {
    // Like the view's counts: sessions awaiting input or working.
    const running = ordered.needs.length + ordered.working.length;
    footer.push(`Press Ctrl-C again to exit${running > 0 ? ` · ${running} ${running === 1 ? 'agent' : 'agents'} will keep running` : ''}`);
  } else if (hint) {
    footer.push(hint);
  } else {
    if (mode) footer.push(<Text key="mode" color={getModeColor(mode)}>{permissionModeSymbol(mode)} {permissionModeIndicator(mode)}</Text>);
    if (input) {
      footer.push('enter to start', 'esc to clear');
    } else {
      if (selectedJob) footer.push(`enter to ${selectedJob.short === originShort && originUsable ? 'return' : 'open'}`);
      if (selectedJob && columns >= 80) footer.push('ctrl+x to delete');
      footer.push('? for shortcuts');
    }
  }

  if (peek) return <AlternateScreen mouseTracking={false}>
    <Box flexDirection="column" height={rows}>
      <Text bold>{peek.job.name ?? peek.job.short}</Text>
      <Text dimColor>{peek.job.state} · {peek.job.cwd}</Text>
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {peek.output.split('\n').slice(-Math.max(1, rows - 7)).map((line, i) => <Text key={i} wrap="truncate">{line}</Text>)}
      </Box>
      {peek.error && <Text color="error" wrap="truncate">{peek.error}</Text>}
      <Box borderStyle="round" borderLeft={false} borderRight={false} borderDimColor>
        <Text>❯ </Text><Box ref={cursorRef} flexGrow={1}><Text wrap="truncate-start">{peek.draft || 'write a reply'}{!nativeCursor && <Text inverse> </Text>}</Text></Box>
      </Box>
      <Text dimColor>{peek.sending ? 'Sending…' : 'enter sends a reply · esc returns to sessions'}</Text>
    </Box>
  </AlternateScreen>;
  return <AlternateScreen mouseTracking={false}>
      <Box flexDirection="column" height={rows}>
        <Box gap={2} marginTop={1} marginBottom={1}>
          {columns >= 70 && <Clawd />}
          <Box flexDirection="column">
            <Text>
              <Text bold>Noa Claude</Text> <Text dimColor>v{version}</Text>
            </Text>
            <Text dimColor wrap="truncate">{model} · {displayCwd}</Text>
            <Text dimColor>{counts}</Text>
          </Box>
        </Box>
        {originShort && <Box marginBottom={1}>
            <Text dimColor>
              Your conversation moved to the background — enter opens it · esc returns to it · ctrl+c twice quits
            </Text>
          </Box>}
        <Box flexDirection="column" flexGrow={1}>
          {flat.length === 0 && <Text dimColor>No background sessions yet — describe a task below to start one.</Text>}
          {visible.map((line, i) => {
          if (line.kind === 'gap') return <Text key={`gap-${i}`}> </Text>;
          if (line.kind === 'label') return <Text key={line.group} dimColor bold={line.group === focusedGroup}>{GROUP_LABELS[line.group]}</Text>;
          const job = line.job;
          const isFocused = job.short === selectedJob?.short;
          const isOrigin = job.short === originShort;
          const { icon, color, dim } = rowIcon(job, frame);
          const armed = deleteArmed?.short === job.short ? deleteArmed : undefined;
          return <Box key={job.short} width="100%" paddingLeft={indent} backgroundColor={isFocused ? 'userMessageBackground' : undefined}>
                <Box width={labelWidth + 2} flexShrink={0}>
                  <Text color={isFocused ? 'text' : undefined} dimColor={!isFocused && !isOrigin} wrap="truncate">
                    <Text color={color} dimColor={dim && !isFocused}>{icon}</Text> {renaming?.short === job.short ? <Text>{truncateToWidth(renaming.draft, labelWidth - 1)}<Text inverse> </Text></Text> : <Text bold={isOrigin}>{labelOf(job)}</Text>}
                  </Text>
                </Box>
                <Box flexGrow={1} width={0} paddingLeft={2}>
                  {renaming?.short === job.short ? <Text color={renaming.taken ? 'error' : undefined} dimColor={!renaming.taken} wrap="truncate">{renaming.taken ? `Another session is already named "${renaming.draft.trim()}"` : 'enter to save · esc to cancel'}</Text> : armed ? <Text color="error" wrap="truncate">{armed.justKilled ? 'stopped · ctrl+x again to delete' : 'ctrl+x again to delete'}</Text> : <Text dimColor wrap="truncate">{rowDetail(job, isOrigin, isFocused).replace(/\s+/g, ' ')}</Text>}
                </Box>
                <Box width={ageWidth + 2} flexShrink={0} paddingLeft={2} justifyContent="flex-end">
                  <Text dimColor>{formatAge(job.updatedAt, now)}</Text>
                </Box>
              </Box>;
        })}
        </Box>
        <Box flexDirection="column">
          {helpOpen && <Box flexDirection="column" paddingLeft={2}>
              {HELP.map(([keys, action]) => <Text key={keys} dimColor>
                  <Text bold>{keys.padEnd(14)}</Text>{action}
                </Text>)}
            </Box>}
          <Box borderStyle="round" borderLeft={false} borderRight={false} borderDimColor>
            <Text dimColor={!input}>❯ </Text>
            <Box ref={cursorRef} flexGrow={1}>
              {nativeCursor ? input ? <Text wrap="truncate-start">{input}</Text> : <Text dimColor>{PLACEHOLDER}</Text> : input ? <Text wrap="truncate-start">{input}<Text inverse> </Text></Text> : <Text><Text inverse>{PLACEHOLDER[0]}</Text><Text dimColor>{PLACEHOLDER.slice(1)}</Text></Text>}
            </Box>
          </Box>
          <Box paddingLeft={2}>
            <Text dimColor wrap="truncate-end">
              {footer.map((part, i) => <React.Fragment key={i}>{i > 0 && ' · '}{part}</React.Fragment>)}
            </Text>
          </Box>
        </Box>
      </Box>
    </AlternateScreen>;
}
