import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

// Print and SDK sessions cannot render the dialog, so they get the text form.
const command = {
  type: 'local',
  name: 'autocompact',
  description: 'Set how full the context gets before auto-summarizing',
  argumentHint: '[auto|<tokens>]',
  supportsNonInteractive: true,
  isEnabled: () => getIsNonInteractiveSession(),
  load: () => import('./headless-impl.js'),
} satisfies Command

export default command
