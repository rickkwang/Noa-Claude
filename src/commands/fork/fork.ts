// @ts-nocheck
import type { LocalCommandResult } from '../../types/command.js'
import { createConversationFork } from '../branch/branch.js'

function buildForkMessage(params: {
  sessionId: string
  originalSessionId: string
  title?: string
}): string {
  const { sessionId, originalSessionId, title } = params
  const titleSuffix = title ? ` (${title})` : ''
  return [
    `Fork created${titleSuffix}.`,
    `Fork session: ${sessionId}`,
    `Resume fork: /resume ${sessionId}`,
    `Resume original: /resume ${originalSessionId}`,
  ].join('\n')
}

export async function call(
  args: string,
): Promise<LocalCommandResult> {
  try {
    const customTitle = args.trim() || undefined
    const result = await createConversationFork(customTitle)
    return {
      type: 'text',
      value: buildForkMessage({
        sessionId: result.sessionId,
        originalSessionId: result.originalSessionId,
        title: result.effectiveTitle,
      }),
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred'
    return {
      type: 'text',
      value: `Failed to fork conversation: ${message}`,
    }
  }
}
