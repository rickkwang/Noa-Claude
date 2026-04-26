import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { Select } from '../CustomSelect/select.js'
import { Dialog } from '../design-system/Dialog.js'
import type { AgentMemoryScope } from '../../tools/AgentTool/agentMemory.js'

type SnapshotUpdateChoice = 'merge' | 'keep' | 'replace'

type SnapshotUpdateDialogProps = {
  agentType: string
  scope: AgentMemoryScope
  snapshotTimestamp: string
  onComplete: (choice: SnapshotUpdateChoice) => void
  onCancel: () => void
}

export function buildMergePrompt(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  return [
    `Review the pending memory snapshot update for agent "${agentType}" (${scope} scope).`,
    'Merge the snapshot into the existing persistent memory.',
    'Preserve useful existing details, incorporate new facts from the snapshot, and remove stale or conflicting content.',
    'Return the final merged MEMORY.md content only.',
  ].join(' ')
}

export function SnapshotUpdateDialog({
  agentType,
  scope,
  snapshotTimestamp,
  onComplete,
  onCancel,
}: SnapshotUpdateDialogProps): React.ReactNode {
  const options = [
    {
      label: 'Keep current memory',
      value: 'keep',
      description: 'Ignore the pending snapshot update for now',
    },
    {
      label: 'Merge snapshot',
      value: 'merge',
      description: 'Merge snapshot content into the current memory',
    },
    {
      label: 'Replace with snapshot',
      value: 'replace',
      description: 'Discard current memory and use the snapshot as-is',
    },
  ] as const

  return (
    <Dialog title="Update agent memory" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text>
          Pending memory snapshot for <Text bold>{agentType}</Text>
        </Text>
        <Text dimColor>
          Scope: {scope} | Snapshot: {snapshotTimestamp}
        </Text>
        <Select
          options={options}
          onChange={(value: string) => onComplete(value as SnapshotUpdateChoice)}
          onCancel={onCancel}
          defaultValue="keep"
          defaultFocusValue="keep"
        />
      </Box>
    </Dialog>
  )
}

export default SnapshotUpdateDialog
