// @ts-nocheck
import chalk from 'chalk'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import {
  beginCompactLifecycle,
  compactConversation,
  endCompactLifecycle,
  ERROR_MESSAGE_INCOMPLETE_RESPONSE,
  ERROR_MESSAGE_NOT_ENOUGH_MESSAGES,
  type PreCompactHookResult,
} from '../../services/compact/compact.js'
import { suppressCompactWarning } from '../../services/compact/compactWarningState.js'
import { microcompactMessages } from '../../services/compact/microCompact.js'
import { runPostCompactCleanup } from '../../services/compact/postCompactCleanup.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalCommandCall } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import { executePreCompactHooks } from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getUpgradeMessage } from '../../utils/model/contextWindowUpgradeCheck.js'
import {
  buildEffectiveSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPrompt.js'

export const call: LocalCommandCall = async (args, context) => {
  const { abortController } = context
  let { messages } = context

  // REPL keeps snipped messages for UI scrollback — project so the compact
  // model doesn't summarize content that was intentionally removed.
  messages = getMessagesAfterCompactBoundary(messages)

  if (messages.length === 0) {
    throw new Error('No messages to compact')
  }

  const customInstructions = args.trim()
  const displayMode = customInstructions ? 'custom' : 'default'

  // This handler owns the compact_start / compact_end lifecycle;
  // compactConversation does not emit those events itself.
  beginCompactLifecycle(context)

  try {
    const preCompactHookResult: PreCompactHookResult =
      await executePreCompactHooks(
        {
          trigger: 'manual',
          customInstructions: customInstructions || null,
        },
        context.abortController.signal,
      )

    context.onCompactProgress?.({ type: 'compact_start' })

    // Microcompact first so the summary request carries fewer tokens
    const microcompactResult = await microcompactMessages(messages, context)
    const messagesForCompact = microcompactResult.messages

    const result = await compactConversation(
      messagesForCompact,
      context,
      await getCacheSharingParams(context, messagesForCompact),
      false,
      customInstructions,
      false,
      undefined,
      preCompactHookResult,
    )

    suppressCompactWarning()

    runPostCompactCleanup()

    return {
      type: 'compact',
      compactionResult: result,
      displayText: buildDisplayText(
        context,
        displayMode,
        result.userDisplayMessage,
      ),
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(formatCompactError('aborted'))
    } else if (hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)) {
      throw new Error(formatCompactError('not_enough_messages'))
    } else if (hasExactErrorMessage(error, ERROR_MESSAGE_INCOMPLETE_RESPONSE)) {
      throw new Error(formatCompactError('incomplete'))
    } else {
      logError(error)
      throw new Error(formatCompactError('failed', error))
    }
  } finally {
    endCompactLifecycle(context)
  }
}

export function formatCompactError(
  reason: 'aborted' | 'not_enough_messages' | 'incomplete' | 'failed',
  cause?: unknown,
): string {
  switch (reason) {
    case 'aborted':
      return 'Compaction canceled.'
    case 'not_enough_messages':
      return 'Nothing to compact yet.'
    case 'incomplete':
      return 'Compaction did not complete cleanly. Try again.'
    case 'failed':
      return `Compaction failed: ${String(cause)}`
  }
}

export function buildDisplayText(
  context: ToolUseContext,
  mode: 'default' | 'custom',
  userDisplayMessage?: string,
): string {
  const upgradeMessage = getUpgradeMessage('tip')
  const expandShortcut = getShortcutDisplay(
    'app:toggleTranscript',
    'Global',
    'ctrl+o',
  )
  const headline =
    mode === 'custom'
      ? 'Conversation compacted with custom instructions.'
      : 'Conversation compacted.'
  const details = [
    'Continue in this session.',
    `${expandShortcut} to review compacted history.`,
    ...(userDisplayMessage ? [userDisplayMessage] : []),
    ...(upgradeMessage ? [upgradeMessage] : []),
  ]
  if (context.options.verbose) {
    return [headline, ...details].join('\n')
  }
  return [headline, ...details.map(line => chalk.dim(line))].join('\n')
}

async function getCacheSharingParams(
  context: ToolUseContext,
  forkContextMessages: Message[],
): Promise<{
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  forkContextMessages: Message[]
}> {
  const appState = context.getAppState()
  const defaultSysPrompt = await getSystemPrompt(
    context.options.tools,
    context.options.mainLoopModel,
    Array.from(
      appState.toolPermissionContext.additionalWorkingDirectories.keys(),
    ),
    context.options.mcpClients,
  )
  const systemPrompt = buildEffectiveSystemPrompt({
    mainThreadAgentDefinition: undefined,
    toolUseContext: context,
    customSystemPrompt: context.options.customSystemPrompt,
    defaultSystemPrompt: defaultSysPrompt,
    appendSystemPrompt: context.options.appendSystemPrompt,
  })
  const [userContext, systemContext] = await Promise.all([
    getUserContext(),
    getSystemContext(),
  ])
  return {
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext: context,
    forkContextMessages,
  }
}
