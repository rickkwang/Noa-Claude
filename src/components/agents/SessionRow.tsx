import figures from 'figures'
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { SessionEntry, SessionState } from '../../utils/background/sessionRegistry.js'
import {
  formatRelativeTime,
  truncateCwd,
} from '../../utils/background/sessionRegistry.js'

function stateIcon(state: SessionState): { icon: string; color?: string; dimColor?: boolean } {
  switch (state) {
    case 'working':
      return { icon: '✽', color: 'cyan' }
    case 'waiting':
      return { icon: '✻', color: 'yellow' }
    case 'idle':
      return { icon: '∙', dimColor: true }
    case 'stopped':
      return { icon: '∙', dimColor: true }
    default:
      return { icon: '∙', dimColor: true }
  }
}

type Props = {
  session: SessionEntry
  isFocused: boolean
}

export function SessionRow({ session, isFocused }: Props): React.ReactNode {
  const { icon, color: iconColor, dimColor: iconDim } = stateIcon(session.derivedState)
  const textColor = isFocused ? 'suggestion' : undefined
  const label = session.name ?? session.kind ?? 'interactive'
  const cwd = session.cwd ? truncateCwd(session.cwd) : ''
  const time = session.startedAt ? formatRelativeTime(session.startedAt) : ''

  return (
    <Box>
      <Text color={textColor}>
        {isFocused ? `${figures.pointer} ` : '  '}
      </Text>
      <Text color={iconColor} dimColor={iconDim}>
        {icon}{' '}
      </Text>
      <Text color={textColor} bold={isFocused}>
        {label}
      </Text>
      {session.agent && (
        <Text dimColor color={textColor}>
          {' '}agent={session.agent}
        </Text>
      )}
      <Text dimColor color={textColor}>
        {' · '}
        {session.kind ?? 'interactive'}
      </Text>
      {cwd && (
        <Text dimColor color={textColor}>
          {' · '}
          {cwd}
        </Text>
      )}
      {session.waitingFor && session.derivedState === 'waiting' && (
        <Text color="yellow">
          {' · '}
          {session.waitingFor}
        </Text>
      )}
      {time && (
        <Text dimColor>
          {'  '}
          {time}
        </Text>
      )}
    </Box>
  )
}
