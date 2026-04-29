import type { Command } from '../../types/command.js'

const cleanupData = {
  type: 'local',
  name: 'cleanup-data',
  description:
    'Preview or delete local tracking data (memory, shares, progress, history)',
  argumentHint: '[project|all] [--confirm]',
  supportsNonInteractive: true,
  load: () => import('./cleanup-data.js'),
} satisfies Command

export default cleanupData
