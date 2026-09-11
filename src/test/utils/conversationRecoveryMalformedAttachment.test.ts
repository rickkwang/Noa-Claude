import { describe, expect, test } from 'bun:test'
import {
  deserializeMessages,
  deserializeMessagesWithInterruptDetection,
  dropEphemeralAttachments,
  dropMalformedAttachments,
  isWellFormedAttachmentPayload,
  restoreSkillStateFromMessages,
} from '../../utils/conversationRecovery.js'
import { createUserMessage } from '../../utils/messages.js'

// Minimal attachment message; deserialize/migration only look at .type + .attachment.
function attachment(payload: unknown): any {
  return { type: 'attachment', attachments: [], attachment: payload }
}

describe('isWellFormedAttachmentPayload', () => {
  test('rejects null / non-object / missing type', () => {
    expect(isWellFormedAttachmentPayload(null)).toBe(false)
    expect(isWellFormedAttachmentPayload(undefined)).toBe(false)
    expect(isWellFormedAttachmentPayload('nope')).toBe(false)
    expect(isWellFormedAttachmentPayload({})).toBe(false)
    expect(isWellFormedAttachmentPayload({ type: 123 })).toBe(false)
  })

  test('new_file / new_directory require their path fields as strings', () => {
    expect(isWellFormedAttachmentPayload({ type: 'new_file', filename: 'a.ts' })).toBe(true)
    expect(isWellFormedAttachmentPayload({ type: 'new_file' })).toBe(false)
    expect(isWellFormedAttachmentPayload({ type: 'new_file', filename: 5 })).toBe(false)
    expect(isWellFormedAttachmentPayload({ type: 'new_directory', path: '/x' })).toBe(true)
    expect(isWellFormedAttachmentPayload({ type: 'new_directory' })).toBe(false)
  })

  test('invoked_skills requires an array of non-null objects', () => {
    expect(
      isWellFormedAttachmentPayload({ type: 'invoked_skills', skills: [{ name: 's' }] }),
    ).toBe(true)
    expect(isWellFormedAttachmentPayload({ type: 'invoked_skills' })).toBe(false)
    expect(
      isWellFormedAttachmentPayload({ type: 'invoked_skills', skills: 'nope' }),
    ).toBe(false)
    expect(
      isWellFormedAttachmentPayload({ type: 'invoked_skills', skills: [null] }),
    ).toBe(false)
  })

  test('hook_success / hook_additional_context / skill_listing shapes', () => {
    expect(isWellFormedAttachmentPayload({ type: 'hook_success', content: 'ok' })).toBe(true)
    expect(isWellFormedAttachmentPayload({ type: 'hook_success' })).toBe(false)
    expect(
      isWellFormedAttachmentPayload({ type: 'hook_additional_context', content: ['a', 'b'] }),
    ).toBe(true)
    expect(
      isWellFormedAttachmentPayload({ type: 'hook_additional_context', content: [1] }),
    ).toBe(false)
    // skill_listing: names is optional, but must be an array when present
    expect(isWellFormedAttachmentPayload({ type: 'skill_listing' })).toBe(true)
    expect(isWellFormedAttachmentPayload({ type: 'skill_listing', names: ['x'] })).toBe(true)
    expect(isWellFormedAttachmentPayload({ type: 'skill_listing', names: 'x' })).toBe(false)
  })

  test('unknown types pass through (crash-guard, not schema gate)', () => {
    expect(isWellFormedAttachmentPayload({ type: 'todo_reminder', whatever: 1 })).toBe(true)
    expect(isWellFormedAttachmentPayload({ type: 'queued_command' })).toBe(true)
  })
})

describe('dropMalformedAttachments', () => {
  test('removes only malformed attachment messages, keeps everything else', () => {
    const good = attachment({ type: 'new_file', filename: 'a.ts' })
    const badNoPayload = { type: 'attachment', attachments: [] } // attachment undefined
    const badPayload = attachment({ type: 'new_file' }) // missing filename
    const user = createUserMessage({ content: 'hi' })

    const out = dropMalformedAttachments([good, badNoPayload as any, badPayload, user as any])

    expect(out).toContain(good)
    expect(out).toContain(user as any)
    expect(out).not.toContain(badNoPayload as any)
    expect(out).not.toContain(badPayload)
  })

  test('returns the same array reference when nothing is malformed', () => {
    const input = [attachment({ type: 'hook_success', content: 'ok' })]
    expect(dropMalformedAttachments(input)).toBe(input)
  })
})

