// @ts-nocheck
import { feature } from 'bun:bundle'
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
 * The three prompt capabilities are independent in Claude Code's model
 * manifest. Keep the verified 2.1.220 facts together so a model launch cannot
 * accidentally update the compact-head gate but leave a companion section or
 * cache key on an older rule.
 */
export type BuiltInPromptCapabilities = {
  leanPrompt: boolean
  opus5PromptBundle: boolean
  fable5Mitigations: boolean
}

const LEGACY_PROMPT_CAPABILITIES: BuiltInPromptCapabilities = {
  leanPrompt: false,
  opus5PromptBundle: false,
  fable5Mitigations: false,
}

const DEFAULT_PROMPT_CAPABILITIES: BuiltInPromptCapabilities = {
  leanPrompt: true,
  opus5PromptBundle: false,
  fable5Mitigations: false,
}

const BUILT_IN_PROMPT_CAPABILITIES: Record<
  string,
  BuiltInPromptCapabilities
> = {
  'claude-opus-5': {
    leanPrompt: true,
    opus5PromptBundle: true,
    fable5Mitigations: false,
  },
  'claude-fable-5': {
    leanPrompt: true,
    opus5PromptBundle: false,
    fable5Mitigations: true,
  },
  // Mythos 5's manifest row upstream is `capabilities:[]` — empty. Both
  // `true`s here come from upstream's by-name short-circuits, not a manifest
  // declaration: the verbose-prompt predicate ORs in
  // `model === "claude-mythos-5"` alongside its `lean_prompt` capability check
  // and returns false for both, and the fable-mitigations gate does the same
  // alongside `fable_5_mitigations`. Don't "fix" this to `false` by
  // re-checking the manifest row alone.
  'claude-mythos-5': {
    leanPrompt: true,
    opus5PromptBundle: false,
    fable5Mitigations: true,
  },
  'claude-opus-4-8': DEFAULT_PROMPT_CAPABILITIES,
}

