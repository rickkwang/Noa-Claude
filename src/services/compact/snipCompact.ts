import type { Message } from '../../types/message.js';

export const SNIP_NUDGE_TEXT =
  'Context efficiency tooling is not active in this build.';

export function isSnipRuntimeEnabled(): boolean {
  return false;
}

export function shouldNudgeForSnips(): boolean {
  return false;
}

export function isSnipMarkerMessage(): boolean {
  return false;
}

export function snipCompactIfNeeded(
  messages: Message[],
): {
  messages: Message[];
  tokensFreed: number;
  boundaryMessage: undefined;
  executed: boolean;
} {
  return {
    messages,
    tokensFreed: 0,
    boundaryMessage: undefined,
    executed: false,
  };
}

export default {
  SNIP_NUDGE_TEXT,
  isSnipRuntimeEnabled,
  shouldNudgeForSnips,
  isSnipMarkerMessage,
  snipCompactIfNeeded,
};
