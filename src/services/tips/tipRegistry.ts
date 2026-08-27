// @ts-nocheck
import chalk from 'chalk'
import { logForDebugging } from 'src/utils/debug.js'
import { fileHistoryEnabled } from 'src/utils/fileHistory.js'
import { getRemoteManagedSettingsSyncFromCache } from 'src/services/remoteManagedSettings/syncCacheState.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
  getSettingsForSource,
} from 'src/utils/settings/settings.js'
import { shouldOfferTerminalSetup } from '../../commands/terminalSetup/terminalSetup.js'
import { color } from '../../components/design-system/color.js'
import { shouldShowOverageCreditUpsell } from '../../components/LogoV2/OverageCreditUpsell.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import { isKairosCronEnabled } from '../../tools/ScheduleCronTool/prompt.js'
import { is1PApiCustomer } from '../../utils/auth.js'
import { countConcurrentSessions } from '../../utils/concurrentSessions.js'
import { getGlobalConfig } from '../../utils/config.js'
import {
  getEffortEnvOverride,
  modelSupportsEffort,
} from '../../utils/effort.js'
import { env } from '../../utils/env.js'
import { cacheKeys } from '../../utils/fileStateCache.js'
import { getWorktreeCount } from '../../utils/git.js'
import {
  detectRunningIDEsCached,
  getSortedIdeLockfiles,
  isCursorInstalled,
  isSupportedTerminal,
  isSupportedVSCodeTerminal,
  isVSCodeInstalled,
  isWindsurfInstalled,
} from '../../utils/ide.js'
import {
  getMainLoopModel,
  getUserSpecifiedModelSetting,
} from '../../utils/model/model.js'
import { getPlatform } from '../../utils/platform.js'
import { getPreferredCliCommandName } from '../../utils/commandName.js'
import { isPluginInstalled } from '../../utils/plugins/installedPluginsManager.js'
import { loadKnownMarketplacesConfigSafe } from '../../utils/plugins/marketplaceManager.js'
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js'
import {
  getCurrentSessionAgentColor,
  isCustomTitleEnabled,
} from '../../utils/sessionStorage.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  formatGrantAmount,
  getCachedOverageCreditGrant,
} from '../api/overageCreditGrant.js'
import { getSessionsSinceLastShown } from './tipHistory.js'
import { loadTipsFile } from './tipsFileLoader.js'
import type { Tip, TipContext } from './types.js'

let _isOfficialMarketplaceInstalledCache: boolean | undefined
async function isOfficialMarketplaceInstalled(): Promise<boolean> {
  if (_isOfficialMarketplaceInstalledCache !== undefined) {
    return _isOfficialMarketplaceInstalledCache
  }
  const config = await loadKnownMarketplacesConfigSafe()
  _isOfficialMarketplaceInstalledCache = OFFICIAL_MARKETPLACE_NAME in config
  return _isOfficialMarketplaceInstalledCache
}

async function isMarketplacePluginRelevant(
  pluginName: string,
  context: TipContext | undefined,
  signals: { filePath?: RegExp; cli?: string[] },
): Promise<boolean> {
  if (!(await isOfficialMarketplaceInstalled())) {
    return false
  }
  if (isPluginInstalled(`${pluginName}@${OFFICIAL_MARKETPLACE_NAME}`)) {
    return false
  }
  const { bashTools } = context ?? {}
  if (signals.cli && bashTools?.size) {
    if (signals.cli.some(cmd => bashTools.has(cmd))) {
      return true
    }
  }
  if (signals.filePath && context?.readFileState) {
    const readFiles = cacheKeys(context.readFileState)
    if (readFiles.some(fp => signals.filePath!.test(fp))) {
      return true
    }
  }
  return false
}

