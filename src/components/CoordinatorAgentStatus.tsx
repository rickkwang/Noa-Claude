// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
/**
 * CoordinatorTaskPanel — Steerable list of background agents.
 *
 * Renders below the prompt input footer whenever local_agent tasks exist.
 * Visibility is driven by evictAfter: undefined (running/retained) shows
 * always; a timestamp shows until passed. Enter to view/steer, x to dismiss.
 */

import figures from 'figures';
import * as React from 'react';
import { EFFORT_HIGH, EFFORT_LOW, PAUSE_ICON, PLAY_ICON } from '../constants/figures.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text, wrapText } from '../ink.js';
import { type AppState, useAppState, useSetAppState } from '../state/AppState.js';
import { getAgentPersonalityName, getPersonalityNameColor, shouldUseAgentPersonalityName } from '../tools/AgentTool/constants.js';
import { enterTeammateView, exitTeammateView } from '../state/teammateViewHelpers.js';
import { isPanelAgentTask, type LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { formatDuration, formatNumber } from '../utils/format.js';
import { evictTerminalTask } from '../utils/task/framework.js';
import { isTerminalStatus } from './tasks/taskStatusUtils.js';

/**
 * Which panel-managed tasks currently have a visible row.
 * Presence in AppState.tasks IS visibility — the 1s tick in
 * CoordinatorTaskPanel evicts tasks past their evictAfter deadline. The
 * evictAfter !== 0 check handles immediate dismiss (x key) without making
 * the filter time-dependent. Shared by panel render, useCoordinatorTaskCount,
 * and index resolvers so the math can't drift.
 */
export function getVisibleAgentTasks(tasks: AppState['tasks']): LocalAgentTaskState[] {
  return Object.values(tasks).filter((t): t is LocalAgentTaskState => isPanelAgentTask(t) && t.evictAfter !== 0).sort((a, b) => a.startTime - b.startTime);
}
export function CoordinatorTaskPanel(): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s_0 => s_0.viewingAgentTaskId);
  const agentNameRegistry = useAppState(s_1 => s_1.agentNameRegistry);
  const coordinatorTaskIndex = useAppState(s_2 => s_2.coordinatorTaskIndex);
  const tasksSelected = useAppState(s_3 => s_3.footerSelection === 'tasks');
  const selectedIndex = tasksSelected ? coordinatorTaskIndex : undefined;
  const setAppState = useSetAppState();
  const visibleTasks = getVisibleAgentTasks(tasks);
  const hasTasks = Object.values(tasks).some(isPanelAgentTask);

  // 1s tick: re-render for elapsed time + evict tasks past their deadline.
  // The eviction deletes from prev.tasks, which makes useCoordinatorTaskCount
  // (and other consumers) see the updated count without their own tick.
  const tasksRef = React.useRef(tasks);
  tasksRef.current = tasks;
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!hasTasks) return;
    const interval = setInterval((tasksRef_0, setAppState_0, setTick_0) => {
      const now = Date.now();
      for (const t of Object.values(tasksRef_0.current)) {
        if (isPanelAgentTask(t) && (t.evictAfter ?? Infinity) <= now) {
          evictTerminalTask(t.id, setAppState_0);
        }
      }
      setTick_0((prev: number) => prev + 1);
    }, 1000, tasksRef, setAppState, setTick);
    return () => clearInterval(interval);
  }, [hasTasks, setAppState]);
  const nameByAgentId = React.useMemo(() => {
    const inv = new Map<string, string>();
    for (const [n, id] of agentNameRegistry) inv.set(id, n);
    return inv;
  }, [agentNameRegistry]);
  if (visibleTasks.length === 0) {
    return null;
  }
  return <Box flexDirection="column" marginTop={1}>
      <MainLine isSelected={selectedIndex === 0} isViewed={viewingAgentTaskId === undefined} onClick={() => exitTeammateView(setAppState)} />
      {visibleTasks.map((task, i) => {
      const explicitName = nameByAgentId.get(task.id);
      const personalityName = task.personalityName ?? (shouldUseAgentPersonalityName(task.agentType) ? getAgentPersonalityName(task.id) : undefined);
      return <AgentLine key={task.id} task={task} name={explicitName ?? personalityName} nameColor={!explicitName && personalityName ? getPersonalityNameColor(personalityName) : undefined} isSelected={selectedIndex === i + 1} isViewed={viewingAgentTaskId === task.id} onClick={() => enterTeammateView(task.id, setAppState)} />;
    })}
    </Box>;
}

/**
 * Returns the number of visible coordinator tasks (for selection bounds).
 * The panel's 1s tick evicts expired tasks from prev.tasks, so this count
 * stays accurate without needing its own tick.
 */
export function useCoordinatorTaskCount() {
  const tasks = useAppState(_temp);
  const count = getVisibleAgentTasks(tasks).length;
  return count > 0 ? count + 1 : 0;
}
function _temp(s) {
  return s.tasks;
}
function MainLine(t0) {
  const $ = _c(10);
  const {
    isSelected,
    isViewed,
    onClick
  } = t0;
  const [hover, setHover] = React.useState(false);
  const prefix = isSelected || hover ? figures.pointer + " " : "  ";
  const bullet = isViewed ? EFFORT_HIGH : EFFORT_LOW;
  let t1;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => setHover(true);
    t2 = () => setHover(false);
    $[0] = t1;
    $[1] = t2;
  } else {
    t1 = $[0];
    t2 = $[1];
  }
  const t3 = !isSelected && !isViewed && !hover;
  let t4;
  if ($[2] !== bullet || $[3] !== isViewed || $[4] !== prefix || $[5] !== t3) {
    t4 = <Text dimColor={t3} bold={isViewed}>{prefix}{bullet} main</Text>;
    $[2] = bullet;
    $[3] = isViewed;
    $[4] = prefix;
    $[5] = t3;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== onClick || $[8] !== t4) {
    t5 = <Box onClick={onClick} onMouseEnter={t1} onMouseLeave={t2}>{t4}</Box>;
    $[7] = onClick;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}
