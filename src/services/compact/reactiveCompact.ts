import type { QuerySource } from '../../constants/querySource.js';
import type { Message } from '../../types/message.js';
import type { CacheSafeParams } from '../../utils/forkedAgent.js';
import type { CompactionResult } from './compact.js';

// No-op stub, same pattern as snipCompact.ts: query.ts requires this module
// under feature('REACTIVE_COMPACT') and the flag is in build.ts's accepted
// list, so the module must exist even though reactive compact is not active
// in this distribution. All entry points report disabled / recover nothing.

export function isReactiveCompactEnabled(): boolean {
  return false;
}

export function isReactiveOnlyMode(): boolean {
  return false;
}

export function isWithheldPromptTooLong(_message: unknown): boolean {
  return false;
}

export function isWithheldMediaSizeError(_message: unknown): boolean {
  return false;
}

export async function tryReactiveCompact(_params: {
  hasAttempted: boolean;
  querySource: QuerySource;
  aborted: boolean;
  messages: Message[];
  cacheSafeParams: CacheSafeParams;
}): Promise<CompactionResult | null> {
  return null;
}

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult }
  | {
      ok: false;
      reason:
        | 'too_few_groups'
        | 'aborted'
        | 'exhausted'
        | 'media_unstrippable'
        | 'error';
    };

// Only reachable when isReactiveOnlyMode() returns true, which it never does
// here — present so commands/compact/compact.ts type-checks and bundles.
export async function reactiveCompactOnPromptTooLong(
  _messages: Message[],
  _cacheSafeParams: CacheSafeParams,
  _options: {
    customInstructions: string | undefined;
    trigger: 'manual' | 'auto';
  },
): Promise<ReactiveCompactOutcome> {
  return { ok: false, reason: 'error' };
}

export default {
  isReactiveCompactEnabled,
  isReactiveOnlyMode,
  isWithheldPromptTooLong,
  isWithheldMediaSizeError,
  tryReactiveCompact,
  reactiveCompactOnPromptTooLong,
};
