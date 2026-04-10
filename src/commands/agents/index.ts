// @ts-nocheck
import type { Command } from '../../commands.js'

const agents = {
  type: 'local-jsx',
  name: 'agents',
  description: 'Manage local subagents, background agents, and delegation settings',
  load: () => import('./agents.js'),
} satisfies Command

export default agents
