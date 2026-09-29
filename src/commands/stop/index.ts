import type { Command } from '../../commands.js'
import { isBgSession } from '../../utils/background/bgJob.js'

const stop = {
  type: 'local',
  name: 'stop',
  description: 'Stop this background session; transcript is kept',
  supportsNonInteractive: false,
  isEnabled: isBgSession,
  load: () => import('./stop.js'),
} satisfies Command

export default stop
