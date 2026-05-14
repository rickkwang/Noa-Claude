import * as React from 'react'
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js'
import { Box, Text } from '../../ink.js'

type Props = {
  instructions?: string
}

export function AgentNavigationFooter({
  instructions = '←/→ to switch · ↑/↓ to navigate · Enter to select · Esc to close',
}: Props): React.ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings()

  return (
    <Box marginLeft={2}>
      <Text dimColor>
        {exitState.pending
          ? `Press ${exitState.keyName} again to exit`
          : instructions}
      </Text>
    </Box>
  )
}
