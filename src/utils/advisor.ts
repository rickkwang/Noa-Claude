// @ts-nocheck
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { shouldIncludeFirstPartyOnlyBetas } from './betas.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { getInitialSettings } from './settings/settings.js'

// The SDK does not yet have types for advisor blocks.
// TODO(hackyon): Migrate to the real anthropic SDK types when this feature ships publicly
export type AdvisorServerToolUseBlock = {
  type: 'server_tool_use'
  id: string
  name: 'advisor'
  input: { [key: string]: unknown }
}

export type AdvisorToolResultBlock = {
  type: 'advisor_tool_result'
  tool_use_id: string
  content:
    | {
        type: 'advisor_result'
        text: string
      }
    | {
        type: 'advisor_redacted_result'
        encrypted_content: string
      }
    | {
        type: 'advisor_tool_result_error'
        error_code: string
      }
}

export type AdvisorBlock = AdvisorServerToolUseBlock | AdvisorToolResultBlock

export function isAdvisorBlock(param: {
  type: string
  name?: string
}): param is AdvisorBlock {
  return (
    param.type === 'advisor_tool_result' ||
    (param.type === 'server_tool_use' && param.name === 'advisor')
  )
}

type AdvisorConfig = {
  enabled?: boolean
  canUserConfigure?: boolean
  baseModel?: string
  advisorModel?: string
}

function getAdvisorConfig(): AdvisorConfig {
  return getFeatureValue_CACHED_MAY_BE_STALE<AdvisorConfig>(
    'tengu_sage_compass',
    {},
  )
}

export function isAdvisorEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL)) {
    return false
  }
  // The advisor beta header is first-party only (Bedrock/Vertex 400 on it).
  if (!shouldIncludeFirstPartyOnlyBetas()) {
    return false
  }
  return getAdvisorConfig().enabled ?? false
}

export function canUserConfigureAdvisor(): boolean {
  return isAdvisorEnabled() && (getAdvisorConfig().canUserConfigure ?? false)
}

export function getExperimentAdvisorModels():
  | { baseModel: string; advisorModel: string }
  | undefined {
  const config = getAdvisorConfig()
  return isAdvisorEnabled() &&
    !canUserConfigureAdvisor() &&
    config.baseModel &&
    config.advisorModel
    ? { baseModel: config.baseModel, advisorModel: config.advisorModel }
    : undefined
}

/**
 * Advisor capability ranking, mirroring the `advisor_rank` field in upstream's
 * model-capability table. The rank orders models by capability so the pairing
 * rule below can be expressed once instead of as an N×N allowlist:
 *
 *   - a model can *use* an advisor at all only if it has a rank
 *   - a model can *serve* as an advisor only at rank >= MIN_ADVISOR_RANK
 *   - a pair is valid only when rank(advisor) >= rank(base)
 *
 * Models absent from this table have no rank: they cannot use an advisor and
 * cannot be one. That is the same fail-closed shape upstream uses, and it is
 * why older Opus/Sonnet generations are simply omitted rather than listed at 0.
 *
 * @[MODEL LAUNCH]: Give the new model a rank if it participates in advisor.
 */
const ADVISOR_RANKS: Record<string, number> = {
  'claude-haiku-4-5': 1,
  'claude-sonnet-4-6': 2,
  'claude-sonnet-5': 3,
  'claude-opus-4-6': 3,
  'claude-opus-4-7': 4,
  'claude-opus-4-8': 4,
  'claude-opus-5': 4,
  'claude-fable-5': 5,
  'claude-mythos-5': 5,
}

/** Minimum rank a model needs to serve as somebody's advisor. */
const MIN_ADVISOR_RANK = 2

/**
 * Ant builds skip the rank checks entirely, so unreleased models can be driven
 * from either side of the pair. Upstream has the same escape hatch behind
 * CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL, as an early `true` out of each
 * predicate — not as a synthetic rank, which would still reject a low-ranked
 * model like Haiku 4.5 as an advisor.
 */
function advisorRankChecksBypassed(): boolean {
  return process.env.USER_TYPE === 'ant'
}

function getAdvisorRank(model: string): number | undefined {
  return ADVISOR_RANKS[getCanonicalName(model)]
}

/** Whether `model` can have an advisor attached to its requests. */
export function modelSupportsAdvisor(model: string): boolean {
  if (advisorRankChecksBypassed()) {
    return true
  }
  return getAdvisorRank(model) !== undefined
}

/** Whether `model` is capable enough to serve as an advisor. */
export function isValidAdvisorModel(model: string): boolean {
  if (advisorRankChecksBypassed()) {
    return true
  }
  const rank = getAdvisorRank(model)
  return rank !== undefined && rank >= MIN_ADVISOR_RANK
}

/**
 * Whether `advisorModel` may advise `baseModel`. An advisor must be at least as
 * capable as the model it advises — a weaker advisor is rejected by the API.
 * Unranked models on either side fall through as valid so an unrecognised id
 * is not blocked here; the enablement and allowlist checks above already gate
 * those paths.
 */
export function isValidAdvisorPairing(
  baseModel: string,
  advisorModel: string,
): boolean {
  if (advisorRankChecksBypassed()) {
    return true
  }
  const baseRank = getAdvisorRank(baseModel)
  const advisorRank = getAdvisorRank(advisorModel)
  if (baseRank === undefined || advisorRank === undefined) {
    return true
  }
  return advisorRank >= baseRank
}

export function getInitialAdvisorSetting(): string | undefined {
  if (!isAdvisorEnabled()) {
    return undefined
  }
  return getInitialSettings().advisorModel
}

export function getAdvisorUsage(
  usage: BetaUsage,
): Array<BetaUsage & { model: string }> {
  const iterations = usage.iterations as
    | Array<{ type: string }>
    | null
    | undefined
  if (!iterations) {
    return []
  }
  return iterations.filter(
    it => it.type === 'advisor_message',
  ) as unknown as Array<BetaUsage & { model: string }>
}

export const ADVISOR_TOOL_INSTRUCTIONS = `# Advisor Tool

You have access to an \`advisor\` tool backed by a stronger reviewer model. It takes NO parameters -- when you call it, your entire conversation history is automatically forwarded. The advisor sees the task, every tool call you've made, every result you've seen.

Call advisor BEFORE substantive work -- before writing code, before committing to an interpretation, before building on an assumption. If the task requires orientation first (finding files, reading code, seeing what's there), do that, then call advisor. Orientation is not substantive work. Writing, editing, and declaring an answer are.

Also call advisor:
- When you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, stage the change, save the result. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.
- When stuck -- errors recurring, approach not converging, results that don't fit.
- When considering a change of approach.

On tasks longer than a few steps, call advisor at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling -- the advisor adds most of its value on the first call, before the approach crystallizes.

Give the advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim (the file says X, the code does Y), adapt. A passing self-test is not evidence the advice is wrong -- it's evidence your test doesn't check what the advice is checking.

If you've already retrieved data pointing one way and the advisor points another: don't silently switch. Surface the conflict in one more advisor call -- "I found X, you suggest Y, which constraint breaks the tie?" The advisor saw your evidence but may have underweighted it; a reconcile call is cheaper than committing to the wrong branch.`
