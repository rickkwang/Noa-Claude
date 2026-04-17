import type { TaskState } from 'src/tasks/types.js';
import { cronToHuman } from 'src/utils/cron.js';
import { type CronTask, nextCronRunMs } from 'src/utils/cronTasks.js';
import { truncate } from 'src/utils/format.js';

export type ScheduledJobListItem = {
  id: string;
  type: 'scheduled_job';
  label: string;
  status: 'scheduled';
  cron: string;
  humanSchedule: string;
  nextRunMs: number | null;
  recurring: boolean;
  durable: boolean;
  prompt: string;
  createdAt: number;
};

export type BackgroundDialogViewState =
  | { mode: 'list' }
  | { mode: 'detail'; itemId: string };

export const SCHEDULED_TASK_REFRESH_MS = 15_000;

export function toScheduledJobListItem(task: CronTask): ScheduledJobListItem {
  return {
    id: task.id,
    type: 'scheduled_job',
    label: truncate(task.prompt, 80, true),
    status: 'scheduled',
    cron: task.cron,
    humanSchedule: cronToHuman(task.cron),
    nextRunMs: nextCronRunMs(task.cron, Date.now()),
    recurring: Boolean(task.recurring),
    durable: task.durable !== false,
    prompt: task.prompt,
    createdAt: task.createdAt,
  };
}

export function formatDateTime(ms: number | null): string {
  if (ms === null) return 'n/a';
  return new Date(ms).toLocaleString();
}

export function isStoppableRunningTask(
  item: { type: string; status: string },
): boolean {
  return (
    (item.type === 'local_bash' ||
      item.type === 'local_agent' ||
      item.type === 'in_process_teammate' ||
      item.type === 'local_workflow' ||
      item.type === 'monitor_mcp' ||
      item.type === 'dream' ||
      item.type === 'remote_agent') &&
    item.status === 'running'
  );
}

export function canStopOrCancelItem(
  item: { type: string; status: string } | null,
): boolean {
  if (!item) return false;
  return item.type === 'scheduled_job' || isStoppableRunningTask(item);
}

export function getStopOrCancelLabel(
  item: { type: string } | null,
): 'cancel' | 'stop' {
  return item?.type === 'scheduled_job' ? 'cancel' : 'stop';
}

export function shouldCloseDetailView(params: {
  viewState: BackgroundDialogViewState;
  typedTasks: Record<string, TaskState> | undefined;
  isTaskValidForDetail: (task: TaskState) => boolean;
  scheduledJobs: ScheduledJobListItem[];
}): boolean {
  const { viewState, typedTasks, isTaskValidForDetail, scheduledJobs } = params;
  if (viewState.mode === 'list') return false;
  if (scheduledJobs.some(job => job.id === viewState.itemId)) return false;
  const task = (typedTasks ?? {})[viewState.itemId];
  return !task || !isTaskValidForDetail(task);
}
