import * as React from 'react'
import { useRef } from 'react'
import { Select } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'

type CdTrustPromptProps = {
  directory: string
  trustRoot: string | undefined
  disclosures: string[]
  /** Trust inherited from a parent: only the project grants are in question. */
  backstop: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Ignores an Enter that arrives right as the prompt opens, so a key still held
// from the /cd command cannot confirm the move.
const CONFIRM_GUARD_MS = 500

/**
 * Shown by /cd before moving into a directory that is not trusted yet, and
 * after a move that leaves project grants gated. Accepting persists trust for
 * the destination; the caller then applies the grants or runs the move.
 */
export function CdTrustPrompt({
  directory,
  trustRoot,
  disclosures,
  backstop,
  onConfirm,
  onCancel,
}: CdTrustPromptProps): React.ReactNode {
  const options = backstop
    ? [
        { value: 'no', label: 'No, keep them off' },
        { value: 'yes', label: 'Yes, trust it and apply them' },
      ]
    : [
        { value: 'no', label: 'No, stay put' },
        { value: 'yes', label: 'Yes, move here' },
      ]
  const openedAt = useRef(Date.now())
  const handleSelect = (value: string): void => {
    if (value !== 'yes') {
      onCancel()
      return
    }
    if (Date.now() - openedAt.current < CONFIRM_GUARD_MS) return
    onConfirm()
  }
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Dialog
        title={backstop ? 'Now in a new directory:' : 'Moving to a new directory:'}
        color="warning"
        onCancel={onCancel}
        isCancelActive={false}
      >
        <Box flexDirection="column" gap={1} paddingX={2}>
          <Text bold={true}>{directory}</Text>
          {trustRoot !== undefined && (
            <Text>
              This directory is part of the repository at{' '}
              <Text bold={true}>{trustRoot}</Text>. Trusting it trusts that
              whole repository, including its other worktrees and
              subdirectories.
            </Text>
          )}
          {backstop ? (
            <Text>
              Its settings declare project permission rules and/or additional
              directories. They apply only if you trust this directory
              explicitly (it is trusted through a parent directory so far).
            </Text>
          ) : (
            <>
              <Text>
                This session hasn't worked here before. Is this a directory you
                created or one you trust?
              </Text>
              <Text>
                Noa Claude will be able to read, edit, and execute files here.
              </Text>
            </>
          )}
          {disclosures.length > 0 && (
            <Box flexDirection="column">
              {disclosures.map(line => (
                <Text key={line} dimColor={true}>
                  {line}
                </Text>
              ))}
            </Box>
          )}
          <Select
            options={options}
            onChange={handleSelect}
            onCancel={onCancel}
          />
        </Box>
      </Dialog>
    </Box>
  )
}
