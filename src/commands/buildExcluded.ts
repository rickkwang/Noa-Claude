import { E_BUILD_EXCLUDED_COMMAND } from '../constants/errorIds.js'
import type { Command, LocalJSXCommandOnDone } from '../types/command.js'

export const BUILD_EXCLUDED_ERROR_CONTRACTS = {
  proactive: {
    errorId: 'E_BUILD_EXCLUDED_PROACTIVE',
    message: 'Proactive mode is not available in this build',
  },
  peers: {
    errorId: 'E_BUILD_EXCLUDED_PEERS',
    message: 'Peers feature is not available in this build',
  },
  'agents-platform': {
    errorId: 'E_BUILD_EXCLUDED_AGENTS_PLATFORM',
    message: 'Agents platform is not available in this build',
  },
  'remote-control': {
    errorId: 'E_BUILD_EXCLUDED_REMOTE_CONTROL',
    message: 'Remote control server is not available in this build',
  },
  torch: {
    errorId: 'E_BUILD_EXCLUDED_TORCH',
    message: 'Torch feature is not available in this build',
  },
  'force-snip': {
    errorId: 'E_BUILD_EXCLUDED_FORCE_SNIP',
    message: 'Force-snip feature is not available in this build',
  },
  'subscribe-pr': {
    errorId: 'E_BUILD_EXCLUDED_SUBSCRIBE_PR',
    message: 'Subscribe-PR feature is not available in this build',
  },
} as const

export function createBuildExcludedError(commandName: string): Error {
  const contract =
    BUILD_EXCLUDED_ERROR_CONTRACTS[
      commandName as keyof typeof BUILD_EXCLUDED_ERROR_CONTRACTS
    ]
  if (!contract) {
    const fallback = new Error('Feature is not available in this build')
    ;(fallback as Error & { errorId?: string; errorCode?: number }).errorId =
      'E_BUILD_EXCLUDED_UNKNOWN'
    ;(fallback as Error & { errorId?: string; errorCode?: number }).errorCode =
      E_BUILD_EXCLUDED_COMMAND
    return fallback
  }
  const error = new Error(contract.message)
  ;(error as Error & { errorId?: string; errorCode?: number }).errorId =
    contract.errorId
  ;(error as Error & { errorId?: string; errorCode?: number }).errorCode =
    E_BUILD_EXCLUDED_COMMAND
  return error
}

export function formatBuildExcludedMessage(commandName: string): string {
  const error = createBuildExcludedError(commandName)
  const errorId =
    (error as Error & { errorId?: string; errorCode?: number }).errorId ??
    'E_BUILD_EXCLUDED_UNKNOWN'
  const errorCode =
    (error as Error & { errorId?: string; errorCode?: number }).errorCode ??
    E_BUILD_EXCLUDED_COMMAND
  return `[${errorId}:${errorCode}] ${error.message}`
}

/**
 * Factory for the identical "command not available in this build" contract.
 */
export function createBuildExcludedCommand(
  name: keyof typeof BUILD_EXCLUDED_ERROR_CONTRACTS,
  description: string,
): Command {
  return {
    name,
    description,
    type: 'local-jsx' as const,
    isHidden: true,
    load: async () => ({
      call: async (onDone: LocalJSXCommandOnDone) => {
        onDone(formatBuildExcludedMessage(name), { display: 'system' })
        return null
      },
    }),
  } satisfies Command
}
