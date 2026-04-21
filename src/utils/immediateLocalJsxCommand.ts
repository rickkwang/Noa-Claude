// @ts-nocheck
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { type Command, getCommandName, isCommandEnabled } from '../commands.js'
import type { SetToolJSXFn } from '../Tool.js'
import type { Message } from '../types/message.js'
import type { LocalJSXCommandOnDone } from '../types/command.js'
import { createAbortController } from './abortController.js'
import type { ProcessUserInputContext } from './processUserInput/processUserInput.js'
import type { QueryGuard } from './QueryGuard.js'
import { enqueue } from './messageQueueManager.js'

type TryHandleImmediateLocalJsxCommandParams = {
  input: string
  skipSlashCommands?: boolean
  commands: Command[]
  queryGuard: QueryGuard
  isExternalLoading: boolean
  onInputChange: (value: string) => void
  setCursorOffset: (offset: number) => void
  setPastedContents: React.Dispatch<React.SetStateAction<Record<number, unknown>>>
  clearBuffer: () => void
  setToolJSX: SetToolJSXFn
  getToolUseContext: (
    messages: Message[],
    newMessages: Message[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  messages: Message[]
  mainLoopModel: string
  addNotification?: (notification: {
    key: string
    text: string
    priority: 'low' | 'medium' | 'high' | 'immediate'
  }) => void
}

/**
 * Handle local-jsx immediate commands (e.g., /config, /doctor) while a turn
 * is already active. Returns true when the command was handled and caller
 * should stop further processing.
 */
export async function tryHandleImmediateLocalJsxCommand(
  params: TryHandleImmediateLocalJsxCommandParams,
): Promise<boolean> {
  const {
    input,
    skipSlashCommands,
    commands,
    queryGuard,
    isExternalLoading,
    onInputChange,
    setCursorOffset,
    setPastedContents,
    clearBuffer,
    setToolJSX,
    getToolUseContext,
    messages,
    mainLoopModel,
    addNotification,
  } = params

  // Skip for remote bridge messages — slash commands from CCR clients are plain text.
  if (skipSlashCommands || !input.trim().startsWith('/')) {
    return false
  }

  const trimmedInput = input.trim()
  const spaceIndex = trimmedInput.indexOf(' ')
  const commandName =
    spaceIndex === -1
      ? trimmedInput.slice(1)
      : trimmedInput.slice(1, spaceIndex)
  const commandArgs =
    spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim()

  const immediateCommand = commands.find(
    cmd =>
      cmd.immediate &&
      isCommandEnabled(cmd) &&
      (cmd.name === commandName ||
        cmd.aliases?.includes(commandName) ||
        getCommandName(cmd) === commandName),
  )

  if (
    !immediateCommand ||
    immediateCommand.type !== 'local-jsx' ||
    (!queryGuard.isActive && !isExternalLoading)
  ) {
    return false
  }

  logEvent('tengu_immediate_command_executed', {
    commandName:
      immediateCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  // Clear input before rendering immediate command UI.
  onInputChange('')
  setCursorOffset(0)
  setPastedContents({})
  clearBuffer()

  const context = getToolUseContext(
    messages,
    [],
    createAbortController(),
    mainLoopModel,
  )

  let doneWasCalled = false
  const onDone: LocalJSXCommandOnDone = (result, options) => {
    doneWasCalled = true
    setToolJSX({
      jsx: null,
      shouldHidePromptInput: false,
      clearLocalJSX: true,
    })

    if (result && options?.display !== 'skip' && addNotification) {
      addNotification({
        key: `immediate-${immediateCommand.name}`,
        text: result,
        priority: 'immediate',
      })
    }

    if (options?.nextInput) {
      if (options.submitNextInput) {
        enqueue({ value: options.nextInput, mode: 'prompt' })
      } else {
        onInputChange(options.nextInput)
      }
    }
  }

  const impl = await immediateCommand.load()
  const jsx = await impl.call(onDone, context, commandArgs)

  // Skip if onDone already fired — prevents stuck isLocalJSXCommand.
  if (jsx && !doneWasCalled) {
    setToolJSX({
      jsx,
      shouldHidePromptInput: false,
      isLocalJSXCommand: true,
      isImmediate: true,
    })
  }

  return true
}
