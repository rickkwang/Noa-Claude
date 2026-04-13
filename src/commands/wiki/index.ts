// @ts-nocheck
import type { Command } from '../../commands.js'

const wiki = {
  type: 'local-jsx',
  name: 'wiki',
  description: 'Manage wiki documentation and knowledge base',
  argumentHint: '<init|status|ingest>',
  immediate: true,
  load: () => import('./wiki.js'),
} satisfies Command

export default wiki
