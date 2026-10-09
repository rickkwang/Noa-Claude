import * as React from 'react'
import { useRef, useState } from 'react'
import { Byline } from '../../components/design-system/Byline.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js'
import { Box, Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { isAutoCompactEnabled, resolveAutoCompactWindow } from '../../services/compact/autoCompact.js'
import { formatTokens } from '../../utils/format.js'
import {
  applyAutoCompactWindow,
  describeAutoCompactWindow,
  MAX_WINDOW,
  MIN_WINDOW,
  parseWindowArg,
  STEP,
} from './window.js'

export { parseWindowArg }

function AutoCompactWindowDialog({
  model,
  onDone,
}: {
  model: string
  onDone: (result: string) => void
}): React.ReactNode {
  const resolution = resolveAutoCompactWindow(model)
  const { name, header, unchanged } = describeAutoCompactWindow(model)
  const fromEnv = resolution.source === 'env'
  // Only an explicit setting starts from its own value; defaults start at auto.
  const initial =
    fromEnv || resolution.source === 'settings'
      ? Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.round(resolution.configured / STEP) * STEP))
      : 0
  const [value, setValue] = useState(initial)
  const [changed, setChanged] = useState(false)
  const finished = useRef(false)

  const finish = (result: string) => {
    if (finished.current) return
    finished.current = true
    onDone(result)
  }

  const adjust = (direction: number) => {
    if (fromEnv) return
    setChanged(true)
    setValue(current => {
      if (current === 0) return direction > 0 ? MIN_WINDOW : MAX_WINDOW
      const next = current + direction * STEP
      return next < MIN_WINDOW || next > MAX_WINDOW ? 0 : next
    })
  }

  const accept = () => {
    if (finished.current) return
    if (!changed) {
      finish(unchanged)
      return
    }
    finished.current = true
    void applyAutoCompactWindow(value === 0 ? 'auto' : String(value), model).then(onDone)
  }

  useKeybindings(
    {
      'select:previous': () => adjust(1),
      'select:next': () => adjust(-1),
      'select:accept': accept,
    },
    { context: 'Select' },
  )
  useKeybindings(
    { 'tabs:next': () => adjust(1), 'tabs:previous': () => adjust(-1) },
    { context: 'Tabs' },
  )

  const enabled = isAutoCompactEnabled()
  const selected = value === 0 ? 'auto' : `${formatTokens(value)} tokens`

  return (
    <Dialog
      title="Auto-compact window"
      subtitle={`Current setting for ${name}: ${header}`}
      onCancel={() => finish(unchanged)}
      inputGuide={() => (
        <Byline>
          <KeyboardShortcutHint shortcut="←/→" action="adjust" />
          <KeyboardShortcutHint shortcut="Enter" action="apply" />
          <KeyboardShortcutHint shortcut="Esc" action="cancel" />
        </Byline>
      )}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          This command configures when auto-compaction happens. The actual threshold is the minimum of this setting and your model&apos;s maximum context window.
        </Text>
        <Text>
          The auto setting picks a window tuned for your model and is{' '}
          <Text bold>strongly recommended</Text> for the best cost and performance. You can override it below.
        </Text>
        {!enabled && (
          <Text color="warning">Auto-compact is currently disabled (see /config)</Text>
        )}
        {value !== 0 && (
          <Text color="warning">
            Overriding auto may result in high token usage, especially when resuming long sessions.
          </Text>
        )}
        {fromEnv ? (
          <Text color="warning">
            CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting here.
          </Text>
        ) : (
          <Text>
            Select auto-compact window: <Text bold color="suggestion">{selected}</Text>
          </Text>
        )}
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const model = context.options.mainLoopModel
  const trimmed = (args ?? '').trim()
  if (trimmed) {
    onDone(await applyAutoCompactWindow(trimmed, model))
    return null
  }
  return (
    <AutoCompactWindowDialog
      model={model}
      onDone={result => onDone(result)}
    />
  )
}
