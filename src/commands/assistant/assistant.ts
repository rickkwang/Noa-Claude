// @ts-nocheck
import { feature } from 'bun:bundle'
import {
  E_ASSISTANT_INVALID_ARGUMENT,
  E_ASSISTANT_SETTINGS_WRITE_FAILED,
} from '../../constants/errorIds.js'
import type { LocalCommandCall } from '../../types/command.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

const VALID_ARGS = new Set([
  '',
  'status',
  'enable',
  'on',
  'disable',
  'off',
  'help',
  '-h',
  '--help',
])

function buildStatusMessage(): string {
  const userSettings = getSettingsForSource('userSettings')
  const assistantEnabled = userSettings?.assistant === true
  const runtimeAvailable = feature('KAIROS') ? true : false
  return `Assistant status: ${assistantEnabled ? 'enabled' : 'disabled'} in user settings. Runtime: ${runtimeAvailable ? 'available' : 'unavailable in this build'}.`
}

function writeAssistantPreference(enabled: boolean) {
  const { error } = updateSettingsForSource('userSettings', {
    assistant: enabled ? true : undefined,
  })
  if (error) {
    return {
      type: 'text' as const,
      value: `[E_ASSISTANT_SETTINGS_WRITE_FAILED:${E_ASSISTANT_SETTINGS_WRITE_FAILED}] Failed to update assistant setting: ${error.message}`,
    }
  }
  const runtimeAvailable = feature('KAIROS') ? true : false
  const action = enabled ? 'enabled' : 'disabled'
  const runtimeSuffix = runtimeAvailable
    ? 'Runtime is available.'
    : 'Runtime is unavailable in this build; setting was saved for compatibility only.'
  return {
    type: 'text' as const,
    value: `Assistant ${action}. ${runtimeSuffix}`,
  }
}

export const call: LocalCommandCall = async args => {
  const normalized = (args || '').trim().toLowerCase()
  if (!VALID_ARGS.has(normalized)) {
    return {
      type: 'text',
      value: `[E_ASSISTANT_INVALID_ARGUMENT:${E_ASSISTANT_INVALID_ARGUMENT}] Invalid argument "${args}". Use /assistant [status|enable|disable].`,
    }
  }

  if (normalized === 'help' || normalized === '-h' || normalized === '--help') {
    return {
      type: 'text',
      value:
        'Usage: /assistant [status|enable|disable]\n- status: show assistant setting and runtime availability\n- enable: persist assistant=true in user settings\n- disable: clear assistant from user settings',
    }
  }

  if (!normalized || normalized === 'status') {
    return { type: 'text', value: buildStatusMessage() }
  }

  if (normalized === 'enable' || normalized === 'on') {
    return writeAssistantPreference(true)
  }

  return writeAssistantPreference(false)
}
