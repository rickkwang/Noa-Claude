/**
 * The single gate shared by the `/feedback` command and SendFeedbackTool.
 *
 * Both surfaces must agree: a model that can draft feedback the person has no
 * way to review would leave drafts stranded on disk, and a review dialog with
 * no drafter is only the manual path. Keeping one predicate means a build that
 * disables one disables the other.
 */
import { isPolicyAllowed } from '../services/policyLimits/index.js'
import { isEnvTruthy } from './envUtils.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'

export function isFeedbackDraftingEnabled(): boolean {
  return !(
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
    isEnvTruthy(process.env.DISABLE_FEEDBACK_COMMAND) ||
    isEnvTruthy(process.env.DISABLE_BUG_COMMAND) ||
    isEnvTruthy(process.env.NOA_CLAUDE_DISABLE_FEEDBACK_DRAFTS) ||
    isEssentialTrafficOnly() ||
    process.env.USER_TYPE === 'ant' ||
    !isPolicyAllowed('allow_product_feedback')
  )
}
