// @ts-nocheck
import { BUILD_EXCLUDED_ERROR_CONTRACTS } from './buildExcluded.js'

export type CommandSurfaceCategory =
  | 'baseline'
  | 'implemented-non-baseline'
  | 'build-excluded'
  | 'stub'

export type CommandDiscoverability = 'visible' | 'hidden'

export type CommandSurfaceEntry = {
  command: `/${string}`
  category: CommandSurfaceCategory
  discoverability: CommandDiscoverability
  supportsNonInteractive: boolean | null
  reason: string
  upgradeCondition: string
  errorContract?:
    | {
        errorId: string
        message: string
      }
    | null
}

const baseline: CommandSurfaceEntry[] = [
  {
    command: '/fork',
    category: 'baseline',
    discoverability: 'visible',
    supportsNonInteractive: true,
    reason: 'Core resumable workflow for session branching.',
    upgradeCondition: 'N/A',
  },
  {
    command: '/workflows',
    category: 'baseline',
    discoverability: 'visible',
    supportsNonInteractive: null,
    reason: 'Core reusable workflow management surface.',
    upgradeCondition: 'N/A',
  },
  {
    command: '/summary',
    category: 'baseline',
    discoverability: 'visible',
    supportsNonInteractive: true,
    reason: 'Core session summarization for continuity.',
    upgradeCondition: 'N/A',
  },
  {
    command: '/share',
    category: 'baseline',
    discoverability: 'visible',
    supportsNonInteractive: true,
    reason: 'Core local export for session artifacts.',
    upgradeCondition: 'N/A',
  },
]

const implementedNonBaseline: CommandSurfaceEntry[] = [
  {
    command: '/assistant',
    category: 'implemented-non-baseline',
    discoverability: 'visible',
    supportsNonInteractive: true,
    reason: 'Implements assistant preference/status management only.',
    upgradeCondition:
      'Promote after runtime activation flow and full assistant execution semantics are delivered.',
  },
  {
    command: '/heapdump',
    category: 'implemented-non-baseline',
    discoverability: 'visible',
    supportsNonInteractive: true,
    reason: 'Engineering diagnostic utility, not primary workflow.',
    upgradeCondition:
      'Promote only if converted to user-facing diagnostics workflow.',
  },
  {
    command: '/cleanup-data',
    category: 'implemented-non-baseline',
    discoverability: 'visible',
    supportsNonInteractive: true,
    reason: 'Unified local tracking-data cleanup command with explicit confirm gate.',
    upgradeCondition:
      'Promote only after retention policy and backup/restore UX are finalized.',
  },
  {
    command: '/rate-limit-options',
    category: 'implemented-non-baseline',
    discoverability: 'visible',
    supportsNonInteractive: null,
    reason: 'Subscriber/runtime-gated overflow action sheet.',
    upgradeCondition:
      'Promote after de-gating and stable UX semantics across auth types.',
  },
]

const buildExcluded: CommandSurfaceEntry[] = [
  {
    command: '/proactive',
    category: 'build-excluded',
    discoverability: 'hidden',
    supportsNonInteractive: null,
    reason: 'Feature intentionally excluded from this build.',
    upgradeCondition: 'Requires full feature delivery, not visibility toggle.',
    errorContract: BUILD_EXCLUDED_ERROR_CONTRACTS.proactive,
  },
  {
    command: '/peers',
    category: 'build-excluded',
    discoverability: 'hidden',
    supportsNonInteractive: null,
    reason: 'Feature intentionally excluded from this build.',
    upgradeCondition: 'Requires full feature delivery, not visibility toggle.',
    errorContract: BUILD_EXCLUDED_ERROR_CONTRACTS.peers,
  },
  {
    command: '/remote-control',
    category: 'build-excluded',
    discoverability: 'hidden',
    supportsNonInteractive: null,
    reason: 'Feature intentionally excluded from this build.',
    upgradeCondition: 'Requires full feature delivery, not visibility toggle.',
    errorContract: BUILD_EXCLUDED_ERROR_CONTRACTS['remote-control'],
  },
  {
    command: '/force-snip',
    category: 'build-excluded',
    discoverability: 'hidden',
    supportsNonInteractive: null,
    reason: 'Feature intentionally excluded from this build.',
    upgradeCondition: 'Requires full feature delivery, not visibility toggle.',
    errorContract: BUILD_EXCLUDED_ERROR_CONTRACTS['force-snip'],
  },
  {
    command: '/subscribe-pr',
    category: 'build-excluded',
    discoverability: 'hidden',
    supportsNonInteractive: null,
    reason: 'Feature intentionally excluded from this build.',
    upgradeCondition: 'Requires full feature delivery, not visibility toggle.',
    errorContract: BUILD_EXCLUDED_ERROR_CONTRACTS['subscribe-pr'],
  },
]

const stubs: CommandSurfaceEntry[] = [
  '/autofix-pr',
  '/bughunter',
  '/teleport',
  '/good-claude',
  '/mock-limits',
  '/reset-limits',
  '/issue',
].map(command => ({
  command: command as `/${string}`,
  category: 'stub' as const,
  discoverability: 'hidden' as const,
  supportsNonInteractive: null,
  reason: 'Placeholder surface tracked in governance only; not registered in runtime.',
  upgradeCondition: 'Requires net-new implementation before exposure.',
}))

export const COMMAND_SURFACE_STATUS: CommandSurfaceEntry[] = [
  ...baseline,
  ...implementedNonBaseline,
  ...buildExcluded,
  ...stubs,
]

export function getCommandSurfacesByCategory(category: CommandSurfaceCategory) {
  return COMMAND_SURFACE_STATUS.filter(entry => entry.category === category)
}