const externalTips: Tip[] = [
  {
    id: 'new-user-warmup',
    content: async () =>
      `Start with small features or bug fixes, tell Noa Claude to propose a plan, and verify its suggested edits`,
    cooldownSessions: 3,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups < 10
    },
  },
  {
    id: 'plan-mode-for-complex-tasks',
    content: async () =>
      `Use Plan Mode to prepare for a complex request before making changes. Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} twice to enable.`,
    cooldownSessions: 5,
    isRelevant: async () => {
      if (process.env.USER_TYPE === 'ant') return false
      const config = getGlobalConfig()
      // Show to users who haven't used plan mode recently (7+ days)
      const daysSinceLastUse = config.lastPlanModeUse
        ? (Date.now() - config.lastPlanModeUse) / (1000 * 60 * 60 * 24)
        : Infinity
      return daysSinceLastUse > 7
    },
  },
  {
    id: 'default-permission-mode-config',
    content: async () =>
      `Use /config to change your default permission mode (including Plan Mode)`,
    cooldownSessions: 10,
    isRelevant: async () => {
      try {
        const config = getGlobalConfig()
        const settings = getSettings_DEPRECATED()
        // Show if they've used plan mode but haven't set a default
        const hasUsedPlanMode = Boolean(config.lastPlanModeUse)
        const hasDefaultMode = Boolean(settings?.permissions?.defaultMode)
        return hasUsedPlanMode && !hasDefaultMode
      } catch (error) {
        logForDebugging(
          `Failed to check default-permission-mode-config tip relevance: ${error}`,
          { level: 'warn' },
        )
        return false
      }
    },
  },
  {
    id: 'git-worktrees',
    content: async () =>
      'Use git worktrees to run multiple Noa Claude sessions in parallel.',
    cooldownSessions: 10,
    isRelevant: async () => {
      try {
        const config = getGlobalConfig()
        const worktreeCount = await getWorktreeCount()
        return worktreeCount <= 1 && config.numStartups > 50
      } catch (_) {
        return false
      }
    },
  },
  {
    id: 'color-when-multi-clauding',
    content: async () =>
      'Running multiple Noa Claude sessions? Use /color and /rename to tell them apart at a glance.',
    cooldownSessions: 10,
    isRelevant: async () => {
      if (getCurrentSessionAgentColor()) return false
      const count = await countConcurrentSessions()
      return count >= 2
    },
  },
  {
    id: 'terminal-setup',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Run /terminal-setup to enable convenient terminal integration like Option + Enter for new line and more'
        : 'Run /terminal-setup to enable convenient terminal integration like Shift + Enter for new line and more',
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      if (env.terminal === 'Apple_Terminal') {
        return !config.optionAsMetaKeyInstalled
      }
      return !config.shiftEnterKeyBindingInstalled
    },
  },
  {
    id: 'shift-enter',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Press Option+Enter to send a multi-line message'
        : 'Press Shift+Enter to send a multi-line message',
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      return Boolean(
        (env.terminal === 'Apple_Terminal'
          ? config.optionAsMetaKeyInstalled
          : config.shiftEnterKeyBindingInstalled) && config.numStartups > 3,
      )
    },
  },
  {
    id: 'shift-enter-setup',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Run /terminal-setup to enable Option+Enter for new lines'
        : 'Run /terminal-setup to enable Shift+Enter for new lines',
    cooldownSessions: 10,
    async isRelevant() {
      if (!shouldOfferTerminalSetup()) {
        return false
      }
      const config = getGlobalConfig()
      return !(env.terminal === 'Apple_Terminal'
        ? config.optionAsMetaKeyInstalled
        : config.shiftEnterKeyBindingInstalled)
    },
  },
  {
    id: 'memory-command',
    content: async () => 'Use /memory to view and manage Noa Claude memory',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.memoryUsageCount <= 0
    },
  },
  {
    id: 'theme-command',
    content: async () => 'Use /theme to change the color theme',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'colorterm-truecolor',
    content: async () =>
      'Try setting environment variable COLORTERM=truecolor for richer colors',
    cooldownSessions: 30,
    isRelevant: async () => !process.env.COLORTERM && chalk.level < 3,
  },
  {
    id: 'powershell-tool-env',
    content: async () =>
      'Set CLAUDE_CODE_USE_POWERSHELL_TOOL=1 to enable the PowerShell tool (preview)',
    cooldownSessions: 10,
    isRelevant: async () =>
      getPlatform() === 'windows' &&
      process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL === undefined,
  },
  {
    id: 'status-line',
    content: async () =>
      'Use /statusline to set up a custom status line that will display beneath the input box',
    cooldownSessions: 25,
    isRelevant: async () => getSettings_DEPRECATED().statusLine === undefined,
  },
  {
    id: 'prompt-queue',
    content: async () =>
      'Hit Enter to queue up additional messages while Noa Claude is working.',
    cooldownSessions: 5,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.promptQueueUseCount <= 3
    },
  },
  {
    id: 'enter-to-steer-in-relatime',
    content: async () =>
      'Send messages to Noa Claude while it works to steer Noa Claude in real-time',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'todo-list',
    content: async () =>
      'Ask Noa Claude to create a todo list when working on complex tasks to track progress and remain on track',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'vscode-command-install',
    content: async () =>
      `Open the Command Palette (Cmd+Shift+P) and run "Shell Command: Install '${env.terminal === 'vscode' ? 'code' : env.terminal}' command in PATH" to enable IDE integration`,
    cooldownSessions: 0,
    async isRelevant() {
      // Only show this tip if we're in a VS Code-style terminal
      if (!isSupportedVSCodeTerminal()) {
        return false
      }
      if (getPlatform() !== 'macos') {
        return false
      }

      // Check if the relevant command is available
      switch (env.terminal) {
        case 'vscode':
          return !(await isVSCodeInstalled())
        case 'cursor':
          return !(await isCursorInstalled())
        case 'windsurf':
          return !(await isWindsurfInstalled())
        default:
          return false
      }
    },
  },
  {
    id: 'ide-upsell-external-terminal',
    content: async () => 'Connect Noa Claude to your IDE · /ide',
    cooldownSessions: 4,
    async isRelevant() {
      if (isSupportedTerminal()) {
        return false
      }

      // Use lockfiles as a (quicker) signal for running IDEs
      const lockfiles = await getSortedIdeLockfiles()
      if (lockfiles.length !== 0) {
        return false
      }

      const runningIDEs = await detectRunningIDEsCached()
      return runningIDEs.length > 0
    },
  },
  {
    id: 'install-github-app',
    content: async () =>
      'Run /install-github-app to tag @claude right from your Github issues and PRs',
    cooldownSessions: 10,
    isRelevant: async () => !getGlobalConfig().githubActionSetupCount,
  },
  {
    id: 'permissions',
    content: async () =>
      'Use /permissions to pre-approve and pre-deny bash, edit, and MCP tools',
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 10
    },
  },
  {
    id: 'drag-and-drop-images',
    content: async () =>
      'Did you know you can drag and drop image files into your terminal?',
    cooldownSessions: 10,
    isRelevant: async () => !env.isSSH(),
  },
  {
    id: 'paste-images-mac',
    content: async () =>
      'Paste images into Noa Claude using control+v (not cmd+v!)',
    cooldownSessions: 10,
    isRelevant: async () => getPlatform() === 'macos',
  },
  {
    id: 'double-esc',
    content: async () =>
      'Double-tap esc to rewind the conversation to a previous point in time',
    cooldownSessions: 10,
    isRelevant: async () => !fileHistoryEnabled(),
  },
  {
    id: 'double-esc-code-restore',
    content: async () =>
      'Double-tap esc to rewind the code and/or conversation to a previous point in time',
    cooldownSessions: 10,
    isRelevant: async () => fileHistoryEnabled(),
  },
  {
    id: 'continue',
    content: async () =>
      `Run ${getPreferredCliCommandName()} --continue or ${getPreferredCliCommandName()} --resume to resume a conversation`,
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'rename-conversation',
    content: async () =>
      'Name your conversations with /rename to find them easily in /resume later',
    cooldownSessions: 15,
    isRelevant: async () =>
      isCustomTitleEnabled() && getGlobalConfig().numStartups > 10,
  },
  {
    id: 'custom-commands',
    content: async () =>
      'Create skills by adding .md files to .noa/skills/ in your project or ~/.noa/skills/ for skills that work in any project',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 10
    },
  },
  {
    id: 'shift-tab',
    content: async () =>
      process.env.USER_TYPE === 'ant'
        ? `Hit ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} to cycle between manual mode and auto mode`
        : `Hit ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} to cycle between manual mode, auto-accept edit mode, and plan mode`,
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'image-paste',
    content: async () =>
      `Use ${getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v')} to paste images from your clipboard`,
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'custom-agents',
    content: async () =>
      'Use /agents to optimize specific tasks. Eg. Software Architect, Code Writer, Code Reviewer',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
  {
    id: 'agent-flag',
    content: async () =>
      'Use --agent <agent_name> to directly start a conversation with a subagent',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
  {
    id: 'web-app',
    content: async () =>
      'Run tasks in the cloud while you keep coding locally · clau.de/web',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
  {
    id: 'opusplan-mode-reminder',
    content: async () =>
      `Your default model setting is Opus Plan Mode. Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} twice to activate Plan Mode and plan with Noa Claude Opus.`,
    cooldownSessions: 2,
    async isRelevant() {
      if (process.env.USER_TYPE === 'ant') return false
      const config = getGlobalConfig()
      const modelSetting = getUserSpecifiedModelSetting()
      const hasOpusPlanMode = modelSetting === 'opusplan'
      // Show reminder if they have Opus Plan Mode and haven't used plan mode recently (3+ days)
      const daysSinceLastUse = config.lastPlanModeUse
        ? (Date.now() - config.lastPlanModeUse) / (1000 * 60 * 60 * 24)
        : Infinity
      return hasOpusPlanMode && daysSinceLastUse > 3
    },
  },
  {
    id: 'frontend-design-plugin',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return `Working with HTML/CSS? Install the frontend-design plugin:\n${blue(`/plugin install frontend-design@${OFFICIAL_MARKETPLACE_NAME}`)}`
    },
    cooldownSessions: 3,
    isRelevant: async context =>
      isMarketplacePluginRelevant('frontend-design', context, {
        filePath: /\.(html|css|htm)$/i,
      }),
  },
  {
    id: 'vercel-plugin',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return `Working with Vercel? Install the vercel plugin:\n${blue(`/plugin install vercel@${OFFICIAL_MARKETPLACE_NAME}`)}`
    },
    cooldownSessions: 3,
    isRelevant: async context =>
      isMarketplacePluginRelevant('vercel', context, {
        filePath: /(?:^|[/\\])vercel\.json$/i,
        cli: ['vercel'],
      }),
  },
  {
    id: 'effort-high-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const cmd = blue('/effort high')
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('tengu_tide_elm', 'off')
      return variant === 'copy_b'
        ? `Use ${cmd} for better one-shot answers. Noa Claude thinks it through first.`
        : `Working on something tricky? ${cmd} gives better first answers`
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      if (!modelSupportsEffort(getMainLoopModel())) return false
      if (getSettingsForSource('policySettings')?.effortLevel !== undefined) {
        return false
      }
      if (getEffortEnvOverride() !== undefined) return false
      const persisted = getInitialSettings().effortLevel
      if (persisted === 'high' || persisted === 'max') return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'tengu_tide_elm',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'subagent-fanout-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('tengu_tern_alloy', 'off')
      return variant === 'copy_b'
        ? `For big tasks, tell Noa Claude to ${blue('use subagents')}. They work in parallel and keep your main thread clean.`
        : `Say ${blue('"fan out subagents"')} and Noa Claude sends a team. Each one digs deep so nothing gets missed.`
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'tengu_tern_alloy',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'loop-command-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('tengu_timber_lark', 'off')
      return variant === 'copy_b'
        ? `Use ${blue('/loop 5m check the deploy')} to run any prompt on a schedule. Set it and forget it.`
        : `${blue('/loop')} runs any prompt on a recurring schedule. Great for monitoring deploys, babysitting PRs, or polling status.`
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      if (!isKairosCronEnabled()) return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'tengu_timber_lark',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'overage-credit',
    content: async ctx => {
      const claude = color('claude', ctx.theme)
      const info = getCachedOverageCreditGrant()
      const amount = info ? formatGrantAmount(info) : null
      if (!amount) return ''
      // Copy from "OC & Bulk Overages copy" doc (#5 — CLI Rotating tip)
      return `${claude(`${amount} in usage credits, on us`)} · third-party apps · ${claude('/usage-credits')}`
    },
    cooldownSessions: 3,
    isRelevant: async () => shouldShowOverageCreditUpsell(),
  },
  {
    id: 'feedback-command',
    content: async () => 'Use /feedback to help us improve!',
    cooldownSessions: 15,
    async isRelevant() {
      if (process.env.USER_TYPE === 'ant') {
        return false
      }
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
]
const internalOnlyTips: Tip[] = [
  {
    id: 'important-claudemd',
    content: async () =>
      'Use "IMPORTANT:" prefix for must-follow project instruction rules',
    cooldownSessions: 30,
    isRelevant: async () => true,
  },
  {
    id: 'skillify',
    content: async () =>
      'Use /skillify at the end of a workflow to turn it into a reusable skill',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
]

// Settings sources, in merge precedence order (mirrors SETTING_SOURCES in
// utils/settings/constants.ts). Project-level sources are checked into (or
// live alongside) a shared repo, so — matching upstream Claude Code's
// spinnerTipsOverride behavior — they're trusted with plain-string tips only.
// Object tip entries (id/cooldownSessions/priority) and the tipsFile/label
// fields require a source only the local user or an admin controls.
const PROJECT_TIP_SOURCES = ['projectSettings', 'localSettings']
const CUSTOM_TIP_SOURCE_ORDER = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
]
const TIP_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const TIP_TEXT_MAX_LENGTH = 500
// A label is prepended to the tip on the same spinner line, so it's the same
// injection surface as the tip text and gets the same treatment. Kept short:
// it's a prefix like "Acme: ", not a second tip.
const TIP_LABEL_MAX_LENGTH = 64

// A custom tip's text is rendered straight into the terminal next to the
// spinner, so it gets the same Unicode net upstream Claude Code applies:
// fold line breaks/runs of spaces down to a single line first, then strip
// control chars, format chars (bidi overrides, zero-width joiners...),
// variation selectors, and the supplementary-plane "tag" chars — the classes
// an attacker would reach for to hide text or fake cursor movement in a tip
// that ships via a shared settings file.
const TIP_TEXT_LINE_BREAKS = /[\t\n\r\u2028\u2029]+/g
const TIP_TEXT_EXTRA_SPACES = / {2,}/g
const TIP_TEXT_INVISIBLE_CHARS =
  /[\p{Cc}\p{Cf}\u2028\u2029\u180e\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu

function sanitizeTipText(raw: string): string {
  return raw
    .replace(TIP_TEXT_LINE_BREAKS, ' ')
    .replace(TIP_TEXT_INVISIBLE_CHARS, '')
    .replace(TIP_TEXT_EXTRA_SPACES, ' ')
    .trim()
}

// Same Unicode net as the tip text — a label sharing the spinner line can
// carry an erase-line escape or a newline just as easily. Two differences from
// sanitizeTipText: one trailing space survives, because "Acme: " is how you
// write a prefix and a full trim would render "Acme:tip"; and an over-long
// label is truncated rather than dropped, so the tips it prefixes still show.
function sanitizeTipLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const folded = raw
    .replace(TIP_TEXT_LINE_BREAKS, ' ')
    .replace(TIP_TEXT_INVISIBLE_CHARS, '')
    .replace(TIP_TEXT_EXTRA_SPACES, ' ')
  const body = folded.trim()
  if (!body) return undefined
  const capped =
    body.length > TIP_LABEL_MAX_LENGTH
      ? body.slice(0, TIP_LABEL_MAX_LENGTH)
      : body
  return /\s$/.test(folded) ? `${capped} ` : capped
}

function isTrustedTipSource(source: string): boolean {
  return !PROJECT_TIP_SOURCES.includes(source)
}

// Guards the cooldown/priority comparisons against a NaN or non-numeric value
// from a hand-edited settings file: `sessions >= NaN` is false for every
// session count, which would silently retire a tip forever.
function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// policySettings is a first-wins merge of remote-managed / MDM / managed-
// settings.json / HKCU (see getSettingsForSourceUncached in settings.ts) —
// when remote-managed settings are present at all, they *are* the whole
// policySettings result. This mirrors that same check to tell "policy
// settings came from the remote/server channel" apart from "came from a
// local managed-settings.json (or MDM/HKCU)".
function isPolicySettingsFromRemoteManaged(): boolean {
  const remoteSettings = getRemoteManagedSettingsSyncFromCache()
  return Boolean(remoteSettings && Object.keys(remoteSettings).length > 0)
}

type TipNamespace = 'inline' | 'file'

type NormalizedCustomTip = {
  id: string
  namespace: TipNamespace
  text: string
  label: string | undefined
  cooldownSessions: number
  priority: number
}

// tipsFile entries only ever come from a trusted source (see
// getEffectiveSpinnerTipsOverride) and support the same string-or-object
// shapes as inline tips, so this reuses the inline validation path — just
// tagged with namespace: 'file' so its ids land in a separate cooldown-
// history bucket (org-tip:file:<id>) from inline tips (org-tip:<id>) even
// when an id happens to collide.
function normalizeCustomTipEntries(
  entries: unknown[] | undefined,
  source: string,
  seenIds: Set<string>,
  namespace: TipNamespace = 'inline',
  label: string | undefined = undefined,
): NormalizedCustomTip[] {
  // Array.isArray, not a truthiness/length check: policySettings can reach us
  // unvalidated (getRemoteManagedSettingsSyncFromCache casts the parsed JSON
  // straight to SettingsJson), so `tips` may be a string — which has .length
  // but no .forEach — or any other shape the zod schema never saw.
  if (!Array.isArray(entries) || entries.length === 0) return []
  const trusted = isTrustedTipSource(source)
  const normalized: NormalizedCustomTip[] = []

  entries.forEach((entry, index) => {
    if (typeof entry === 'string') {
      const text = sanitizeTipText(entry)
      if (!text) return
      // No explicit id on a plain-string tip: derive a stable one scoped to
      // this source + position so tips at the same index in different
      // sources don't share cooldown history.
      const id = `custom-tip-${source}-${namespace}-${index}`
      const dedupeKey = `${namespace}:${id}`
      if (seenIds.has(dedupeKey)) return
      seenIds.add(dedupeKey)
      normalized.push({
        id,
        namespace,
        text,
        label,
        cooldownSessions: 0,
        priority: 0,
      })
      return
    }

    if (!trusted) {
      logForDebugging(
        `spinnerTipsOverride: object tip entries in ${source} are ignored; only plain strings are read from project settings`,
        { level: 'warn' },
      )
      return
    }

    const id = entry?.id
    if (typeof id !== 'string' || !TIP_ID_PATTERN.test(id)) {
      logForDebugging(
        `spinnerTipsOverride: tip object needs an "id" of 1-64 letters, digits, ".", "_" or "-"; dropped`,
        { level: 'warn' },
      )
      return
    }
    if (typeof entry.text !== 'string' || !entry.text) {
      logForDebugging(
        `spinnerTipsOverride: tip object without a "text" string; dropped`,
        { level: 'warn' },
      )
      return
    }
    // Length is checked on the raw text (matching the schema's documented
    // limit) before sanitizing, so a long tip stuffed with invisible
    // characters is rejected for being too long rather than slipping through
    // as short-after-cleanup.
    if (entry.text.length > TIP_TEXT_MAX_LENGTH) {
      logForDebugging(
        `spinnerTipsOverride: tip "${id}" text is longer than ${TIP_TEXT_MAX_LENGTH} characters; dropped`,
        { level: 'warn' },
      )
      return
    }
    const text = sanitizeTipText(entry.text)
    if (!text) {
      logForDebugging(
        `spinnerTipsOverride: tip "${id}" is empty after sanitizing; dropped`,
        { level: 'warn' },
      )
      return
    }
    const dedupeKey = `${namespace}:${id}`
    if (seenIds.has(dedupeKey)) {
      logForDebugging(
        `spinnerTipsOverride: duplicate tip id "${id}"; keeping the first`,
        { level: 'warn' },
      )
      return
    }
    seenIds.add(dedupeKey)
    normalized.push({
      id,
      namespace,
      text,
      label,
      // A non-numeric cooldownSessions/priority reaches here only from a
      // hand-edited settings file (the schema keeps tip objects loose on
      // purpose), so coerce rather than trust the annotation.
      cooldownSessions: toFiniteNumber(entry.cooldownSessions, 0),
      priority: toFiniteNumber(entry.priority, 0),
    })
  })

  return normalized
}

type EffectiveSpinnerTipsOverride = {
  excludeDefault: boolean
  entries: NormalizedCustomTip[]
}

function getEffectiveSpinnerTipsOverride(): EffectiveSpinnerTipsOverride {
  try {
    return readSpinnerTipsOverride()
  } catch (error) {
    // The spinner tip is decoration; the caller (REPL's pickNewSpinnerTip)
    // fires this without a .catch(), so anything thrown here would surface as
    // an unhandled rejection once per turn. Degrade to "no custom tips".
    logForDebugging(
      `Failed to read spinnerTipsOverride; falling back to built-in tips: ${error}`,
      { level: 'warn' },
    )
    return { excludeDefault: false, entries: [] }
  }
}

function readSpinnerTipsOverride(): EffectiveSpinnerTipsOverride {
  const seenIds = new Set<string>()
  const entries: NormalizedCustomTip[] = []
  let excludeDefault = false

  for (const source of CUSTOM_TIP_SOURCE_ORDER) {
    const override = getSettingsForSource(source)?.spinnerTipsOverride
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      continue
    }

    const trusted = isTrustedTipSource(source)
    if (override.excludeDefault) excludeDefault = true

    // One warning per source, however many of the two fields it sets.
    if ((override.label || override.tipsFile) && !trusted) {
      logForDebugging(
        `spinnerTipsOverride.tipsFile/label in ${source} are ignored; set them in user or managed settings`,
        { level: 'warn' },
      )
    }

    // A label prefixes the tips declared alongside it, not every tip in the
    // rotation — otherwise the last source to set one would silently re-brand
    // tips that came from a different config.
    const label = trusted ? sanitizeTipLabel(override.label) : undefined

    entries.push(
      ...normalizeCustomTipEntries(
        override.tips,
        source,
        seenIds,
        'inline',
        label,
      ),
    )

    if (override.tipsFile && trusted) {
      if (source === 'policySettings' && isPolicySettingsFromRemoteManaged()) {
        logForDebugging(
          'spinnerTipsOverride.tipsFile from remote managed settings is ignored; ship inline tips or install the file path via managed-settings.json',
          { level: 'warn' },
        )
      } else {
        const fileEntries = loadTipsFile(override.tipsFile)
        if (fileEntries) {
          entries.push(
            ...normalizeCustomTipEntries(
              fileEntries,
              source,
              seenIds,
              'file',
              label,
            ),
          )
        }
      }
    }
  }

  return { excludeDefault, entries }
}

function buildCustomTips({ entries }: EffectiveSpinnerTipsOverride): Tip[] {
  return entries.map(entry => ({
    id: `org-tip:${entry.namespace === 'file' ? 'file:' : ''}${entry.id}`,
    content: async () =>
      entry.label ? `${entry.label}${entry.text}` : entry.text,
    cooldownSessions: entry.cooldownSessions,
    priority: entry.priority,
    isRelevant: async () => true,
  }))
}

function isOffCooldown(tip: Tip): boolean {
  return getSessionsSinceLastShown(tip.id) >= tip.cooldownSessions
}

export async function getRelevantTips(context?: TipContext): Promise<Tip[]> {
  const override = getEffectiveSpinnerTipsOverride()
  const configuredCustomTips = buildCustomTips(override)
  // Custom tips are cooldown-filtered on the same footing as built-ins —
  // a per-tip cooldownSessions is only meaningful if it's actually enforced.
  // (Entries that don't set one normalize to 0, i.e. always eligible, which
  // is how every custom tip behaved before cooldowns were configurable.)
  const customTips = configuredCustomTips.filter(isOffCooldown)

  // excludeDefault means "only ever show my tips", so it's gated on whether
  // any were *configured*, not on how many are eligible right now: with all
  // of them cooling down the answer is "no tip", not "fall back to built-ins".
  // Only a config with no custom tips at all falls through.
  if (override.excludeDefault && configuredCustomTips.length > 0) {
    return customTips
  }

  // Otherwise, filter built-in tips as before and combine with custom
  const tips = [...externalTips, ...internalOnlyTips]
  const isRelevant = await Promise.all(tips.map(_ => _.isRelevant(context)))
  const filtered = tips
    .filter((_, index) => isRelevant[index])
    .filter(isOffCooldown)

  return [...filtered, ...customTips]
}