type AgentLineProps = {
  task: LocalAgentTaskState;
  name?: string;
  nameColor?: string;
  isSelected?: boolean;
  isViewed?: boolean;
  onClick?: () => void;
};
function AgentLine(t0) {
  const $ = _c(35);
  const {
    task,
    name,
    nameColor,
    isSelected,
    isViewed,
    onClick
  } = t0;
  const {
    columns
  } = useTerminalSize();
  const [hover, setHover] = React.useState(false);
  const isRunning = !isTerminalStatus(task.status);
  const pausedMs = task.totalPausedMs ?? 0;
  const elapsedMs = Math.max(0, isRunning ? Date.now() - task.startTime - pausedMs : (task.endTime ?? task.startTime) - task.startTime - pausedMs);
  let t1;
  if ($[0] !== elapsedMs) {
    t1 = formatDuration(elapsedMs);
    $[0] = elapsedMs;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const elapsed = t1;
  // result first, progress second — same order as AsyncAgentDetailDialog. The
  // panel keeps rendering a task after it finishes (getVisibleAgentTasks only
  // drops evictAfter === 0), and progress ticks are throttled, so the last tick
  // before completion can be dropped. task.result carries the final totals.
  const tokenCount = task.result?.totalTokens ?? task.progress?.tokenCount;
  const lastActivity = task.progress?.lastActivity;
  const arrow = lastActivity ? figures.arrowDown : figures.arrowUp;
  let t2;
  if ($[2] !== arrow || $[3] !== tokenCount) {
    t2 = tokenCount !== undefined && tokenCount > 0 ? ` · ${arrow} ${formatNumber(tokenCount)} tokens` : "";
    $[2] = arrow;
    $[3] = tokenCount;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const tokenText = t2;
  const queuedCount = task.pendingMessages.length;
  const queuedText = queuedCount > 0 ? ` · ${queuedCount} queued` : "";
  const displayDescription = task.progress?.summary || task.description;
  const highlighted = isSelected || hover;
  const prefix = highlighted ? figures.pointer + " " : "  ";
  const bullet = isViewed ? EFFORT_HIGH : EFFORT_LOW;
  const dim = !highlighted && !isViewed;
  const sep = isRunning ? PLAY_ICON : PAUSE_ICON;
  const namePart = name ? `${name}: ` : "";
  const hintPart = isSelected && !isViewed ? ` · x to ${isRunning ? "stop" : "clear"}` : "";
  const suffixPart = ` ${sep} ${elapsed}${tokenText}${queuedText}${hintPart}`;
  const availableForDesc = columns - stringWidth(prefix) - stringWidth(`${bullet} `) - stringWidth(namePart) - stringWidth(suffixPart);
  const t3 = Math.max(0, availableForDesc);
  let t4;
  if ($[5] !== displayDescription || $[6] !== t3) {
    t4 = wrapText(displayDescription, t3, "truncate-end");
    $[5] = displayDescription;
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const truncated = t4;
  let t5;
  if ($[8] !== name || $[9] !== nameColor) {
    t5 = name && <><Text dimColor={false} bold={true} color={nameColor}>{name}</Text>{": "}</>;
    $[8] = name;
    $[9] = nameColor;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== queuedCount || $[12] !== queuedText) {
    t6 = queuedCount > 0 && <Text color="warning">{queuedText}</Text>;
    $[11] = queuedCount;
    $[12] = queuedText;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== hintPart) {
    t7 = hintPart && <Text dimColor={true}>{hintPart}</Text>;
    $[14] = hintPart;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  const padding = ' '.repeat(Math.max(0, t3 - stringWidth(truncated)));
  let t8;
  if ($[16] !== bullet || $[17] !== dim || $[18] !== elapsed || $[19] !== isViewed || $[20] !== prefix || $[21] !== sep || $[22] !== t5 || $[23] !== t6 || $[24] !== t7 || $[25] !== tokenText || $[26] !== truncated || $[27] !== padding) {
    t8 = <Text dimColor={dim} bold={isViewed}>{prefix}{bullet} {t5}{truncated}{padding} {sep} {elapsed}{tokenText}{t6}{t7}</Text>;
    $[16] = bullet;
    $[17] = dim;
    $[18] = elapsed;
    $[19] = isViewed;
    $[20] = prefix;
    $[21] = sep;
    $[22] = t5;
    $[23] = t6;
    $[24] = t7;
    $[25] = tokenText;
    $[26] = truncated;
    $[27] = padding;
    $[28] = t8;
  } else {
    t8 = $[28];
  }
  const line = t8;
  if (!onClick) {
    return line;
  }
  let t10;
  let t9;
  if ($[29] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = () => setHover(true);
    t10 = () => setHover(false);
    $[29] = t10;
    $[30] = t9;
  } else {
    t10 = $[29];
    t9 = $[30];
  }
  let t11;
  if ($[31] !== line || $[32] !== onClick) {
    t11 = <Box onClick={onClick} onMouseEnter={t9} onMouseLeave={t10}>{line}</Box>;
    $[31] = line;
    $[32] = onClick;
    $[33] = t11;
  } else {
    t11 = $[33];
  }
  return t11;
}
