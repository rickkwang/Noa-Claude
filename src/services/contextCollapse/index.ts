import type { Message } from '../../types/message.js';

type CollapseHealth = {
  totalSpawns: number;
  totalErrors: number;
  lastError?: string;
  emptySpawnWarningEmitted: boolean;
  totalEmptySpawns: number;
};

type CollapseStats = {
  collapsedSpans: number;
  collapsedMessages: number;
  stagedSpans: number;
  health: CollapseHealth;
};

type Listener = () => void;

const DEFAULT_STATS: CollapseStats = {
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalSpawns: 0,
    totalErrors: 0,
    emptySpawnWarningEmitted: false,
    totalEmptySpawns: 0,
  },
};

const listeners = new Set<Listener>();
let stats: CollapseStats = { ...DEFAULT_STATS, health: { ...DEFAULT_STATS.health } };

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function resetStats(): void {
  stats = { ...DEFAULT_STATS, health: { ...DEFAULT_STATS.health } };
  emit();
}

export function initContextCollapse(): void {}

export function resetContextCollapse(): void {
  resetStats();
}

export function isContextCollapseEnabled(): boolean {
  return false;
}

export function getStats(): CollapseStats {
  return stats;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
): Promise<{ messages: Message[] }> {
  return { messages };
}

export function isWithheldPromptTooLong(): boolean {
  return false;
}

export function recoverFromOverflow(
  messages: Message[],
): { messages: Message[]; committed: number } {
  return { messages, committed: 0 };
}

export function restoreFromEntries(): void {
  resetStats();
}
