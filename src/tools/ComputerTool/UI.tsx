import React from 'react'
import { Text } from '../../ink.js'
import { COMPUTER_TOOL_NAME } from './prompt.js'

export function userFacingName(): string {
  return 'Computer'
}

export function getToolUseSummary(
  input: { action?: string } | undefined,
): string {
  return input?.action ?? COMPUTER_TOOL_NAME
}

export function renderToolUseMessage(
  input: { action?: string } & Record<string, unknown>,
): React.ReactNode {
  const action = input?.action ?? '?'
  const extras: string[] = []
  if (typeof input.x === 'number' && typeof input.y === 'number') {
    extras.push(`(${input.x}, ${input.y})`)
  }
  if (typeof input.text === 'string') {
    const preview =
      input.text.length > 40 ? input.text.slice(0, 40) + '…' : input.text
    extras.push(JSON.stringify(preview))
  }
  if (typeof input.keys === 'string') extras.push(input.keys)
  if (typeof input.name === 'string') extras.push(input.name)
  return (
    <Text>
      {action}
      {extras.length ? ' ' + extras.join(' ') : ''}
    </Text>
  )
}

export function renderToolUseErrorMessage(error: string): React.ReactNode {
  return <Text color="red">{error}</Text>
}

export function renderToolResultMessage(): React.ReactNode {
  return null
}
