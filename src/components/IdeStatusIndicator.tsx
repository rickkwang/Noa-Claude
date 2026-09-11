import { basename } from 'path'
import * as React from 'react'
import { useIdeConnectionStatus } from '../hooks/useIdeConnectionStatus.js'
import type { IDESelection } from '../hooks/useIdeSelection.js'
import { Text } from '../ink.js'
import type { MCPServerConnection } from '../services/mcp/types.js'

type IdeStatusIndicatorProps = {
  ideSelection: IDESelection | undefined
  mcpClients?: MCPServerConnection[]
}

/**
 * The footer label for the selection that will ride along with the next
 * prompt. IDE selections need a connected IDE; a diff-panel selection doesn't.
 */
export function describeSelection(
  ideStatus: string | null,
  selection: IDESelection | undefined,
): string | null {
  if (!selection) return null
  const fromDiff = selection.source === 'diff'
  if (!fromDiff && ideStatus !== 'connected') return null
  if (selection.text && selection.lineCount > 0) {
    const origin =
      fromDiff && selection.filePath
        ? `from ${basename(selection.filePath)}`
        : fromDiff
          ? 'from diff'
          : 'selected'
    return `⧉ ${selection.lineCount} ${selection.lineCount === 1 ? 'line' : 'lines'} ${origin}`
  }
  if (!fromDiff && selection.filePath) {
    return `⧉ In ${basename(selection.filePath)}`
  }
  return null
}

export function IdeStatusIndicator({
  ideSelection,
  mcpClients,
}: IdeStatusIndicatorProps): React.ReactNode {
  const { status } = useIdeConnectionStatus(mcpClients)
  const label = describeSelection(status, ideSelection)
  if (label === null) return null
  return (
    <Text color="ide" key="selection-indicator" wrap="truncate">
      {label}
    </Text>
  )
}
