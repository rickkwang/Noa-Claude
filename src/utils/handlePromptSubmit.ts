// @ts-nocheck
import type { UUID } from 'crypto'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { type Command } from '../commands.js'
import { selectableUserMessagesFilter } from '../components/MessageSelector.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import type { QuerySource } from '../constants/querySource.js'
import { expandPastedTextRefs, parseReferences } from '../history.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { IDESelection } from '../hooks/useIdeSelection.js'
import type { AppState } from '../state/AppState.js'
import type { SetToolJSXFn } from '../Tool.js'
import type { Message } from '../types/message.js'
import {
  isValidImagePaste,
  type PromptInputMode,
  type QueuedCommand,
} from '../types/textInputTypes.js'
import { handleActiveTurnSubmission } from './activeTurnSubmission.js'
import { createAbortController } from './abortController.js'
import type { PastedContent } from './config.js'
import type { EffortValue } from './effort.js'
import type { FileHistoryState } from './fileHistory.js'
import { fileHistoryEnabled, fileHistoryMakeSnapshot } from './fileHistory.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'
import { enqueue } from './messageQueueManager.js'
import { resolveSkillModelOverride } from './model/model.js'
import { processQueuedCommandsForTurn } from './queuedCommandTurnProcessor.js'
import { tryHandleImmediateLocalJsxCommand } from './immediateLocalJsxCommand.js'
import type { ProcessUserInputContext } from './processUserInput/processUserInput.js'
import type { QueryGuard } from './QueryGuard.js'
import { queryCheckpoint, startQueryProfile } from './queryProfiler.js'
import { runWithWorkload } from './workloadContext.js'

function exit(): void {
  gracefulShutdownSync(0)
}

