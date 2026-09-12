import type { LocalJSXCommandOnDone } from '../../types/command.js'

/**
 * Top-level view state of the /plugin dialog, owned by PluginSettings.
 *
 * Child views (ManagePlugins, DiscoverPlugins, …) keep their own local view
 * state and import this one as `ParentViewState` to navigate out of
 * themselves — hence every `setParentViewState({ type: 'menu' })`, which
 * closes the dialog because PluginSettings treats 'menu' as "done".
 */
export type ViewState =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'validate'; path?: string }
  | { type: 'discover-plugins'; targetPlugin?: string }
  | {
      type: 'browse-marketplace'
      targetMarketplace?: string
      targetPlugin?: string
    }
  | {
      type: 'manage-plugins'
      targetPlugin?: string
      targetMarketplace?: string
      action?: 'uninstall' | 'enable' | 'disable'
    }
  | {
      type: 'manage-marketplaces'
      targetMarketplace?: string
      action?: 'remove' | 'update'
    }
  | { type: 'marketplace-menu' }
  | { type: 'marketplace-list' }
  | { type: 'add-marketplace'; initialValue?: string }

export type PluginSettingsProps = {
  onComplete: LocalJSXCommandOnDone
  args?: string
  /** Set by the /mcp redirect; the banner it once drove now renders nothing. */
  showMcpRedirectMessage?: boolean
  /**
   * True when the dialog was opened mid-turn (the immediate-command path).
   * Only affects wording: an auto-queued /reload-plugins runs after the
   * current response instead of right away, so the user is told so.
   */
  midTurn?: boolean
}
