export function buildRenderableMessageKeys(
  messages: readonly { uuid: string }[],
  conversationId: string,
): string[] {
  const seen = new Map<string, number>()
  return messages.map(message => {
    const baseKey = `${message.uuid}-${conversationId}`
    const seenCount = seen.get(baseKey) ?? 0
    seen.set(baseKey, seenCount + 1)
    return seenCount === 0 ? baseKey : `${baseKey}-${seenCount}`
  })
}
