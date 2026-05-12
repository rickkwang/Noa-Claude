import * as React from 'react'
import { useMemo } from 'react'
import { Box, Text } from '../../ink.js'
import type {
  SessionEntry,
  SessionGroup,
} from '../../utils/background/sessionRegistry.js'
import { SessionRow } from './SessionRow.js'

type Props = {
  groups: SessionGroup[]
  loading: boolean
  selectedIndex: number
}

export function SessionsView({
  groups,
  loading,
  selectedIndex,
}: Props): React.ReactNode {
  const allSessions = useMemo(
    () => groups.flatMap(g => g.sessions),
    [groups],
  )

  const groupOffsets = useMemo(() => {
    let offset = 0
    return groups.map(g => {
      const start = offset
      offset += g.sessions.length
      return start
    })
  }, [groups])

  if (loading) {
    return (
      <Box paddingLeft={2}>
        <Text dimColor>Loading sessions...</Text>
      </Box>
    )
  }

  if (allSessions.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor>No active sessions found.</Text>
        <Text dimColor>
          Start another noa instance in a separate terminal to see it here.
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {groups.map((group, gi) => {
        const groupRows = group.sessions.map((session, si) => (
          <SessionRow
            key={session.pid}
            session={session}
            isFocused={groupOffsets[gi]! + si === selectedIndex}
          />
        ))

        return (
          <Box key={group.state} flexDirection="column" marginBottom={1}>
            <Box paddingLeft={2}>
              <Text bold dimColor>
                {group.label} ({group.sessions.length})
              </Text>
            </Box>
            {groupRows}
          </Box>
        )
      })}
    </Box>
  )
}