function needsLegacyPromptCapabilities(canonical: string): boolean {
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
 * Resolve the capability facts encoded in Claude Code 2.1.220's model
 * manifest, plus its denylist fallback for legacy and future models.
 */
export function getBuiltInPromptCapabilities(
  model: string,
): BuiltInPromptCapabilities {
  const canonical = getCanonicalName(model)
  return (
    BUILT_IN_PROMPT_CAPABILITIES[canonical] ??
    (needsLegacyPromptCapabilities(canonical)
      ? LEGACY_PROMPT_CAPABILITIES
      : DEFAULT_PROMPT_CAPABILITIES)
  )
}

/**
 * Models that still have to Read a file before Write/Edit may overwrite it.
 *
 * Upstream 2.1.228 gates this on exactly this denylist, so an unrecognized id
 * is allowed by default. Noa can't inherit that fail-open: the skipped branch
 * also skips the mtime staleness check, and upstream backs it with shadow
 * telemetry plus a remote kill switch that Noa has neither of. Untrusted model
 * identities therefore keep the guard, the same way they keep the verbose head.
 */
const MODELS_REQUIRING_PRE_READ = new Set([
  'claude-opus-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-opus-4-0',
  'claude-sonnet-4-5',
  // Upstream matches raw ids, so it lists 'claude-sonnet-4-0'. getCanonicalName
  // folds that to 'claude-sonnet-4'; 4-5 and 4-6 match earlier in its chain.
  'claude-sonnet-4',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
])

/** NOA_CLAUDE_WRITE_REQUIRE_READ forces either mode without a rebuild. */
export function allowsWriteWithoutPriorRead(model: string | undefined): boolean {
  if (!model) return false

  const override = process.env.NOA_CLAUDE_WRITE_REQUIRE_READ
  if (isEnvTruthy(override)) return false
  if (isEnvDefinedFalsy(override)) return true

  if (isUntrustedModelIdentity() && !trustsThirdPartyModelIdentity()) {
    return false
  }

  return !MODELS_REQUIRING_PRE_READ.has(getCanonicalName(model))
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
 * Noa defaults to capability declarations for third-party routes because their
 * model ids are not authoritative. Operators who intentionally mirror
 * upstream's model-name behavior can opt back into it.
 */
function trustsThirdPartyModelIdentity(): boolean {
  return (
    process.env.NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY
      ?.trim()
      .toLowerCase() === 'upstream'
  )
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

  // A pinned model may declare the capability explicitly. This is the only way
  // a third-party endpoint can opt in under Noa's default policy, since its
  // model name proves nothing.
  if (get3PModelCapabilityOverride(model, 'lean_prompt') === true) return true

  // Upstream trusts model-name signals such as EAP and manifest capabilities.
  // Noa applies them only where the identity is trustworthy, unless the
  // operator explicitly requests upstream-compatible behavior.
  const untrustedIdentity = isUntrustedModelIdentity()
  const upstreamThirdPartyPolicy = trustsThirdPartyModelIdentity()
  if (untrustedIdentity && !upstreamThirdPartyPolicy) {
    return false
  }

  // Early-access builds are lean-trained ahead of their GA name landing in any
  // list below, so they short-circuit before the model-name checks.
  if (isEarlyAccessModel(model)) return true

  const canonical = getCanonicalName(model)
  const capabilities = getBuiltInPromptCapabilities(canonical)
  if (!capabilities.leanPrompt) return false

  // Upstream's unknown-model fallback remains provider-aware: customer
  // Bedrock/Vertex/Foundry routes keep the verbose prompt, while first-party
  // (including a custom Anthropic-compatible base URL) defaults future models
  // to lean. Explicit manifest rows and EAP builds were resolved above.
  if (
    untrustedIdentity &&
    upstreamThirdPartyPolicy &&
    getAPIProvider() !== 'firstParty' &&
    BUILT_IN_PROMPT_CAPABILITIES[canonical] === undefined
  ) {
    return false
  }

  return true
}

/**
 * Whether the model ships upstream's "Opus 5 prompt bundle" — the companion
 * sections that travel with the compact head (delivering-work, corrections, the
 * shorter action-caution wording).
 *
 * Upstream's Bash tool used to gate its "Command output is displayed to you,
 * not reliably to the user." bullet on this same capability (true through
 * 2.1.223); 2.1.224 made that bullet unconditional for every lean-prompt model,
 * so it no longer belongs to this bundle — see getLeanPrompt() in
 * tools/BashTool/prompt.ts. Upstream also has a different Bash bullet
 * ("Commands are cheap to run and their errors are informative...") behind a
 * separate GrowthBook flag (`tengu_gorse_plover`/`CLAUDE_CODE_GORSE_PLOVER`,
 * off by default, no bundle fallback — present since at least 2.1.222) that is
 * not ported here.
 *
 * This is a *different* capability from `lean_prompt`, and the two are not
 * co-extensive. Upstream's model manifest declares `lean_prompt` for Opus 5,
 * Fable 5 and Opus 4.8, but `opus_5_prompt_bundle` for Opus 5 alone — so three
 * of the four models on the compact head do *not* carry the bundle. Treating
 * one gate as a proxy for the other gives those three a prompt no upstream
 * build ever produces.
 *
 * Unknown models default to false for the two companion capabilities, as
 * upstream's manifest lookup does: it returns "not declared", never "assume
 * yes".
 *
 * Under Noa's conservative default, a pinned model's own declaration wins over
 * the name, unlike upstream, where a manifest hit short-circuits before the pin
 * is read. That follows the same reasoning as the lean gate itself: on an
 * endpoint Noa cannot vouch for, a Claude-shaped model id proves nothing and
 * the operator's declaration is the only real evidence. The explicit upstream
 * policy restores the manifest-first behavior.
 */
export function hasOpus5PromptBundle(model: string | undefined): boolean {
  if (!model) return false
  const untrustedIdentity = isUntrustedModelIdentity()
  if (untrustedIdentity && trustsThirdPartyModelIdentity()) {
    return getBuiltInPromptCapabilities(model).opus5PromptBundle
  }
  const declared = get3PModelCapabilityOverride(model, 'opus_5_prompt_bundle')
  if (declared !== undefined) {
    return declared && shouldUseCompactSystemPrompt(model)
  }
  if (untrustedIdentity) return false
  return getBuiltInPromptCapabilities(model).opus5PromptBundle
}

/**
 * Ported verbatim from the lean branch of upstream's `anti_verbosity` section,
 * which collapses a multi-paragraph tone-and-style section into one sentence.
 *
 * Under the compact head this is the only style guidance the agent gets: the
 * verbose head's "# Tone and style" section is dropped with the rest of the long
 * head, and upstream substitutes this in its place.
 *
 * Lives here rather than beside the other ported sections because those are
 * reached from the tool prompt modules, which import this file — routing a
 * lean-only string through them closes an import cycle.
 */
export const MATCH_SURROUNDING_CODE_SECTION = `Write code that reads like the surrounding code: match its comment density, naming, and idiom.`

/**
 * Whether the model takes upstream's `fable_5_mitigations` branch of
 * `anti_verbosity`. Upstream reads the capability from its model manifest and
 * additionally special-cases Mythos 5 by name; the capability matrix carries
 * both facts, and a pinned model's own declaration wins, as with the other
 * capability gates here.
 */
export function hasFableMitigations(model: string | undefined): boolean {
  if (!model) return false
  const untrustedIdentity = isUntrustedModelIdentity()
  if (untrustedIdentity && trustsThirdPartyModelIdentity()) {
    return getBuiltInPromptCapabilities(model).fable5Mitigations
  }
  const declared = get3PModelCapabilityOverride(model, 'fable_5_mitigations')
  if (declared !== undefined) {
    return declared && shouldUseCompactSystemPrompt(model)
  }
  if (untrustedIdentity) return false
  return getBuiltInPromptCapabilities(model).fable5Mitigations
}

/**
 * Upstream drops the "text between tool calls may not be shown" warning, and
 * softens the opening sentence, once a dedicated channel exists for reaching the
 * user mid-turn. Its condition ORs brief mode with a second flag guarding its
 * SendUserMessage tool, which has no counterpart here — brief mode is the whole
 * of it for Noa.
 */
function hasMidTurnUserChannel(): boolean {
  if (!(feature('KAIROS') || feature('KAIROS_BRIEF'))) return false
  return (
    require('../tools/BriefTool/BriefTool.js') as typeof import('../tools/BriefTool/BriefTool.js')
  ).isBriefEnabled()
}

/**
 * Ported verbatim from the `fable_5_mitigations` branch of upstream's
 * `anti_verbosity` section. It supersedes the lean one-liner rather than
 * adding to it — the last two paragraphs restate it.
 */
function getCommunicatingWithUserSection(): string {
  const midTurnTextIsUnreliable = !hasMidTurnUserChannel()

  const opening = midTurnTextIsUnreliable
    ? `Your text output is what the user reads; they usually can't see your thinking or the raw tool results.`
    : `Your text output is what the user reads between tool calls; they usually can't see your thinking or the raw tool results.`

  // Upstream separates every paragraph here with a blank line, including the
  // one this conditional opens with — the only single newline in the section is
  // the one before the code-comment sentence, which upstream keeps welded to
  // MATCH_SURROUNDING_CODE_SECTION as a single code-style paragraph.
  const finalMessageWarning = midTurnTextIsUnreliable
    ? `\n\nText you write between tool calls may not be shown to the user. Everything the user needs from this turn — answers, summaries, findings, conclusions, deliverables — must be in the final text message of your turn, with no tool calls after it. Keep text between tool calls to brief status notes. If something important appeared only mid-turn or in your thinking, restate it in that final message.`
    : ''

  return `# Communicating with the user

${opening} Write it for a teammate who stepped away and is catching up, not for a log file: they don't know the codenames or shorthand you created along the way, and they didn't watch your process unfold. Before your first tool call, say in a sentence what you're about to do; while working, give brief updates when you find something load-bearing or change direction.${finalMessageWarning}

Lead with the outcome. Your first sentence after finishing should answer "what happened" or "what did you find" — the thing the user would ask for if they said "just give me the TLDR." Supporting detail and reasoning come after, for readers who want them.

Being readable and being concise are different things, and readable matters more. If the user has to reread your summary or ask you to explain, any time saved by brevity is gone. The way to keep output short is to be selective about what you include (drop details that don't change what the reader would do next), not to compress the writing into fragments, abbreviations, arrow chains like \`A → B → fails\`, or jargon. What you do include, write in complete sentences with the technical terms spelled out. Don't make the reader cross-reference labels or numbering you invented earlier; say what you mean in place.

Match the response to the question: a simple question gets a direct answer in prose, not headers and sections. Use tables only for short enumerable facts, with explanations in the surrounding prose rather than the cells. Calibrate to the user — a bit tighter for an expert, more explanatory for someone newer.

${MATCH_SURROUNDING_CODE_SECTION}
Only write a code comment to state a constraint the code itself can't show — never to say where it came from, what the next line does, or why your change is correct; that's you talking to the reviewer, not the next reader, and it's noise the moment the PR merges.`
}

/**
 * Upstream's `anti_verbosity` section has three branches, checked in this order:
 * the long "Communicating with the user" one for `fable_5_mitigations` models,
 * the one-sentence lean branch, and a long "# Text output" one for everything
 * else.
 *
 * The third is deliberately not ported: Noa's verbose path already carries its
 * own "# Tone and style" section in the long head, so it has nowhere to go.
 *
 * Upstream also forces the first branch on for any model via an env/settings
 * flag. That is a rollout switch rather than a property of the model, and Noa
 * resolves the equivalents in-code, so it has no counterpart here.
 */
export function getAntiVerbositySection(model: string | undefined): string | null {
  if (hasFableMitigations(model)) return getCommunicatingWithUserSection()
  if (shouldUseCompactSystemPrompt(model)) return MATCH_SURROUNDING_CODE_SECTION
  return null
}

/**
 * Ported verbatim from upstream's `action_caution` section, which returns null
 * unless the lean prompt is in use — the verbose head states the same rules at
 * length in its own "Executing actions with care" section.
 *
 * The trailing clause of the "look at the target" sentence is gated separately,
 * on the prompt bundle rather than on the lean prompt: it spells out what to do
 * with unfamiliar state for models that don't already carry that instinct. So it
 * does fire alongside the compact head whenever the bundle is absent.
 */
export function getActionCautionSection(model: string | undefined): string | null {
  if (!shouldUseCompactSystemPrompt(model)) return null

  const unfamiliarState = hasOpus5PromptBundle(model)
    ? ''
    : " — if what you find contradicts how it was described, or you didn't create it, surface that instead of proceeding"

  return `For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking; approval in one context doesn't extend to the next. Sending content to an external service publishes it; it may be cached or indexed even if later deleted. Before deleting or overwriting, look at the target${unfamiliarState}. Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.`
}

/**
 * The text is upstream's, byte for byte, and so is the placement in both
 * tiers. Verified against the 2.1.220 binary, where the constant (`c8s`) is
 * declared once and referenced exactly twice:
 *
 * - The verbose intro builder (`hMy`) emits it as identity line, blank line,
 *   policy, then the URL rule on the very next line (a single newline, not a
 *   blank one). getSimpleIntroSection() reproduces that shape.
 * - The lean head builder (`wMy`) emits it as identity line, blank line,
 *   policy, blank line, `# Harness`. getCompactHeadSection() reproduces that.
 *
 * Both builders sit in the same minified scope, so a grep that misses the
 * `${c8s}` template interpolations will report a false "declared but never
 * referenced" — don't "correct" either tier against such a reading.
 *
 * Lives here rather than beside the other verbose sections for the same reason
 * MATCH_SURROUNDING_CODE_SECTION does: the tool prompt modules import this file,
 * and systemPromptCoreSections.ts imports them, so this file has to stay a leaf.
 */
export const SECURITY_POLICY = `IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.`

/**
 * Replaces the nine static head sections used by the verbose prompt. Everything
 * dropped here is either training-internalized or restated by a dynamic section.
 *
 * Ends at the Harness block, as upstream's does. The action-caution paragraph
 * that reads as part of the head in a rendered prompt is a dynamic section
 * (getActionCautionSection) — it varies per model, so it must not be baked into
 * the static prefix.
 *
 * Spacing follows upstream: a leading newline, then blank lines between the
 * identity line, the security policy and the Harness block. The Noa identity
 * sentence ahead of them is this fork's one addition here.
 */
export function getCompactHeadSection(hasOutputStyle: boolean): string {
  const identity = hasOutputStyle
    ? `You are an interactive agent that helps users according to your "Output Style" below, which describes how you should respond to user queries.`
    : `You are an interactive agent that helps users with software engineering tasks.`

  // eslint-disable-next-line custom-rules/prompt-spacing
  return `
You are Noa Claude, an AI coding agent built on top of Claude Code's publicly available source. Refer to the product as Noa Claude. When users ask about your underlying model, answer truthfully based on the environment information below.
${identity}

${SECURITY_POLICY}

# Harness
 - Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.
 - Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.
 - \`<system-reminder>\` tags in messages and tool results are injected by the harness, not the user. Hooks may intercept tool calls; treat hook output as user feedback.
 - Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.
 - Reference code as \`file_path:line_number\` — it's clickable.`
}
