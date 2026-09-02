// @ts-nocheck
import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>

// @[MODEL LAUNCH]: Add a new CLAUDE_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const CLAUDE_3_7_SONNET_CONFIG = {
  firstParty: 'claude-3-7-sonnet-20250219',
  bedrock: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  vertex: 'claude-3-7-sonnet@20250219',
  foundry: 'claude-3-7-sonnet',
} as const satisfies ModelConfig

export const CLAUDE_3_5_V2_SONNET_CONFIG = {
  firstParty: 'claude-3-5-sonnet-20241022',
  bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  vertex: 'claude-3-5-sonnet-v2@20241022',
  foundry: 'claude-3-5-sonnet',
} as const satisfies ModelConfig

export const CLAUDE_3_5_HAIKU_CONFIG = {
  firstParty: 'claude-3-5-haiku-20241022',
  bedrock: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  vertex: 'claude-3-5-haiku@20241022',
  foundry: 'claude-3-5-haiku',
} as const satisfies ModelConfig

export const CLAUDE_HAIKU_4_5_CONFIG = {
  firstParty: 'claude-haiku-4-5-20251001',
  bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  vertex: 'claude-haiku-4-5@20251001',
  foundry: 'claude-haiku-4-5',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_CONFIG = {
  firstParty: 'claude-sonnet-4-20250514',
  bedrock: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  vertex: 'claude-sonnet-4@20250514',
  foundry: 'claude-sonnet-4',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_5_CONFIG = {
  firstParty: 'claude-sonnet-4-5-20250929',
  bedrock: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  vertex: 'claude-sonnet-4-5@20250929',
  foundry: 'claude-sonnet-4-5',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_CONFIG = {
  firstParty: 'claude-opus-4-20250514',
  bedrock: 'us.anthropic.claude-opus-4-20250514-v1:0',
  vertex: 'claude-opus-4@20250514',
  foundry: 'claude-opus-4',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_1_CONFIG = {
  firstParty: 'claude-opus-4-1-20250805',
  bedrock: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  vertex: 'claude-opus-4-1@20250805',
  foundry: 'claude-opus-4-1',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_5_CONFIG = {
  firstParty: 'claude-opus-4-5-20251101',
  bedrock: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  vertex: 'claude-opus-4-5@20251101',
  foundry: 'claude-opus-4-5',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_6_CONFIG = {
  firstParty: 'claude-opus-4-6',
  bedrock: 'us.anthropic.claude-opus-4-6-v1',
  vertex: 'claude-opus-4-6',
  foundry: 'claude-opus-4-6',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_7_CONFIG = {
  firstParty: 'claude-opus-4-7',
  bedrock: 'us.anthropic.claude-opus-4-7',
  vertex: 'claude-opus-4-7',
  foundry: 'claude-opus-4-7',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_8_CONFIG = {
  firstParty: 'claude-opus-4-8',
  bedrock: 'us.anthropic.claude-opus-4-8',
  vertex: 'claude-opus-4-8',
  foundry: 'claude-opus-4-8',
} as const satisfies ModelConfig

// Opus 5 — successor to Opus 4.8 at the same $5/$25 pricing. Same request
// surface as Opus 4.8 (adaptive thinking only; sampling params + budget_tokens
// removed) with two differences, both handled in thinking.ts/claude.ts:
//   1. thinking is ON by default — omitting the param runs adaptive, so turning
//      thinking off needs an explicit {type:'disabled'} (like Sonnet 5).
//   2. {type:'disabled'} is only accepted at effort `high` or below; pairing it
//      with `xhigh`/`max` returns a 400.
// 1M context is both the default and the maximum; 128K max output.
export const CLAUDE_OPUS_5_CONFIG = {
  firstParty: 'claude-opus-5',
  bedrock: 'us.anthropic.claude-opus-5',
  vertex: 'claude-opus-5',
  foundry: 'claude-opus-5',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_6_CONFIG = {
  firstParty: 'claude-sonnet-4-6',
  bedrock: 'us.anthropic.claude-sonnet-4-6',
  vertex: 'claude-sonnet-4-6',
  foundry: 'claude-sonnet-4-6',
} as const satisfies ModelConfig

// Sonnet 5 — near-Opus quality on coding/agentic work at Sonnet cost. Same
// request surface as Opus 4.7/4.8 (adaptive thinking only; sampling params
// removed) with one difference: omitting `thinking` runs adaptive by default
// (Opus 4.7/4.8 omit = no thinking), so disabling thinking needs an explicit
// {type:'disabled'} — handled in claude.ts.
export const CLAUDE_SONNET_5_CONFIG = {
  firstParty: 'claude-sonnet-5',
  bedrock: 'us.anthropic.claude-sonnet-5',
  vertex: 'claude-sonnet-5',
  foundry: 'claude-sonnet-5',
} as const satisfies ModelConfig

// Fable 5 — most powerful tier, above Opus. Same request surface as Opus 4.8
// (adaptive thinking only; sampling params + budget_tokens removed) with one
// extra quirk: an explicit thinking:{type:'disabled'} returns 400 — omit the
// param instead (already handled in claude.ts, which omits when thinking is off).
export const CLAUDE_FABLE_5_CONFIG = {
  firstParty: 'claude-fable-5',
  bedrock: 'us.anthropic.claude-fable-5',
  vertex: 'claude-fable-5',
  foundry: 'claude-fable-5',
} as const satisfies ModelConfig

// Fable 5.1 — successor to Fable 5 in the same tier at the same per-token
// price ($10/$50), with cheaper cache reads ($0.25/Mtok). Same request surface
// as Fable 5 (thinking always on, sampling params + budget_tokens removed,
// explicit thinking:{type:'disabled'} 400s) plus three breaking changes:
//   1. forced tool use — tool_choice {type:'any'|'tool'} returns a 400. See
//      modelRejectsForcedToolChoice() in utils/betas.ts.
//   2. thinking blocks are bound to the producing model; other models drop
//      them (unbilled), so nothing has to be stripped when switching models.
//   3. "preserved thinking": editing earlier turns invalidates thinking
//      blocks. Accounts created on/after 2026-08-31 get a 400 on edited
//      history. Noa's compaction rewrites history — see docs/operating-guide.
// 1M context is both default and maximum; 128K max output. ZDR orgs are
// rejected (400) unless expressly authorized; no Priority Tier; no fast mode.
export const CLAUDE_FABLE_5_1_CONFIG = {
  firstParty: 'claude-fable-5-1',
  bedrock: 'us.anthropic.claude-fable-5-1',
  vertex: 'claude-fable-5-1',
  foundry: 'claude-fable-5-1',
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  haiku35: CLAUDE_3_5_HAIKU_CONFIG,
  haiku45: CLAUDE_HAIKU_4_5_CONFIG,
  sonnet35: CLAUDE_3_5_V2_SONNET_CONFIG,
  sonnet37: CLAUDE_3_7_SONNET_CONFIG,
  sonnet40: CLAUDE_SONNET_4_CONFIG,
  sonnet45: CLAUDE_SONNET_4_5_CONFIG,
  sonnet46: CLAUDE_SONNET_4_6_CONFIG,
  sonnet5: CLAUDE_SONNET_5_CONFIG,
  opus40: CLAUDE_OPUS_4_CONFIG,
  opus41: CLAUDE_OPUS_4_1_CONFIG,
  opus45: CLAUDE_OPUS_4_5_CONFIG,
  opus46: CLAUDE_OPUS_4_6_CONFIG,
  opus47: CLAUDE_OPUS_4_7_CONFIG,
  opus48: CLAUDE_OPUS_4_8_CONFIG,
  opus5: CLAUDE_OPUS_5_CONFIG,
  fable5: CLAUDE_FABLE_5_CONFIG,
  fable51: CLAUDE_FABLE_5_1_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical first-party model IDs, e.g. 'claude-opus-4-6' | 'claude-sonnet-4-5-20250929' | … */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
