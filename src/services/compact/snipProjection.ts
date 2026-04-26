import type { Message } from '../../types/message.js';

export function isSnipBoundaryMessage(): boolean {
  return false;
}

export function projectSnippedView(messages: Message[]): Message[] {
  return messages;
}
