import { describe, expect, test } from 'bun:test'
import type { HookResultMessage, Message } from '../../types/message.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { dropRepeatedSessionStartContext } from '../../utils/sessionStart.js'

function additionalContext(content: string[]): HookResultMessage {
  return createAttachmentMessage({
    type: 'hook_additional_context',
    content,
    hookName: 'SessionStart',
    toolUseID: 'SessionStart',
    hookEvent: 'SessionStart',
  }) as unknown as HookResultMessage
}

function hookStdout(content: string): HookResultMessage {
  return createAttachmentMessage({
    type: 'hook_success',
    hookName: 'SessionStart:resume',
    toolUseID: 'tool-use',
    hookEvent: 'SessionStart',
    content,
    stdout: content,
    stderr: '',
    exitCode: 0,
  }) as unknown as HookResultMessage
}

function hookError(): HookResultMessage {
  return createAttachmentMessage({
    type: 'hook_non_blocking_error',
    hookName: 'SessionStart:resume',
    toolUseID: 'tool-use',
    hookEvent: 'SessionStart',
    stderr: 'boom',
    stdout: '',
    exitCode: 1,
  }) as unknown as HookResultMessage
}

const turn = () => createUserMessage({ content: 'earlier request' })

const contentOf = (message: HookResultMessage | undefined) =>
  (message as unknown as { attachment: { content: string[] } }).attachment
    .content

describe('dropRepeatedSessionStartContext', () => {
  test('context already in the conversation is not stacked again on resume', () => {
    const conversation: Message[] = [
      additionalContext(['branch: main']),
      hookStdout('project notes'),
      turn(),
    ]

    expect(
      dropRepeatedSessionStartContext(conversation, [
        additionalContext(['branch: main']),
        hookStdout('project notes'),
      ]),
    ).toEqual([])
  })

  test('changed context is added, keeping only the entries that are new', () => {
    const conversation: Message[] = [additionalContext(['branch: main']), turn()]
    const changed = additionalContext(['branch: main', 'dirty: 3 files'])

    const [kept] = dropRepeatedSessionStartContext(conversation, [changed])

    expect(contentOf(kept)).toEqual(['dirty: 3 files'])
    expect(contentOf(changed)).toEqual(['branch: main', 'dirty: 3 files'])
  })

  test('context that survives only before the last compact boundary is added again', () => {
    const conversation: Message[] = [
      additionalContext(['branch: main']),
      turn(),
      createCompactBoundaryMessage('manual', 100_000) as unknown as Message,
      createUserMessage({ content: 'Summary: …', isCompactSummary: true }),
    ]
    const hookMessages = [additionalContext(['branch: main'])]

    expect(dropRepeatedSessionStartContext(conversation, hookMessages)).toEqual(
      hookMessages,
    )
  })

  test('messages carrying no model-facing SessionStart context pass through', () => {
    const conversation: Message[] = [hookStdout('project notes'), turn()]
    const hookMessages = [hookError(), hookStdout('')]

    expect(dropRepeatedSessionStartContext(conversation, hookMessages)).toEqual(
      hookMessages,
    )
  })

  test('a first resume with no earlier hook output adds everything', () => {
    const hookMessages = [additionalContext(['branch: main']), hookStdout('notes')]

    expect(dropRepeatedSessionStartContext([turn()], hookMessages)).toBe(
      hookMessages,
    )
  })
})
