// @ts-nocheck
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js'
import { getCanonicalName } from '../utils/model/model.js'
import {
  getAPIProvider,
  isThirdPartyAnthropicCompatibleProvider,
} from '../utils/model/providers.js'
import { get3PModelCapabilityOverride } from '../utils/model/modelSupportOverrides.js'

/**
 * Compact ("lean") system prompt.
 *
 * Newer Claude generations internalize during training most of what the long
 * prompt spells out, so the explicit rules and examples read as noise rather
 * than guidance. Older models still need them, so both heads live here and the
 * model decides which one is used.
 *
 * shouldUseCompactSystemPrompt() is the single gate for that choice. It drives
 * the static prompt head here and the per-tool descriptions in src/tools/*, so
 * a model only ever sees one mode's wording.
 *
 * What never varies: the dynamic sections (memory, env, session guidance,
 * output style). A model switch changes how much the agent is told about how to
 * behave, never what it knows about the session.
 */

/** Early Access Program builds, e.g. `claude-opus-6-eap` or `claude-opus-6-eap[1m]`. */
function isEarlyAccessModel(model: string): boolean {
  return /-eap($|\[)/i.test(model)
}

/**
 * Models that predate the lean-prompt training and still need the long head.
 * Everything not matched here — Opus 5, Fable 5, Mythos 5, and anything newer —
 * gets the compact head. Denylist rather than allowlist so a newly added model
 * defaults to lean instead of silently inheriting the legacy prompt.
 */
function needsVerboseSystemPrompt(canonical: string): boolean {
  return (
    canonical.includes('claude-3-') ||
    canonical.includes('haiku') ||
    canonical.includes('sonnet') ||
    canonical === 'claude-opus-4-0' ||
    canonical === 'claude-opus-4-1' ||
    canonical === 'claude-opus-4-5' ||
    canonical === 'claude-opus-4-6' ||
    canonical === 'claude-opus-4-7'
  )
}

/**
 * Backends whose model id doesn't reliably identify the model actually serving
 * the request keep the verbose head.
 *
 * Upstream trusts only endpoints Anthropic itself operates (first-party, its
 * own AWS/GCP deployments, and its gateway). Customer-run Bedrock, Vertex and
 * Foundry are deliberately *not* trusted there — the configured model id can be
 * an inference profile, a custom ARN, or a cross-region alias that says nothing
 * about the underlying model. Noa has no equivalent of those Anthropic-internal
 * providers, so first-party is the only trusted case that survives here.
 *
 * The subtler case is an Anthropic-compatible third party (Kimi, MiniMax,
 * DeepSeek), which reports provider 'firstParty' while serving a completely
 * different model behind a Claude-shaped name.
 */
function isUntrustedModelIdentity(): boolean {
  if (isThirdPartyAnthropicCompatibleProvider()) return true
  return getAPIProvider() !== 'firstParty'
}

/**
 * NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT (legacy: CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT)
 * forces the choice in either direction, so a lean-prompt regression can be
 * bisected without a rebuild.
 */
export function shouldUseCompactSystemPrompt(model: string | undefined): boolean {
  if (!model) return false

  const override =
    process.env.NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT ??
    process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT
  if (isEnvTruthy(override)) return true
  if (isEnvDefinedFalsy(override)) return false

  // Early-access builds are lean-trained ahead of their GA name landing in any
  // list below, so they short-circuit before the model-name checks.
  if (isEarlyAccessModel(model)) return true

  // A pinned model may declare the capability explicitly. This is the only way
  // a third-party endpoint can opt in, since its model name proves nothing.
  if (get3PModelCapabilityOverride(model, 'lean_prompt') === true) return true

  const canonical = getCanonicalName(model)
  if (canonical === 'claude-mythos-5') return true

  if (needsVerboseSystemPrompt(canonical)) return false

  return !isUntrustedModelIdentity()
}

/**
 * Ported verbatim from upstream's `action_caution` section, which returns null
 * unless the lean prompt is in use — the verbose head states the same rules at
 * length in its own "Executing actions with care" section.
 *
 * Upstream appends a clause here ("if what you find contradicts how it was
 * described…") only for models *without* the capability flag that this same
 * gate requires, so it never fires alongside the lean prompt and has no
 * counterpart below.
 */
const ACTION_CAUTION_PARAGRAPH = `For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking; approval in one context doesn't extend to the next. Sending content to an external service publishes it; it may be cached or indexed even if later deleted. Before deleting or overwriting, look at the target. Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.`

const SECURITY_POLICY = `IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.`

/**
 * Replaces the nine static head sections used by the verbose prompt. Everything
 * dropped here is either training-internalized or restated by a dynamic section.
 */
export function getCompactHeadSection(hasOutputStyle: boolean): string {
  const identity = hasOutputStyle
    ? `You are an interactive agent that helps users according to your "Output Style" below, which describes how you should respond to user queries.`
    : `You are an interactive agent that helps users with software engineering tasks.`

  return `You are Noa Claude, an AI coding agent built on top of Claude Code's publicly available source. Refer to the product as Noa Claude. When users ask about your underlying model, answer truthfully based on the environment information below.
${identity}

${SECURITY_POLICY}

# Harness
 - Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.
 - Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.
 - \`<system-reminder>\` tags in messages and tool results are injected by the harness, not the user. Hooks may intercept tool calls; treat hook output as user feedback.
 - Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.
 - Reference code as \`file_path:line_number\` — it's clickable.

${ACTION_CAUTION_PARAGRAPH}`
}
