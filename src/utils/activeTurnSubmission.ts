// @ts-nocheck
import type { UUID } from 'crypto'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { type SpinnerMode } from '../components/Spinner/types.js'
import { type PromptInputMode } from '../types/textInputTypes.js'
import type { PastedContent } from './config.js'
import { logForDebugging } from './debug.js'
import { enqueue } from './messageQueueManager.js'

type HandleActiveTurnSubmissionParams = {
  isActive: boolean
  mode: PromptInputMode
  hasInterruptibleToolInProgress?: boolean
  streamMode?: SpinnerMode
  abortController?: AbortController | null
  finalInput: string
  input: string
  hasImages: boolean
  pastedContents: Record<number, PastedContent>
  skipSlashCommands?: boolean
  uuid?: UUID
  onInputChange: (value: string) => void
  setCursorOffset: (offset: number) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  resetHistory: () => void
  clearBuffer: () => void
}

/**
 * Handle submissions while another turn is already active.
 * Returns true when handled (queued/dropped), false when caller should continue
 * with normal immediate execution flow.
 */
export function handleActiveTurnSubmission(
  params: HandleActiveTurnSubmissionParams,
): boolean {
  const {
    isActive,
    mode,
    hasInterruptibleToolInProgress,
    streamMode,
    abortController,
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
  } = params

  if (!isActive) {
    return false
  }

  // Only allow prompt and bash mode commands to be queued.
  if (mode !== 'prompt' && mode !== 'bash') {
    return true
  }

  // Interrupt the current turn when all executing tools have
  // interruptBehavior 'cancel' (e.g. SleepTool).
  if (hasInterruptibleToolInProgress) {
    logForDebugging(
      `[interrupt] Aborting current turn: streamMode=${streamMode}`,
    )
    logEvent('tengu_cancel', {
      source:
        'interrupt_on_submit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      streamMode:
        streamMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    abortController?.abort('interrupt')
  }

  // Enqueue with string value + raw pastedContents. Images will be resized
  // at execution time when processUserInput runs (not baked in here).
  enqueue({
    value: finalInput.trim(),
    preExpansionValue: input.trim(),
    mode,
    pastedContents: hasImages ? pastedContents : undefined,
    skipSlashCommands,
    uuid,
  })

  onInputChange('')
  setCursorOffset(0)
  setPastedContents({})
  resetHistory()
  clearBuffer()
  return true
}
