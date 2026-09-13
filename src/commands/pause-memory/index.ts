/**
 * /pause-memory — session-scoped kill switch for auto-memory. The persistent
 * controls (autoMemoryEnabled in settings.json,
 * CLAUDE_CODE_DISABLE_AUTO_MEMORY) both outlive the session and need a
 * restart; this one lasts until the session ends.
 * Implementation lazy-loaded.
 */
import type { Command } from '../../commands.js'

const pauseMemory = {
  type: 'local',
  name: 'pause-memory',
  description: 'Pause auto-memory reads and writes for this session',
  argumentHint: '[pause|resume]',
  supportsNonInteractive: true,
  load: () => import('./pause-memory.js'),
} satisfies Command

export default pauseMemory