describe('resume no longer crashes on malformed attachments', () => {
  test('deserializeMessages drops a malformed attachment instead of throwing', () => {
    const messages = [
      createUserMessage({ content: 'before' }) as any,
      // Would crash migrateLegacyAttachmentTypes: new_file with no filename.
      attachment({ type: 'new_file' }),
      // Would crash on attachment.type: attachment payload entirely absent.
      { type: 'attachment', attachments: [] },
    ]

    let out: ReturnType<typeof deserializeMessages>
    expect(() => {
      out = deserializeMessages(messages)
    }).not.toThrow()

    // The user message survives; no attachment payload dereference blew up.
    expect(out!.some(m => m.type === 'user')).toBe(true)
    expect(JSON.stringify(out!)).toContain('before')
    // Both malformed attachments were dropped from the resumed transcript.
    expect(out!.some(m => m.type === 'attachment')).toBe(false)
  })

  test('restoreSkillStateFromMessages does not throw on malformed attachments', () => {
    expect(() => {
      restoreSkillStateFromMessages([
        { type: 'attachment', attachments: [] } as any, // null payload
        attachment({ type: 'invoked_skills', skills: 'not-an-array' }),
        attachment({ type: 'invoked_skills' }), // missing skills
      ])
    }).not.toThrow()
  })

  test('a well-formed legacy new_file attachment still migrates without error', () => {
    expect(() => {
      deserializeMessages([attachment({ type: 'new_file', filename: 'x.ts' })])
    }).not.toThrow()
  })
})

describe('dropEphemeralAttachments', () => {
  test('drops one-shot reminders and keeps context attachments', () => {
    const reminder = attachment({ type: 'verify_plan_reminder' })
    const kept = [
      createUserMessage({ content: 'hello' }),
      attachment({ type: 'compact_file_reference', filename: '/repo/a.ts' }),
      attachment({ type: 'invoked_skills', skills: [] }),
    ]
    const out = dropEphemeralAttachments([
      kept[0],
      attachment({ type: 'compaction_reminder' }),
      kept[1],
      reminder,
      attachment({ type: 'companion_intro', name: 'x', species: 'y' }),
      kept[2],
    ])
    expect(out).toEqual(kept)
  })

  test('returns the same array when nothing is dropped', () => {
    const messages = [createUserMessage({ content: 'hello' })]
    expect(dropEphemeralAttachments(messages)).toBe(messages)
  })

  test('resume never replays a stale reminder', () => {
    const out = deserializeMessages([
      createUserMessage({ content: 'implement the plan' }),
      attachment({ type: 'verify_plan_reminder' }),
    ])
    expect(JSON.stringify(out)).not.toContain('verify_plan_reminder')
  })
})

describe('turn interruption with trailing attachments', () => {
  const assistantReply = (text: string): any => ({
    type: 'assistant',
    uuid: `a-${text}`,
    message: {
      id: `a-${text}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  })
  const stopHookOutput = () =>
    attachment({
      type: 'hook_success',
      hookName: 'Stop',
      hookEvent: 'Stop',
      toolUseID: 't',
      content: 'Stop hook completed',
    })

  test('Stop hook output after a completed turn is not an interruption', () => {
    const result = deserializeMessagesWithInterruptDetection([
      createUserMessage({ content: 'do the thing' }),
      assistantReply('done'),
      stopHookOutput(),
    ])
    expect(result.turnInterruptionState.kind).toBe('none')
    expect(JSON.stringify(result.messages)).not.toContain(
      'Continue from where you left off.',
    )
  })

  test('attachments trailing a compact summary are not an interruption', () => {
    const result = deserializeMessagesWithInterruptDetection([
      createUserMessage({ content: 'Summary: earlier work', isCompactSummary: true }),
      attachment({ type: 'compact_file_reference', filename: '/repo/a.ts' }),
    ])
    expect(result.turnInterruptionState.kind).toBe('none')
  })

  test('attachments trailing an unanswered prompt still resume the turn', () => {
    const result = deserializeMessagesWithInterruptDetection([
      createUserMessage({ content: 'first' }),
      assistantReply('reply'),
      createUserMessage({ content: 'second, never answered' }),
      attachment({ type: 'compact_file_reference', filename: '/repo/a.ts' }),
    ])
    expect(result.turnInterruptionState.kind).toBe('interrupted_prompt')
    expect(JSON.stringify(result.messages)).toContain(
      'Continue from where you left off.',
    )
  })
})
