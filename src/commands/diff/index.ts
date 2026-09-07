import type { Command } from '../../commands.js'
import { diffPanelIsPreferred } from '../../utils/diffPanelState.js'

export default {
  type: 'local-jsx',
  name: 'diff',
  get description() {
    return diffPanelIsPreferred()
      ? 'Toggle the diff panel showing uncommitted changes'
      : 'View uncommitted changes and per-turn diffs'
  },
  // The sidebar toggle renders nothing, so it must not wait for a stop point:
  // queueing it would leave `/diff` looking dead mid-turn. A getter, not a
  // value: this module is imported while the command registry is built, which
  // can be before startup has finished settling the layout mode.
  get immediate() {
    return diffPanelIsPreferred()
  },
  load: () => import('./diff.js'),
} satisfies Command
