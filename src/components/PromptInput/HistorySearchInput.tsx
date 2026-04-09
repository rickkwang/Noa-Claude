// @ts-nocheck
import * as React from 'react'
import { stringWidth } from '../../ink/stringWidth.js'
import { Box, Text } from '../../ink.js'
import TextInput from '../TextInput.js'

type Props = {
  value: string
  onChange: (value: string) => void
  historyFailedMatch: boolean
  historyMatchTimestamp: number | undefined
}

function formatHistoryMatchAge(timestamp: number): string {
  const deltaMs = Math.max(0, Date.now() - timestamp)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (deltaMs < minuteMs) return 'just now'
  if (deltaMs < hourMs) return `${Math.floor(deltaMs / minuteMs)}m ago`
  if (deltaMs < dayMs) return `${Math.floor(deltaMs / hourMs)}h ago`
  return `${Math.floor(deltaMs / dayMs)}d ago`
}

function HistorySearchInput({
  value,
  onChange,
  historyFailedMatch,
  historyMatchTimestamp,
}: Props): React.ReactNode {
  return (
    <Box gap={1}>
      <Text dimColor>
        {historyFailedMatch ? 'no matching prompt:' : 'search prompts:'}
      </Text>
      <TextInput
        value={value}
        onChange={onChange}
        cursorOffset={value.length}
        onChangeCursorOffset={() => {}}
        columns={stringWidth(value) + 1}
        focus
        showCursor
        multiline={false}
        dimColor
      />
      {!historyFailedMatch && historyMatchTimestamp ? (
        <Text dimColor>{formatHistoryMatchAge(historyMatchTimestamp)}</Text>
      ) : null}
    </Box>
  )
}

export default HistorySearchInput
