import type { Message } from '../../types/message.js';

export function isSnipBoundaryMessage(..._args: unknown[]): boolean {
  return false;
}

export function projectSnippedView(messages: Message[]): Message[] {
  return messages;
}
