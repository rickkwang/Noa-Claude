// @ts-nocheck
import type { Command } from '../../commands.js'

const tui = {
  type: 'local',
  name: 'tui',
  aliases: ['fullscreen'],
  description: 'Toggle or check terminal UI mode (default / fullscreen)',
  argumentHint: '[default | fullscreen]',
  load: () => import('./tui.js'),
} satisfies Command

export default tui