type BaseExecutionParams = {
  queuedCommands?: QueuedCommand[]
  messages: Message[]
  mainLoopModel: string
  ideSelection: IDESelection | undefined
  querySource: QuerySource
  commands: Command[]
  queryGuard: QueryGuard
  /**
   * True when external loading (remote session, foregrounded background task)
   * is active. These don't route through queryGuard, so the queue check must
   * account for them separately. Omit (defaults to false) for the dequeue path
   * (executeQueuedInput) — dequeued items were already queued past this check.
   */
  isExternalLoading?: boolean
  setToolJSX: SetToolJSXFn
  getToolUseContext: (
    messages: Message[],
    newMessages: Message[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  setUserInputOnProcessing: (prompt?: string) => void
  setAbortController: (abortController: AbortController | null) => void
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModel: string,
    onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>,
    input?: string,
    effort?: EffortValue,
  ) => Promise<void>
  setAppState: (updater: (prev: AppState) => AppState) => void
  onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>
  canUseTool?: CanUseToolFn
}

/**
 * Parameters for core execution logic (no UI concerns).
 */
type ExecuteUserInputParams = BaseExecutionParams & {
  resetHistory: () => void
  onInputChange: (value: string) => void
}

export type PromptInputHelpers = {
  setCursorOffset: (offset: number) => void
  clearBuffer: () => void
  resetHistory: () => void
}

export type HandlePromptSubmitParams = BaseExecutionParams & {
  // Direct user input path (set when called from onSubmit, absent for queue processor)
  input?: string
  mode?: PromptInputMode
  pastedContents?: Record<number, PastedContent>
  helpers: PromptInputHelpers
  onInputChange: (value: string) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  abortController?: AbortController | null
  addNotification?: (notification: {
    key: string
    text: string
    priority: 'low' | 'medium' | 'high' | 'immediate'
  }) => void
  setMessages?: (updater: (prev: Message[]) => Message[]) => void
  streamMode?: SpinnerMode
  hasInterruptibleToolInProgress?: boolean
  uuid?: UUID
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
}

export async function handlePromptSubmit(
  params: HandlePromptSubmitParams,
): Promise<void> {
  const {
    helpers,
    queryGuard,
    isExternalLoading = false,
    commands,
    onInputChange,
    setPastedContents,
    setToolJSX,
    getToolUseContext,
    messages,
    mainLoopModel,
    ideSelection,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    canUseTool,
    queuedCommands,
    uuid,
    skipSlashCommands,
  } = params

  const { setCursorOffset, clearBuffer, resetHistory } = helpers

  // Queue processor path: commands are pre-validated and ready to execute.
  // Skip all input validation, reference parsing, and queuing logic.
  if (queuedCommands?.length) {
    startQueryProfile()
    await executeUserInput({
      queuedCommands,
      messages,
      mainLoopModel,
      ideSelection,
      querySource: params.querySource,
      commands,
      queryGuard,
      setToolJSX,
      getToolUseContext,
      setUserInputOnProcessing,
      setAbortController,
      onQuery,
      setAppState,
      onBeforeQuery,
      resetHistory,
      canUseTool,
      onInputChange,
    })
    return
  }

  const input = params.input ?? ''
  const mode = params.mode ?? 'prompt'
  const rawPastedContents = params.pastedContents ?? {}

  // Images are only sent if their [Image #N] placeholder is still in the text.
  // Deleting the inline pill drops the image; orphaned entries are filtered here.
  const referencedIds = new Set(parseReferences(input).map(r => r.id))
  const pastedContents = Object.fromEntries(
    Object.entries(rawPastedContents).filter(
      ([, c]) => c.type !== 'image' || referencedIds.has(c.id),
    ),
  )

  const hasImages = Object.values(pastedContents).some(isValidImagePaste)
  if (input.trim() === '') {
    return
  }

  // Handle exit commands by triggering the exit command instead of direct process.exit
  // Skip for remote bridge messages — "exit" typed on iOS shouldn't kill the local session
  if (
    !skipSlashCommands &&
    ['exit', 'quit', ':q', ':q!', ':wq', ':wq!'].includes(input.trim())
  ) {
    // Trigger the exit command which will show the feedback dialog
    const exitCommand = commands.find(cmd => cmd.name === 'exit')
    if (exitCommand) {
      // Submit the /exit command instead - recursive call needs to be handled
      void handlePromptSubmit({
        ...params,
        input: '/exit',
      })
    } else {
      // Fallback to direct exit if exit command not found
      exit()
    }
    return
  }

  // Parse references and replace with actual content early, before queueing
  // or immediate-command dispatch, so queued commands and immediate commands
  // both receive the expanded text from when it was submitted.
  const finalInput = expandPastedTextRefs(input, pastedContents)
  const pastedTextRefs = parseReferences(input).filter(
    r => pastedContents[r.id]?.type === 'text',
  )
  const pastedTextCount = pastedTextRefs.length
  const pastedTextBytes = pastedTextRefs.reduce(
    (sum, r) => sum + (pastedContents[r.id]?.content.length ?? 0),
    0,
  )
  logEvent('tengu_paste_text', { pastedTextCount, pastedTextBytes })

  const handledImmediateCommand = await tryHandleImmediateLocalJsxCommand({
    input: finalInput,
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
    addNotification: params.addNotification,
  })
  if (handledImmediateCommand) {
    return
  }

  const handledActiveTurnSubmission = handleActiveTurnSubmission({
    isActive: queryGuard.isActive || isExternalLoading,
    mode,
    hasInterruptibleToolInProgress: params.hasInterruptibleToolInProgress,
    streamMode: params.streamMode,
    abortController: params.abortController,
    finalInput,
    input,
    hasImages,
    pastedContents,
    skipSlashCommands,
    uuid,
    onInputChange,
    setCursorOffset,
    setPastedContents,
    resetHistory,
    clearBuffer,
  })
  if (handledActiveTurnSubmission) {
    return
  }

  // Start query profiling for this query
  startQueryProfile()

  // Construct a QueuedCommand from the direct user input so both paths
  // go through the same executeUserInput loop. This ensures images get
  // resized via processUserInput regardless of how the command arrives.
  const cmd: QueuedCommand = {
    value: finalInput,
    preExpansionValue: input,
    mode,
    pastedContents: hasImages ? pastedContents : undefined,
    skipSlashCommands,
    uuid,
  }

  await executeUserInput({
    queuedCommands: [cmd],
    messages,
    mainLoopModel,
    ideSelection,
    querySource: params.querySource,
    commands,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    onInputChange,
  })
}

/**
 * Core logic for executing user input without UI side effects.
 *
 * All commands arrive as `queuedCommands`. First command gets full treatment
 * (attachments, ideSelection, pastedContents with image resizing). Commands 2-N
 * get `skipAttachments` to avoid duplicating turn-level context.
 */
async function executeUserInput(params: ExecuteUserInputParams): Promise<void> {
  const {
    messages,
    mainLoopModel,
    ideSelection,
    querySource,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    queuedCommands,
  } = params

  // Note: paste references are already processed before calling this function
  // (either in handlePromptSubmit before queuing, or before initial execution).
  // Always create a fresh abort controller — queryGuard guarantees no concurrent
  // executeUserInput call, so there's no prior controller to inherit.
  const abortController = createAbortController()
  setAbortController(abortController)

  function makeContext(): ProcessUserInputContext {
    return getToolUseContext(messages, [], abortController, mainLoopModel)
  }

  // Wrap in try-finally so the guard is released even if processUserInput
  // throws or onQuery is skipped. onQuery's finally calls queryGuard.end(),
  // which transitions running→idle; cancelReservation() below is a no-op in
  // that case (only acts on dispatching state).
  try {
    // Reserve the guard BEFORE processUserInput — processBashCommand awaits
    // BashTool.call() and processSlashCommand awaits getMessagesForSlashCommand,
    // so the guard must be active during those awaits to ensure concurrent
    // handlePromptSubmit calls queue (via the isActive check above) instead
    // of starting a second executeUserInput. This call is a no-op if the
    // guard is already in dispatching (legacy queue-processor path).
    queryGuard.reserve()
    queryCheckpoint('query_process_user_input_start')

    const commands = queuedCommands ?? []
    const firstWorkload = commands[0]?.workload
    const turnWorkload =
      firstWorkload !== undefined &&
      commands.every(c => c.workload === firstWorkload)
        ? firstWorkload
        : undefined

    await runWithWorkload(turnWorkload, async () => {
      const {
        newMessages,
        shouldQuery,
        allowedTools,
        model,
        effort,
        nextInput,
        submitNextInput,
      } = await processQueuedCommandsForTurn({
        commands,
        messages,
        setToolJSX,
        makeContext,
        setUserInputOnProcessing,
        querySource,
        canUseTool,
        ideSelection,
      })

      queryCheckpoint('query_process_user_input_end')
      if (fileHistoryEnabled()) {
        queryCheckpoint('query_file_history_snapshot_start')
        newMessages.filter(selectableUserMessagesFilter).forEach(message => {
          void fileHistoryMakeSnapshot(
            (updater: (prev: FileHistoryState) => FileHistoryState) => {
              setAppState(prev => ({
                ...prev,
                fileHistory: updater(prev.fileHistory),
              }))
            },
            message.uuid,
          )
        })
        queryCheckpoint('query_file_history_snapshot_end')
      }

      if (newMessages.length) {
        // History is now added in the caller (onSubmit) for direct user submissions.
        // This ensures queued command processing (notifications, already-queued user input)
        // doesn't add to history, since those either shouldn't be in history or were
        // already added when originally queued.
        resetHistory()
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })

        const primaryCmd = commands[0]
        const primaryMode = primaryCmd?.mode ?? 'prompt'
        const primaryInput =
          primaryCmd && typeof primaryCmd.value === 'string'
            ? primaryCmd.value
            : undefined
        const shouldCallBeforeQuery = primaryMode === 'prompt'
        await onQuery(
          newMessages,
          abortController,
          shouldQuery,
          allowedTools ?? [],
          model
            ? resolveSkillModelOverride(model, mainLoopModel)
            : mainLoopModel,
          shouldCallBeforeQuery ? onBeforeQuery : undefined,
          primaryInput,
          effort,
        )
      } else {
        // Local slash commands that skip messages (e.g., /model, /theme).
        // Release the guard BEFORE clearing toolJSX to prevent spinner flash —
        // the spinner formula checks: (!toolJSX || showSpinner) && isLoading.
        // If we clear toolJSX while the guard is still reserved, spinner briefly
        // shows. The finally below also calls cancelReservation (no-op if idle).
        queryGuard.cancelReservation()
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })
        resetHistory()
        setAbortController(null)
      }

      // Handle nextInput from commands that want to chain (e.g., /discover activation)
      if (nextInput) {
        if (submitNextInput) {
          enqueue({ value: nextInput, mode: 'prompt' })
        } else {
          params.onInputChange(nextInput)
        }
      }
    })
  } finally {
    // Safety net: release the guard reservation if processUserInput threw
    // or onQuery was skipped. No-op if onQuery already ran (guard is idle
    // via end(), or running — cancelReservation only acts on dispatching).
    // This is the single source of truth for releasing the reservation;
    // useQueueProcessor no longer needs its own .finally().
    queryGuard.cancelReservation()
    // Safety net: clear the placeholder if processUserInput produced no
    // messages or threw — otherwise it would stay visible until the next
    // turn's resetLoadingState. Harmless when onQuery ran: setMessages grew
    // displayedMessages past the baseline, so REPL.tsx already hid it.
    setUserInputOnProcessing(undefined)
  }
}
