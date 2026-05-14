// @ts-nocheck
import { feature } from 'bun:bundle'
import { resetCostState } from '../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../commands.js'
import { refreshGrowthBookAfterAuthChange } from '../services/analytics/growthbook.js'
import { refreshPolicyLimits } from '../services/policyLimits/index.js'
import { refreshRemoteManagedSettings } from '../services/remoteManagedSettings/index.js'
import { stripSignatureBlocks } from './messages.js'
import {
  checkAndDisableAutoModeIfNeeded,
  checkAndDisableBypassPermissionsIfNeeded,
  resetAutoModeGateCheck,
  resetBypassPermissionsCheck,
} from './permissions/bypassPermissionsKillswitch.js'
import { resetUserCache } from './user.js'

/**
 * Shared post-provider-switch logic.
 * Run this after activating any provider (OAuth login or provider profile switch)
 * to refresh caches, reset killswitches, and update app state.
 */
export function onProviderSwitch(context: LocalJSXCommandContext): void {
  // Notify the system that API credentials have changed
  context.onChangeAPIKey()

  // Clear any lingering session model override so the newly selected
  // provider/profile default model becomes authoritative.
  context.setAppState(prev => ({
    ...prev,
    mainLoopModel: null,
    mainLoopModelForSession: null,
  }))

  // Signature-bearing blocks (thinking, connector_text) are bound to the API key —
  // strip them so the new key doesn't reject stale signatures.
  context.setMessages(stripSignatureBlocks)

  // Reset cost state when switching accounts/providers
  resetCostState()

  // Refresh remotely managed settings after provider switch (non-blocking)
  void refreshRemoteManagedSettings()

  // Refresh policy limits after provider switch (non-blocking)
  void refreshPolicyLimits()

  // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
  resetUserCache()

  // Refresh GrowthBook after auth change to get updated feature flags
  refreshGrowthBookAfterAuthChange()

  // Reset killswitch gate checks and re-run with new credentials
  resetBypassPermissionsCheck()
  const appState = context.getAppState()
  void checkAndDisableBypassPermissionsIfNeeded(
    appState.toolPermissionContext,
    context.setAppState,
  )

  if (feature('TRANSCRIPT_CLASSIFIER')) {
    resetAutoModeGateCheck()
    void checkAndDisableAutoModeIfNeeded(
      appState.toolPermissionContext,
      context.setAppState,
      appState.fastMode,
    )
  }

  // Increment authVersion to trigger re-fetching of auth-dependent data in hooks (e.g., MCP servers)
  context.setAppState(prev => ({
    ...prev,
    authVersion: prev.authVersion + 1,
  }))
}
