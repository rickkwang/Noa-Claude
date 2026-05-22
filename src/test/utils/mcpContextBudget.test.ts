import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import {
  applyPersistedMcpResourceReferenceForTesting,
  applyPlanFileReferenceBudgetForTesting,
  getMcpInstructionsDeltaAttachment,
  persistMcpResourceAttachmentForTesting,
  persistPlanFileReferenceAttachment,
  sanitizeLargeContextAttachments,
} from '../../utils/attachments.js'
import {
  getUserMessageText,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import { rewriteSanitizedAttachmentEntriesForResume } from '../../utils/sessionRestore.js'

const ORIGINAL_MCP_INSTR_DELTA = process.env.CLAUDE_CODE_MCP_INSTR_DELTA

afterEach(() => {
  if (ORIGINAL_MCP_INSTR_DELTA === undefined) {
    delete process.env.CLAUDE_CODE_MCP_INSTR_DELTA
  } else {
    process.env.CLAUDE_CODE_MCP_INSTR_DELTA = ORIGINAL_MCP_INSTR_DELTA
  }
})

describe('MCP context budgeting', () => {
  test('persisted MCP resources are slimmed before session history stores them', () => {
    const slimmed = applyPersistedMcpResourceReferenceForTesting(
      {
        type: 'mcp_resource',
        server: 'docs',
        uri: 'memory://guide',
        name: 'Guide',
        content: {
          contents: [
            {
              uri: 'memory://guide',
              text: 'FULL_RESOURCE_BODY_SHOULD_NOT_STAY_IN_HISTORY',
            },
          ],
        },
      },
      {
        filepath: '/tmp/mcp-resource.txt',
        preview: 'preview',
        originalSize: 25_000,
        hasMore: true,
      },
    )

    expect(slimmed.persistedTextPath).toBe('/tmp/mcp-resource.txt')
    expect(slimmed.content.contents).toEqual([])
  })

  test('persisted MCP resources are referenced instead of inlined in model context', () => {
    const fullOnlySentinel = 'FULL_RESOURCE_BODY_SHOULD_NOT_APPEAR'
    const normalized = normalizeMessagesForAPI([
      {
        type: 'attachment',
        id: 'attachment-1',
        uuid: '00000000-0000-4000-8000-000000000001',
        timestamp: '2026-01-01T00:00:00.000Z',
        attachments: [],
        attachment: {
          type: 'mcp_resource',
          server: 'docs',
          uri: 'memory://guide',
          name: 'Guide',
          content: {
            contents: [
              {
                uri: 'memory://guide',
                text: `preview\n${fullOnlySentinel}`,
              },
            ],
          },
          persistedTextPath: '/tmp/mcp-resource.txt',
          persistedTextPreview: 'preview',
          persistedTextOriginalSize: 25_000,
          persistedTextHasMore: true,
        },
      } as const,
    ])

    expect(normalized).toHaveLength(1)
    const text = getUserMessageText(normalized[0]!)
    expect(text).toContain('/tmp/mcp-resource.txt')
    expect(text).toContain('Preview:\npreview')
    expect(text).not.toContain(fullOnlySentinel)
  })

  test('large plan attachments are slimmed before session history stores them', () => {
    const slimmed = applyPlanFileReferenceBudgetForTesting({
      type: 'plan_file_reference',
      planFilePath: '/tmp/plan.md',
      planContent: `# Plan\n\n${'A'.repeat(20_000)}`,
    })

    expect(slimmed.planContent).toBe('')
    expect(slimmed.planPreview).toContain('# Plan')
    expect(slimmed.planOriginalSize).toBeGreaterThan(12_000)
  })

  test('large plan attachments are referenced instead of inlined in model context', () => {
    const fullOnlySentinel = 'FULL_PLAN_BODY_SHOULD_NOT_APPEAR'
    const normalized = normalizeMessagesForAPI([
      {
        type: 'attachment',
        id: 'attachment-plan-1',
        uuid: '00000000-0000-4000-8000-000000000003',
        timestamp: '2026-01-01T00:00:00.000Z',
        attachments: [],
        attachment: {
          type: 'plan_file_reference',
          planFilePath: '/tmp/plan.md',
          planContent: '',
          planPreview: 'preview',
          planOriginalSize: 25_000,
          planHasMore: true,
        },
      } as const,
    ])

    const text = getUserMessageText(normalized[0]!)
    expect(text).toContain('/tmp/plan.md')
    expect(text).toContain('Preview:\npreview')
    expect(text).not.toContain(fullOnlySentinel)
  })

  test('small MCP resources still inline their text content', () => {
    const normalized = normalizeMessagesForAPI([
      {
        type: 'attachment',
        id: 'attachment-2',
        uuid: '00000000-0000-4000-8000-000000000002',
        timestamp: '2026-01-01T00:00:00.000Z',
        attachments: [],
        attachment: {
          type: 'mcp_resource',
          server: 'docs',
          uri: 'memory://small',
          name: 'Small',
          content: {
            contents: [{ uri: 'memory://small', text: 'small resource body' }],
          },
        },
      } as const,
    ])

    const text = getUserMessageText(normalized[0]!)
    expect(text).toContain('Full contents of resource:')
    expect(text).toContain('small resource body')
  })

  test('MCP instruction delta attachments are truncated to a bounded size', () => {
    process.env.CLAUDE_CODE_MCP_INSTR_DELTA = 'true'
    const giantInstruction = `intro\n${'A'.repeat(10_000)}\nTAIL_SENTINEL`

    const attachments = getMcpInstructionsDeltaAttachment(
      [
        {
          type: 'connected',
          name: 'giant-server',
          instructions: giantInstruction,
        } as never,
      ],
      [],
      'test-model',
      [],
    )

    expect(attachments).toHaveLength(1)
    const [attachment] = attachments
    expect(attachment?.type).toBe('mcp_instructions_delta')
    if (!attachment || attachment.type !== 'mcp_instructions_delta') {
      throw new Error('Expected mcp_instructions_delta attachment')
    }

    expect(attachment.addedNames).toEqual(['giant-server'])
    expect(attachment.addedBlocks[0]).toContain('## giant-server')
    expect(attachment.addedBlocks[0]).toContain('truncated')
    expect(attachment.addedBlocks[0]).not.toContain('TAIL_SENTINEL')
    expect(attachment.addedBlocks.join('\n').length).toBeLessThanOrEqual(12_000)
  })

  test('MCP instruction delta summary stays within the total budget', () => {
    process.env.CLAUDE_CODE_MCP_INSTR_DELTA = 'true'

    const attachments = getMcpInstructionsDeltaAttachment(
      Array.from({ length: 8 }, (_, index) => ({
        type: 'connected',
        name: `server-${index}`,
        instructions: `${'A'.repeat(4_500)}-${index}`,
      })) as never,
      [],
      'test-model',
      [],
    )

    expect(attachments).toHaveLength(1)
    const [attachment] = attachments
    expect(attachment?.type).toBe('mcp_instructions_delta')
    if (!attachment || attachment.type !== 'mcp_instructions_delta') {
      throw new Error('Expected mcp_instructions_delta attachment')
    }

    expect(attachment.addedBlocks.join('\n').length).toBeLessThanOrEqual(12_000)
  })

  test('resume sanitizer slims legacy large plan attachments', async () => {
    const sanitized = await sanitizeLargeContextAttachments([
      {
        type: 'attachment',
        id: 'attachment-plan-2',
        uuid: '00000000-0000-4000-8000-000000000004',
        timestamp: '2026-01-01T00:00:00.000Z',
        attachments: [],
        attachment: {
          type: 'plan_file_reference',
          planFilePath: '/tmp/legacy-plan.md',
          planContent: `# Legacy Plan\n\n${'B'.repeat(20_000)}`,
        },
      } as const,
    ])

    expect(sanitized).toHaveLength(1)
    const message = sanitized[0]
    expect(message?.type).toBe('attachment')
    if (!message || message.type !== 'attachment') {
      throw new Error('Expected attachment message')
    }

    const { attachment } = message
    expect(attachment?.type).toBe('plan_file_reference')
    if (!attachment || attachment.type !== 'plan_file_reference') {
      throw new Error('Expected plan_file_reference attachment')
    }

    expect(attachment.planContent).toBe('')
    expect(attachment.planPreview).toContain('# Legacy Plan')
  })

  test('plan attachments rehome persisted files into the current session tool-results dir', async () => {
    const foreignPath = join('/private/tmp', `foreign-plan-${randomUUID()}.txt`)
    const targetDir = join('/private/tmp', `rehomed-plan-${randomUUID()}`)
    await writeFile(foreignPath, '# Foreign Plan\n\nBody', 'utf-8')

    const persisted = await persistPlanFileReferenceAttachment({
      type: 'plan_file_reference',
      planFilePath: '/tmp/live-plan.md',
      planContent: '',
      persistedPlanPath: foreignPath,
      planPreview: '# Foreign Plan',
      planOriginalSize: 10_000,
      planHasMore: true,
    }, { persistDirOverride: targetDir })

    expect(persisted.persistedPlanPath).not.toBe(foreignPath)
    expect(persisted.persistedPlanPath).toContain(targetDir)
  })

  test('MCP attachments rehome persisted files into the current session tool-results dir', async () => {
    const foreignPath = join('/private/tmp', `foreign-mcp-${randomUUID()}.txt`)
    const targetDir = join('/private/tmp', `rehomed-mcp-${randomUUID()}`)
    await writeFile(foreignPath, 'Full contents of resource:\n\nMCP body', 'utf-8')

    const attachment = await persistMcpResourceAttachmentForTesting(
      {
        type: 'mcp_resource',
        server: 'docs',
        uri: 'memory://foreign',
        name: 'Foreign',
        content: { contents: [] },
        persistedTextPath: foreignPath,
        persistedTextPreview: 'MCP body',
        persistedTextOriginalSize: 25_000,
        persistedTextHasMore: true,
      },
      { persistDirOverride: targetDir },
    )

    expect(attachment.persistedTextPath).not.toBe(foreignPath)
    expect(attachment.persistedTextPath).toContain(targetDir)
  })

  test('resume transcript rewrite updates only sanitized attachment entries', () => {
    const originalMessages = [
      {
        type: 'attachment',
        id: 'attachment-plan-3',
        uuid: '00000000-0000-4000-8000-000000000010',
        timestamp: '2026-01-01T00:00:00.000Z',
        attachment: {
          type: 'plan_file_reference',
          planFilePath: '/tmp/legacy-plan.md',
          planContent: `# Legacy Plan\n\n${'B'.repeat(20_000)}`,
        },
      },
    ] as const
    const sanitizedMessages = [
      {
        ...originalMessages[0],
        attachment: {
          type: 'plan_file_reference',
          planFilePath: '/tmp/legacy-plan.md',
          planContent: '',
          planPreview: '# Legacy Plan',
          planOriginalSize: 20_100,
          planHasMore: true,
        },
      },
    ] as const

    const originalLine = JSON.stringify({
      ...originalMessages[0],
      parentUuid: null,
      isSidechain: false,
      sessionId: 'session-1',
    })
    const metadataLine = JSON.stringify({
      type: 'custom-title',
      title: 'Keep Me',
      sessionId: 'session-1',
    })

    const rewritten = rewriteSanitizedAttachmentEntriesForResume(
      `${originalLine}\n${metadataLine}\n`,
      originalMessages,
      sanitizedMessages,
    )

    expect(rewritten.changed).toBe(true)
    expect(rewritten.content).toContain('"planPreview":"# Legacy Plan"')
    expect(rewritten.content).toContain(metadataLine)
    expect(rewritten.content).not.toContain('"planContent":"# Legacy Plan')
  })
})
