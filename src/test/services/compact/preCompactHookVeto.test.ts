import { describe, expect, test } from 'bun:test'
import {
  CompactionBlockedError,
  ERROR_MESSAGE_COMPACT_BLOCKED_BY_HOOK,
  throwIfBlockedByPreCompactHook,
} from '../../../services/compact/compact.js'
import type { ToolUseContext } from '../../../Tool.js'

// How each compaction path reacts to a PreCompact hook veto. The manual path
// throws and tells the user which hook declined; the automatic paths are
// covered where they run their hooks (autoCompact / reactiveCompact tests).

function context(): {
  context: ToolUseContext
  notifications: Array<{ key: string; text?: string }>
} {
  const notifications: Array<{ key: string; text?: string }> = []
  return {
    context: {
      addNotification: (notif: { key: string; text?: string }) =>
        notifications.push(notif),
    } as unknown as ToolUseContext,
    notifications,
  }
}

describe('throwIfBlockedByPreCompactHook', () => {
  test('a veto throws with the hook’s own reason and notifies the user', () => {
    const { context: ctx, notifications } = context()

    expect(() =>
      throwIfBlockedByPreCompactHook(
        { blockedBy: '[.noa/hooks/guard.sh]: release build running' },
        ctx,
      ),
    ).toThrow(
      `${ERROR_MESSAGE_COMPACT_BLOCKED_BY_HOOK}: [.noa/hooks/guard.sh]: release build running`,
    )
    expect(notifications.map(n => n.key)).toEqual(['compaction-blocked-by-hook'])
  })

  test('the thrown error is distinguishable from a failed compaction', () => {
    const { context: ctx } = context()

    try {
      throwIfBlockedByPreCompactHook({ blockedBy: '[hook]' }, ctx)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CompactionBlockedError)
    }
  })

  test('the automatic paths suppress the notification', () => {
    const { context: ctx, notifications } = context()

    expect(() =>
      throwIfBlockedByPreCompactHook({ blockedBy: '[hook]' }, ctx, {
        suppressNotification: true,
      }),
    ).toThrow(CompactionBlockedError)
    expect(notifications).toEqual([])
  })

  test('hook output that is not a veto passes through untouched', () => {
    const { context: ctx, notifications } = context()

    expect(() =>
      throwIfBlockedByPreCompactHook(
        { newCustomInstructions: 'keep the notes' },
        ctx,
      ),
    ).not.toThrow()
    expect(notifications).toEqual([])
  })
})

describe('formatCompactError', () => {
  test('/compact surfaces the hook’s reason verbatim', async () => {
    const { formatCompactError } = await import(
      '../../../commands/compact/compact.js'
    )

    expect(
      formatCompactError(
        'blocked_by_hook',
        new CompactionBlockedError(
          `${ERROR_MESSAGE_COMPACT_BLOCKED_BY_HOOK}: [guard.sh]: busy`,
        ),
      ),
    ).toBe(`${ERROR_MESSAGE_COMPACT_BLOCKED_BY_HOOK}: [guard.sh]: busy`)
  })
})
