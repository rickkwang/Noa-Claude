import type { Command } from '../../commands.js'

const command = {
  name: 'autocompact',
  description:
    'Show or set the auto-compact context-window override (auto | e.g. 500k)',
  supportsNonInteractive: true,
  type: 'local',
  load: () => import('./autocompact.js'),
} satisfies Command

export default command
