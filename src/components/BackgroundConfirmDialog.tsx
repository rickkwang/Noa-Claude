/**
 * "Background this session?" — shown before /background or ← moves a
 * conversation whose own background work (shells, subagents, monitors)
 * lives in this process and would stop with it.
 */
import * as React from 'react';
import type { AppState } from '../state/AppStateStore.js';
import { isTerminalTaskStatus } from '../Task.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';

const LABELS: Record<string, [string, string]> = {
  local_bash: ['shell', 'shells'],
  local_agent: ['agent', 'agents'],
  in_process_teammate: ['teammate', 'teammates'],
  local_workflow: ['workflow', 'workflows'],
  monitor_mcp: ['monitor', 'monitors']
};

/** Tasks of this process that a move to the background would stop. */
export function abandonableTasks(tasks: AppState['tasks']): {
  count: number;
  summary: string;
} {
  const counts = new Map<string, number>();
  for (const task of Object.values(tasks ?? {})) {
    if (!LABELS[task.type] || isTerminalTaskStatus(task.status)) continue;
    // A foreground command or subagent is part of the turn being moved; it
    // ends with that turn, it isn't background work left behind.
    if ((task as { isBackgrounded?: boolean }).isBackgrounded === false) continue;
    counts.set(task.type, (counts.get(task.type) ?? 0) + 1);
  }
  let count = 0;
  const parts: string[] = [];
  for (const [type, n] of counts) {
    count += n;
    const [one, many] = LABELS[type]!;
    parts.push(`${n} ${n === 1 ? one : many}`);
  }
  const summary = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
  return {
    count,
    summary
  };
}

export function BackgroundConfirmDialog({
  count,
  summary,
  onConfirm,
  onCancel
}: {
  count: number;
  summary: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const options = [{
    value: 'confirm' as const,
    label: `Background anyway (${count} ${count === 1 ? 'task' : 'tasks'} will be stopped)`
  }, {
    value: 'stay' as const,
    label: 'Stay'
  }];
  return <Dialog title="Background this session?" subtitle={`${summary} will be stopped.`} onCancel={onCancel}>
      <Select options={options} onChange={(value: 'confirm' | 'stay') => value === 'confirm' ? onConfirm() : onCancel()} />
    </Dialog>;
}
