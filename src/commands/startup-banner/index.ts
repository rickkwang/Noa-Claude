// @ts-nocheck
import type { Command } from '../../commands.js'

const startupBanner = {
  type: 'local',
  name: 'startup-banner',
  description: 'Toggle the startup banner style',
  argumentHint: '<openclaude|official|both>',
  load: () => import('./startup-banner.js'),
} satisfies Command

export default startupBanner
