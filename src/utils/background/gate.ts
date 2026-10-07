/**
 * Whether this session can move to the background at all. Checked before
 * anything is stopped: ← and /background must refuse up front rather than
 * cut a running turn short and then fail.
 */
import {
  getIsRemoteMode,
  isSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import { getGlobalConfig } from '../config.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  getCommandQueue,
  isQueuedCommandVisible,
} from '../messageQueueManager.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'

export function isAgentViewDisabled(): boolean {
  return (
    isEnvTruthy(process.env.NOA_CLAUDE_DISABLE_AGENT_VIEW) ||
    isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW) ||
    getSettings_DEPRECATED().disableAgentView === true
  )
}

export type BackgroundBlock = 'disabled' | 'remote' | 'persistence'

export function getBackgroundBlock(): BackgroundBlock | null {
  if (isAgentViewDisabled()) return 'disabled'
  if (getIsRemoteMode()) return 'remote'
  if (isSessionPersistenceDisabled()) return 'persistence'
  return null
}

export const PERSISTENCE_BLOCKED_MESSAGE =
  'Cannot open agents — session persistence is disabled, so this conversation cannot be backgrounded.'

/**
 * Queued messages live in this process only: moving the session away drops
 * them. Any queued item shown under the prompt counts, not just the editable
 * ones, so ← and /background refuse rather than lose it.
 */
export function getQueuedMessagesBlock(): [reason: string, hint: string] | null {
  const queued = getCommandQueue().filter(isQueuedCommandVisible).length
  if (queued === 0) return null
  return [
    `${queued} queued ${queued === 1 ? 'message' : 'messages'} would be lost`,
    `Run or clear ${queued === 1 ? 'it' : 'them'} first.`,
  ]
}

/** `leftArrowOpensAgents: false` in the global config turns ← back into plain cursor movement. */
export function leftArrowOpensAgents(): boolean {
  return getGlobalConfig().leftArrowOpensAgents !== false
}
