// @ts-nocheck
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { IDESelection } from '../hooks/useIdeSelection.js'
import type { SetToolJSXFn } from '../Tool.js'
import type { QuerySource } from '../constants/querySource.js'
import type { Message } from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import type { EffortValue } from './effort.js'
import type { ProcessUserInputContext } from './processUserInput/processUserInput.js'
import { processUserInput } from './processUserInput/processUserInput.js'

type ProcessQueuedCommandsForTurnParams = {
  commands: QueuedCommand[]
  messages: Message[]
  setToolJSX: SetToolJSXFn
  makeContext: () => ProcessUserInputContext
  setUserInputOnProcessing: (prompt?: string) => void
  querySource: QuerySource
  canUseTool?: CanUseToolFn
  ideSelection: IDESelection | undefined
}

type ProcessQueuedCommandsForTurnResult = {
  newMessages: Message[]
  shouldQuery: boolean
  allowedTools: string[] | undefined
  model: string | undefined
  effort: EffortValue | undefined
  nextInput: string | undefined
  submitNextInput: boolean | undefined
}

/**
 * Process all queued commands for a single turn.
 * Handles first-command special behavior, origin stamping, and workload
 * propagation across the async command processing loop.
 */
export async function processQueuedCommandsForTurn(
  params: ProcessQueuedCommandsForTurnParams,
): Promise<ProcessQueuedCommandsForTurnResult> {
  const {
    commands,
    messages,
    setToolJSX,
    makeContext,
    setUserInputOnProcessing,
    querySource,
    canUseTool,
    ideSelection,
  } = params

  const newMessages: Message[] = []
  let shouldQuery = false
  let allowedTools: string[] | undefined
  let model: string | undefined
  let effort: EffortValue | undefined
  let nextInput: string | undefined
  let submitNextInput: boolean | undefined

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    const isFirst = i === 0
    const result = await processUserInput({
      input: cmd.value,
      preExpansionInput: cmd.preExpansionValue,
      mode: cmd.mode,
      setToolJSX,
      context: makeContext(),
      pastedContents: isFirst ? cmd.pastedContents : undefined,
      messages,
      setUserInputOnProcessing: isFirst ? setUserInputOnProcessing : undefined,
      isAlreadyProcessing: !isFirst,
      querySource,
      canUseTool,
      uuid: cmd.uuid,
      ideSelection: isFirst ? ideSelection : undefined,
      skipSlashCommands: cmd.skipSlashCommands,
      bridgeOrigin: cmd.bridgeOrigin,
      isMeta: cmd.isMeta,
      skipAttachments: !isFirst,
    })

    // Stamp origin without threading it through the entire processUserInput
    // stack. task-notification mirrors queued_command origin derivation.
    const origin =
      cmd.origin ??
      (cmd.mode === 'task-notification'
        ? ({ kind: 'task-notification' } as const)
        : undefined)
    if (origin) {
      for (const m of result.messages) {
        if (m.type === 'user') m.origin = origin
      }
    }

    newMessages.push(...result.messages)
    if (isFirst) {
      shouldQuery = result.shouldQuery
      allowedTools = result.allowedTools
      model = result.model
      effort = result.effort
      nextInput = result.nextInput
      submitNextInput = result.submitNextInput
    }
  }

  return {
    newMessages,
    shouldQuery,
    allowedTools,
    model,
    effort,
    nextInput,
    submitNextInput,
  }
}
