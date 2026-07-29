// @ts-nocheck
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isOverageProvisioningAllowed } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

function isExtraUsageAllowed(): boolean {
  if (isEnvTruthy(process.env.DISABLE_EXTRA_USAGE_COMMAND)) {
    return false
  }
  return isOverageProvisioningAllowed()
}

const DESCRIPTION =
  'Configure usage credits or request them from your admin when you hit a limit'

// Upstream renamed /extra-usage to /usage-credits and kept the old name as a
// hidden alias so existing muscle memory still resolves. Both load the same
// implementation; only the listing name and description differ.
export const RENAME_NOTICE = '/extra-usage is now /usage-credits'
const RENAMED_DESCRIPTION = 'Renamed to /usage-credits'

export const usageCredits = {
  type: 'local-jsx',
  name: 'usage-credits',
  description: DESCRIPTION,
  isEnabled: () => isExtraUsageAllowed() && !getIsNonInteractiveSession(),
  load: () => import('./usage-credits.js'),
} satisfies Command

export const usageCreditsNonInteractive = {
  type: 'local',
  name: 'usage-credits',
  supportsNonInteractive: true,
  description: DESCRIPTION,
  isEnabled: () => isExtraUsageAllowed() && getIsNonInteractiveSession(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./usage-credits-noninteractive.js'),
} satisfies Command

export const extraUsage = {
  type: 'local-jsx',
  name: 'extra-usage',
  description: RENAMED_DESCRIPTION,
  isHidden: true,
  isEnabled: () => isExtraUsageAllowed() && !getIsNonInteractiveSession(),
  load: () => import('./usage-credits.js'),
} satisfies Command

export const extraUsageNonInteractive = {
  type: 'local',
  name: 'extra-usage',
  supportsNonInteractive: true,
  description: RENAMED_DESCRIPTION,
  isHidden: true,
  isEnabled: () => isExtraUsageAllowed() && getIsNonInteractiveSession(),
  load: () => import('./usage-credits-noninteractive.js'),
} satisfies Command
