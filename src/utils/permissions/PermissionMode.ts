// @ts-nocheck
import { feature } from 'bun:bundle'
import z from 'zod/v4'
import { PAUSE_ICON } from '../../constants/figures.js'
// Types extracted to src/types/permissions.ts to break import cycles
import {
  EXTERNAL_PERMISSION_MODES,
  type ExternalPermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from '../../types/permissions.js'
import { lazySchema } from '../lazySchema.js'

// Re-export for backwards compatibility
export {
  EXTERNAL_PERMISSION_MODES,
  PERMISSION_MODES,
  type ExternalPermissionMode,
  type PermissionMode,
}

export const permissionModeSchema = lazySchema(() => z.enum(PERMISSION_MODES))
export const externalPermissionModeSchema = lazySchema(() =>
  z.enum(EXTERNAL_PERMISSION_MODES),
)

type ModeColorKey =
  | 'text'
  | 'inactive'
  | 'planMode'
  | 'permission'
  | 'autoAccept'
  | 'error'
  | 'warning'

type PermissionModeConfig = {
  title: string
  shortTitle: string
  /** Status-line phrase, e.g. "manual mode" — rendered as "<symbol> <indicator> on". */
  indicator: string
  symbol: string
  color: ModeColorKey
  external: ExternalPermissionMode
}

const PERMISSION_MODE_CONFIG: Partial<
  Record<PermissionMode, PermissionModeConfig>
> = {
  default: {
    title: 'Manual',
    shortTitle: 'Manual',
    indicator: 'manual mode',
    symbol: PAUSE_ICON,
    color: 'inactive',
    external: 'default',
  },
  plan: {
    title: 'Plan',
    shortTitle: 'Plan',
    indicator: 'plan mode',
    symbol: PAUSE_ICON,
    color: 'planMode',
    external: 'plan',
  },
  acceptEdits: {
    title: 'Accept edits',
    shortTitle: 'Accept',
    indicator: 'accept edits',
    symbol: '⏵⏵',
    color: 'autoAccept',
    external: 'acceptEdits',
  },
  bypassPermissions: {
    title: 'Bypass Permissions',
    shortTitle: 'Bypass',
    indicator: 'bypass permissions',
    symbol: '⏵⏵',
    color: 'error',
    external: 'bypassPermissions',
  },
  dontAsk: {
    title: "Don't Ask",
    shortTitle: 'DontAsk',
    indicator: "don't ask",
    symbol: '⏵⏵',
    color: 'error',
    external: 'dontAsk',
  },
  ...(feature('AUTO_MODE')
    ? {
        auto: {
          title: 'Auto',
          shortTitle: 'Auto',
          indicator: 'auto mode',
          symbol: '⏵⏵',
          color: 'warning' as ModeColorKey,
          // 'auto', not 'default': toExternalPermissionMode round-trips this
          // value, so mapping it to 'default' silently discarded the user's
          // Auto selection the moment they made it.
          external: 'auto' as ExternalPermissionMode,
        },
      }
    : {}),
}

/**
 * Type guard to check if a PermissionMode is an ExternalPermissionMode.
 * Only 'bubble' is internal-only, matching upstream.
 */
export function isExternalPermissionMode(
  mode: PermissionMode,
): mode is ExternalPermissionMode {
  return mode !== 'bubble'
}

function getModeConfig(mode: PermissionMode): PermissionModeConfig {
  return PERMISSION_MODE_CONFIG[mode] ?? PERMISSION_MODE_CONFIG.default!
}

export function toExternalPermissionMode(
  mode: PermissionMode,
): ExternalPermissionMode {
  return getModeConfig(mode).external
}

export function permissionModeFromString(str: string): PermissionMode {
  // 'manual' is accepted as an alias for 'default', matching upstream.
  if (str === 'manual') return 'default'
  return (PERMISSION_MODES as readonly string[]).includes(str)
    ? (str as PermissionMode)
    : 'default'
}

export function permissionModeTitle(mode: PermissionMode): string {
  return getModeConfig(mode).title
}

export function isDefaultMode(mode: PermissionMode | undefined): boolean {
  return mode === 'default' || mode === undefined
}

export function permissionModeShortTitle(mode: PermissionMode): string {
  return getModeConfig(mode).shortTitle
}

export function permissionModeIndicator(mode: PermissionMode): string {
  return getModeConfig(mode).indicator
}

export function permissionModeSymbol(mode: PermissionMode): string {
  return getModeConfig(mode).symbol
}

export function getModeColor(mode: PermissionMode): ModeColorKey {
  return getModeConfig(mode).color
}
