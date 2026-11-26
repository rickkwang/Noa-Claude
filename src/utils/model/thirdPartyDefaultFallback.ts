import { getAnthropicClient } from '../../services/api/client.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import {
  getAWSRegion,
  getVertexRegionForModel,
  isEnvTruthy,
} from '../envUtils.js'
import { getInitialSettings } from '../settings/settings.js'
import { ALL_MODEL_CONFIGS, type ModelKey } from './configs.js'
import { getAliasDefaultKey, getMarketingNameForModel } from './model.js'
import {
  ensureModelStringsInitialized,
  getModelStrings,
} from './modelStrings.js'
import { getAPIProvider } from './providers.js'

type Tier = 'opus' | 'sonnet' | 'haiku'
type Access = 'accessible' | 'refused' | 'unknown'

const TIERS: Array<{ tier: Tier; envVar: string; pins: string[] }> = [
  { tier: 'opus', envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL', pins: [] },
  { tier: 'sonnet', envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL', pins: [] },
  {
    tier: 'haiku',
    envVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    pins: ['ANTHROPIC_SMALL_FAST_MODEL'],
  },
]

const DEADLINE_MS = 20_000
const PROBE_TIMEOUT_MS = 8_000
const REMEMBER_MS = 24 * 60 * 60 * 1000
const KEYS = Object.keys(ALL_MODEL_CONFIGS) as ModelKey[]

const family = (key: ModelKey) => key.replace(/\d+$/, '')

/** Older keys of the same family, newest first (catalog order is oldest first). */
function olderKeys(key: ModelKey, includeSelf = false): ModelKey[] {
  const f = family(key)
  return KEYS.slice(0, KEYS.indexOf(key) + (includeSelf ? 1 : 0))
    .filter(k => family(k) === f)
    .reverse()
}

function accessKey(modelId: string): string {
  const provider = getAPIProvider()
  const where =
    provider === 'bedrock'
      ? getAWSRegion()
      : `${process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? ''}@${getVertexRegionForModel(modelId) ?? ''}`
  return `${provider}|${where}|${modelId}`
}

// Only an answer about the model itself counts as refused; credential, network
// and server errors leave the default alone and are not remembered.
function classify(error: unknown): Access {
  const status = (error as { status?: number })?.status
  if (status === 429) return 'accessible'
  const message = String((error as Error)?.message ?? '')
  if (/token|credential|signature|expired|authenticat/i.test(message)) {
    return 'unknown'
  }
  if (status === 404) return 'refused'
  if ((status === 400 || status === 403) && /model/i.test(message)) {
    return 'refused'
  }
  return 'unknown'
}

async function probe(modelId: string): Promise<Access> {
  const key = accessKey(modelId)
  const remembered = getGlobalConfig().thirdPartyModelAccess?.[key]
  if (remembered && Date.now() - remembered.at < REMEMBER_MS) {
    return remembered.ok ? 'accessible' : 'refused'
  }
  let access: Access
  try {
    const client = await getAnthropicClient({
      maxRetries: 0,
      model: modelId,
      source: 'model_check',
    })
    await client.messages.create(
      { model: modelId, max_tokens: 1, messages: [{ role: 'user', content: '.' }] },
      { timeout: PROBE_TIMEOUT_MS },
    )
    access = 'accessible'
  } catch (error) {
    access = classify(error)
    logForDebugging(
      `[3p-default] ${modelId}: ${access} (${(error as Error)?.message ?? error})`,
    )
  }
  if (access !== 'unknown') {
    saveGlobalConfig(c => ({
      ...c,
      thirdPartyModelAccess: {
        ...c.thirdPartyModelAccess,
        [key]: { ok: access === 'accessible', at: Date.now() },
      },
    }))
  }
  return access
}

/** First candidate in order that answers, probing them all at once. */
async function firstAccessible(
  candidates: Array<{ key: ModelKey; id: string }>,
) {
  const results = await Promise.all(candidates.map(c => probe(c.id)))
  return candidates.find((_, i) => results[i] === 'accessible')
}

async function checkTier(
  t: (typeof TIERS)[number],
  expired: () => boolean,
): Promise<string | null> {
  const defaultKey = getAliasDefaultKey(t.tier)
  const strings = getModelStrings()
  const defaultId = strings[defaultKey]
  if ((await probe(defaultId)) !== 'refused') return null

  const toCandidates = (keys: ModelKey[]) =>
    keys.map(key => ({ key, id: strings[key] })).filter(c => c.id)
  let pick = await firstAccessible(toCandidates(olderKeys(defaultKey)))
  let crossTier = false
  if (!pick && t.tier === 'opus') {
    pick = await firstAccessible(
      toCandidates(olderKeys(getAliasDefaultKey('sonnet'), true)),
    )
    crossTier = !!pick
  }
  // Past the deadline the session has started on the default; leave it.
  if (!pick || expired()) return null

  process.env[t.envVar] = pick.id
  if (crossTier) {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME ??=
      getMarketingNameForModel(pick.id) ?? pick.id
  }
  const tierName = t.tier.charAt(0).toUpperCase() + t.tier.slice(1)
  const from = getMarketingNameForModel(defaultId) ?? defaultId
  const to = getMarketingNameForModel(pick.id) ?? pick.id
  return `${tierName}: ${from} not available — using ${to} for this session`
}

/**
 * On Bedrock and Vertex, check that each tier's built-in default model is
 * enabled for this account. A tier whose default is refused falls back to the
 * newest older model of the same family that answers (Opus may fall back to
 * Sonnet), by setting its ANTHROPIC_DEFAULT_*_MODEL for this session only.
 * Tiers pinned by env or `modelOverrides` are left alone. Verdicts are kept
 * for a day so later launches don't probe again. Returns one notice line per
 * fallback.
 */
export async function checkThirdPartyDefaultModels(): Promise<string[]> {
  const provider = getAPIProvider()
  if (provider !== 'bedrock' && provider !== 'vertex') return []
  if (isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) return []
  await ensureModelStringsInitialized()
  const overrides = getInitialSettings().modelOverrides ?? {}
  // A separate Haiku region would need its own client for every candidate;
  // leave that tier on its default.
  const haikuElsewhere =
    provider === 'bedrock' && !!process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
  const unpinned = TIERS.filter(
    t =>
      !(t.tier === 'haiku' && haikuElsewhere) &&
      ![t.envVar, ...t.pins].some(name => process.env[name]) &&
      !overrides[ALL_MODEL_CONFIGS[getAliasDefaultKey(t.tier)].firstParty],
  )
  if (unpinned.length === 0) return []
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      timedOut = true
      logForDebugging('[3p-default] availability check hit its deadline')
      resolve(null)
    }, DEADLINE_MS)
  })
  try {
    const lines = await Promise.race([
      Promise.all(unpinned.map(t => checkTier(t, () => timedOut).catch(() => null))),
      deadline,
    ])
    return (lines ?? []).filter((l): l is string => l !== null)
  } finally {
    clearTimeout(timer)
  }
}
