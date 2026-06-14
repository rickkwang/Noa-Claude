// @ts-nocheck
import * as React from 'react'
import { Select } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'

const OPTIONS = [
  { value: 'yes', label: 'Yes, move here' },
  { value: 'no', label: 'No, stay' },
]

/**
 * Confirmation shown by /cd when moving into a directory that has not been
 * trusted yet. Mirrors Claude Code's untrusted-directory gate: accepting moves
 * the session and persists trust for the new directory.
 */
export function CdConfirm({ directory, onConfirm, onCancel }) {
  const handleSelect = value => {
    if (value === 'yes') {
      onConfirm()
    } else {
      onCancel()
    }
  }
  return (
    <Box flexDirection="column" tabIndex={0} autoFocus={true}>
      <Dialog
        title="Move to a new working directory"
        onCancel={onCancel}
        color="permission"
        isCancelActive={false}
      >
        <Box flexDirection="column" gap={1} paddingX={2}>
          <Text color="permission">{directory}</Text>
          <Text dimColor={true}>
            This directory hasn't been trusted yet. Noa Claude will be able to
            read files here and make edits when auto-accept is on. Trust will be
            remembered.
          </Text>
          <Select
            options={OPTIONS}
            onChange={handleSelect}
            onCancel={onCancel}
          />
        </Box>
      </Dialog>
    </Box>
  )
}
