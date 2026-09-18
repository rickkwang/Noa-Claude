// @ts-nocheck
import type { Command } from '../../commands.js'
import { isFeedbackDraftingEnabled } from '../../utils/feedbackDraftsEnabled.js'

const feedback = {
  aliases: ['bug'],
  type: 'local-jsx',
  name: 'feedback',
  description: `Submit feedback about Noa Claude`,
  argumentHint: '[report]',
  // Shared with SendFeedbackTool so the drafter and the review surface are
  // enabled and disabled together — see utils/feedbackDraftsEnabled.ts.
  isEnabled: isFeedbackDraftingEnabled,
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback
