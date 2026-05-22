// @ts-nocheck
import * as React from 'react'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import { useShortcutDisplay } from 'src/keybindings/useShortcutDisplay.js'
import {
  builtInCommandNames,
  type Command,
  type CommandResultDisplay,
} from '../../commands.js'
import { useIsInsideModal } from '../../context/modalContext.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Link, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { PRODUCT_HELP_URL } from '../../constants/docs.js'
import { Pane } from '../design-system/Pane.js'
import { Tab, Tabs } from '../design-system/Tabs.js'
import { Commands } from './Commands.js'
import { General } from './General.js'

type Props = {
  onClose: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
    },
  ) => void
  commands: Command[]
}

export function HelpV2({ onClose, commands }: Props): React.ReactNode {
  const { rows, columns } = useTerminalSize()
  const maxHeight = Math.floor(rows / 2)
  const insideModal = useIsInsideModal()

  const close = React.useCallback(
    () => onClose('Help dialog dismissed', { display: 'system' }),
    [onClose],
  )

  useKeybinding('help:dismiss', close, { context: 'Help' })
  const exitState = useExitOnCtrlCDWithKeybindings(close)
  const dismissShortcut = useShortcutDisplay('help:dismiss', 'Help', 'esc')

  const builtinNames = builtInCommandNames()
  const builtinCommands = commands.filter(
    cmd => builtinNames.has(cmd.name) && !cmd.isHidden,
  )
  const customCommands = commands.filter(
    cmd => !builtinNames.has(cmd.name) && !cmd.isHidden,
  )

  const footerHint = exitState.pending
    ? `Press ${exitState.keyName} again to exit`
    : `←/→ to switch tabs, ↓ to browse, ${dismissShortcut} to close`

  return (
    <Box flexDirection="column" height={insideModal ? undefined : maxHeight}>
      <Pane color="professionalBlue">
        <Tabs
          title="Help"
          color="professionalBlue"
          defaultTab="general"
        >
          <Tab key="general" id="general" title="General">
            <General />
          </Tab>
          <Tab key="commands" id="commands" title="Commands">
            <Commands
              commands={builtinCommands}
              maxHeight={maxHeight}
              columns={columns}
              title="Browse default commands:"
              onCancel={close}
            />
          </Tab>
          <Tab key="custom" id="custom" title="Custom-Commands">
            <Commands
              commands={customCommands}
              maxHeight={maxHeight}
              columns={columns}
              title="Browse custom commands:"
              emptyMessage="No custom commands found"
              onCancel={close}
            />
          </Tab>
        </Tabs>
        <Box marginTop={1} flexDirection="column">
          <Text>
            For more help:{' '}
            <Link url={PRODUCT_HELP_URL} />
          </Text>
          <Box marginTop={1}>
            <Text dimColor={true} italic={true}>
              {footerHint}
            </Text>
          </Box>
        </Box>
      </Pane>
    </Box>
  )
}
