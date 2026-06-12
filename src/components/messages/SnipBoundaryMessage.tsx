import type { Message } from '../../types/message.js'

// Unreachable stub, same pattern as snipCompact.ts/snipProjection.ts:
// Message.tsx requires this module under feature('HISTORY_SNIP'), but the
// render guard (snipProjection.isSnipBoundaryMessage) always returns false in
// this distribution, so the component is never mounted. Present only so
// HISTORY_SNIP builds resolve at bundle time.
export function SnipBoundaryMessage(_props: { message: Message }): null {
  return null
}
