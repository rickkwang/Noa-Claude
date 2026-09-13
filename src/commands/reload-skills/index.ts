/**
 * /reload-skills — pick up skills added or changed on disk during this
 * session. The lighter sibling of /reload-plugins: it re-scans the skill
 * directories without touching plugins, hooks, MCP or LSP servers.
 * Implementation lazy-loaded.
 */
import type { Command } from '../../commands.js'

const reloadSkills = {
  type: 'local',
  name: 'reload-skills',
  description: 'Pick up skills added or changed on disk during this session',
  supportsNonInteractive: false,
  load: () => import('./reload-skills.js'),
} satisfies Command

export default reloadSkills
