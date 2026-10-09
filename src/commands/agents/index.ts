// @ts-nocheck
import type { Command } from '../../commands.js'

// Matches upstream: the wizard is removed, so the command only prints guidance.
const agents = {
  type: 'local',
  name: 'agents',
  description: '(removed) Ask Claude to create/manage subagents, or edit .noa/agents/',
  isHidden: true,
  supportsNonInteractive: true,
  load: () => import('./agents.js'),
} satisfies Command

export default agents
