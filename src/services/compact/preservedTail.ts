import type { Message } from '../../types/message.js'

function getToolResultIds(message: Message): string[] {
  if (message.type !== 'user') {
    return []
  }
  const content = message.message?.content
  if (!Array.isArray(content)) {
    return []
  }
  const ids: string[] = []
  for (const block of content) {
    if (block.type === 'tool_result') {
      ids.push(block.tool_use_id)
    }
  }
  return ids
}

function hasToolUseWithIds(message: Message, toolUseIds: Set<string>): boolean {
  if (message.type !== 'assistant') {
    return false
  }
  const content = message.message?.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some(
    block => block.type === 'tool_use' && toolUseIds.has(block.id),
  )
}

/**
 * Adjust the start index to ensure we do not split:
 * 1. assistant tool_use blocks from later user tool_result blocks
 * 2. assistant fragments that share the same message.id (for thinking/tool_use merges)
 */
export function adjustIndexToPreserveAPIInvariants(
  messages: Message[],
  startIndex: number,
): number {
  if (startIndex <= 0 || startIndex >= messages.length) {
    return startIndex
  }

  let adjustedIndex = startIndex

  const allToolResultIds: string[] = []
  for (let i = startIndex; i < messages.length; i++) {
    allToolResultIds.push(...getToolResultIds(messages[i]!))
  }

  if (allToolResultIds.length > 0) {
    const toolUseIdsInKeptRange = new Set<string>()
    for (let i = adjustedIndex; i < messages.length; i++) {
      const message = messages[i]!
      if (
        message.type === 'assistant' &&
        Array.isArray(message.message?.content)
      ) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            toolUseIdsInKeptRange.add(block.id)
          }
        }
      }
    }

    const neededToolUseIds = new Set(
      allToolResultIds.filter(id => !toolUseIdsInKeptRange.has(id)),
    )

    for (let i = adjustedIndex - 1; i >= 0 && neededToolUseIds.size > 0; i--) {
      const message = messages[i]!
      if (hasToolUseWithIds(message, neededToolUseIds)) {
        adjustedIndex = i
        if (
          message.type === 'assistant' &&
          Array.isArray(message.message?.content)
        ) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use' && neededToolUseIds.has(block.id)) {
              neededToolUseIds.delete(block.id)
            }
          }
        }
      }
    }
  }

  const messageIdsInKeptRange = new Set<string>()
  for (let i = adjustedIndex; i < messages.length; i++) {
    const message = messages[i]!
    if (message.type === 'assistant' && message.message?.id) {
      messageIdsInKeptRange.add(message.message.id)
    }
  }

  for (let i = adjustedIndex - 1; i >= 0; i--) {
    const message = messages[i]!
    if (
      message.type === 'assistant' &&
      message.message?.id &&
      messageIdsInKeptRange.has(message.message.id)
    ) {
      adjustedIndex = i
    }
  }

  return adjustedIndex
}
