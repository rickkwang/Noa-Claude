import { chmod, readFile, writeFile, mkdir } from 'fs/promises'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { saveGlobalConfig } from './config.js'
import { normalizeApiKeyForConfig } from './authPortable.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isBareMode } from './envUtils.js'
import {
  PROVIDER_CATALOGUE_ENV_KEYS,
  PROVIDER_CONTEXT_WINDOWS_ENV_KEY,
  PROVIDER_EFFORT_LEVELS_ENV_KEY,
  PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY,
  PROVIDER_MODELS_ENV_KEY,
  serializeProviderContextWindows,
  serializeProviderEffortLevels,
  serializeProviderList,
  serializeProviderMaxOutputTokens,
  type MaxOutputTokens,
} from './model/providerModels.js'
import * as lockfile from './lockfile.js'
import { updateSettingsForSource, getSettingsForSource } from './settings/settings.js'

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'github'
  | 'mistral'
  | 'ollama'
  | 'codex'
  | 'deepseek'
  | 'kimi'
  | 'moonshot'
  | 'minimax'
  | 'glm'
  | 'together'
  | 'groq'
  | 'azure-openai'
  | 'openrouter'
  | 'lmstudio'
  | 'mimo'

export interface ProviderProfile {
  id: string
  name: string
  type: ProviderType
  active?: boolean
  baseUrl?: string
  apiKey?: string
  model?: string
  // Everything the endpoint's own model list returned at setup time. `model` is
  // just the one picked as the default; without this the picker has nothing but
  // that single id to offer (see buildProviderEnv).
  models?: string[]
  // Real context window per model id, e.g. { "k3": 1048576 }. Merged over
  // PROVIDER_TYPE_CONTEXT_WINDOWS so adding one model doesn't mean restating
  // the rest. Anything not listed keeps the built-in resolution.
  contextWindows?: Record<string, number>
  // Exact effort levels the endpoint accepts per model id, e.g.
  // { "k3": ['low', 'high', 'max'] }. Merged over PROVIDER_TYPE_EFFORT_LEVELS;
  // an explicit [] declares none, which is how a user turns off a default
  // their endpoint rejects.
  effortLevels?: Record<string, string[]>
  // Output-token limits per model id. Merged over
  // PROVIDER_TYPE_MAX_OUTPUT_TOKENS, like contextWindows.
  maxOutputTokens?: Record<string, MaxOutputTokens>
}

/**
 * The exact effort levels a provider type's endpoint accepts, per model.
 *
 * Only for models whose behaviour is documented — declaring a level that isn't
 * there means the endpoint rejects every request carrying it. Keyed by type
 * rather than written into the setup presets so profiles saved before a type
 * was added here pick it up without being re-created.
 */
export const PROVIDER_TYPE_EFFORT_LEVELS: Partial<
  Record<ProviderType, Record<string, string[]>>
> = {
  // Kimi's platform docs for K3: "支持通过请求顶层 reasoning_effort 配置推理强
  // 度", values low / high / max. No `medium` and no `xhigh` — a requested one
  // of those is clamped down to the next level this list does contain (see
  // clampEffortToSupportedLevels), rather than sent through as a value the
  // endpoint never documented.
  //
  // The K2.7 Code models are listed empty rather than omitted: their docs give
  // them `Thinking:ON` with no reasoning_effort at all, so declaring "none"
  // states that outright instead of falling through to a resolution that knows
  // only Claude ids.
  kimi: {
    k3: ['low', 'high', 'max'],
    'k3-256k': ['low', 'high', 'max'],
    'kimi-for-coding': [],
    'kimi-for-coding-highspeed': [],
  },
}

/**
 * Context windows a provider type's endpoint is documented to serve, per model.
 *
 * Only documented values belong here. Over-reporting is the dangerous
 * direction: auto-compact aims at the declared window, so a window larger than
 * the endpoint's real one means the session overflows instead of compacting.
 * Under-reporting only costs an early compact, which is why anything unlisted
 * is left at the conservative built-in default rather than guessed at.
 */
export const PROVIDER_TYPE_CONTEXT_WINDOWS: Partial<
  Record<ProviderType, Record<string, number>>
> = {
  // Per Kimi Code's model table: K3 up to 1M, the 256k K3 variant and both
  // K2.7 Code models at 256k. Kimi's own Claude Code guide configures 1048576
  // for K3 on this endpoint, and its CLI pins max_context_size to the same
  // value.
  //
  // Caveat on `k3`: the 1M window is a membership tier unlock ("最高 1M"), and
  // what a lower tier actually gets is not documented. This follows Kimi's own
  // Claude Code instructions; a lower-tier user who sees the session overflow
  // rather than compact should point the profile at `k3-256k`.
  kimi: {
    k3: 1_048_576,
    'k3-256k': 262_144,
    'kimi-for-coding': 262_144,
    'kimi-for-coding-highspeed': 262_144,
  },
}

/**
 * Output-token limits a provider type's endpoint documents, per model.
 *
 * `default` is sent as max_tokens on every request, so it has to be a value the
 * endpoint accepts; `upperLimit` only bounds CLAUDE_CODE_MAX_OUTPUT_TOKENS and
 * the legacy thinking budget, which claude.ts clamps to max_tokens - 1 anyway.
 */
export const PROVIDER_TYPE_MAX_OUTPUT_TOKENS: Partial<
  Record<ProviderType, Record<string, MaxOutputTokens>>
> = {
  // Kimi's K3 docs: max_completion_tokens defaults to 131072 and can be set as
  // high as 1048576. Only K3 is documented, so nothing else is declared.
  kimi: { k3: { default: 131_072, upperLimit: 1_048_576 } },
}

// Resolved per call, not at module load: CLAUDE_CONFIG_DIR is set by the
// launcher and can be reassigned before this module is first used.
function providerProfilesPath(): string {
  return join(getClaudeConfigHomeDir(), 'provider-profiles.json')
}
// API keys are printable ASCII. Rejecting only whitespace, controls and CJK
// let other scripts through while blocking pasted prose in one language.
const INVALID_CREDENTIAL_CHARS = /[^\x21-\x7e]/

export async function loadProviderProfiles(): Promise<ProviderProfile[]> {
  try {
    const content = await readFile(providerProfilesPath(), 'utf-8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

export async function saveProviderProfiles(
  profiles: ProviderProfile[],
): Promise<void> {
  await mutateProviderProfiles(() => ({ next: profiles, result: undefined }))
}

async function ensureProviderProfilesFile(): Promise<void> {
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  try {
    await writeFile(providerProfilesPath(), '[]', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error
    // Profiles hold third-party API keys. Files created before the mode above
    // was set are world-readable; narrow them on the next mutation.
    await chmod(providerProfilesPath(), 0o600).catch(() => {})
  }
}

async function mutateProviderProfiles<T>(
  mutate: (
    profiles: ProviderProfile[],
  ) => { next?: ProviderProfile[]; result: T },
): Promise<T> {
  await ensureProviderProfilesFile()
  const release = await lockfile.lock(providerProfilesPath(), {
    realpath: false,
    retries: { retries: 20, minTimeout: 5, maxTimeout: 50 },
  })
  try {
    const profiles = await loadProviderProfiles()
    const { next, result } = mutate(profiles)
    if (next) {
      await writeProviderProfilesUnlocked(next)
    }
    return result
  } finally {
    await release()
  }
}

async function writeProviderProfilesUnlocked(
  profiles: ProviderProfile[],
): Promise<void> {
  await writeFile(
    providerProfilesPath(),
    JSON.stringify(profiles, null, 2),
    'utf8',
  )
}

export async function withDeactivatedProviderProfiles<T>(
  operation: (deactivated: ProviderProfile | null) => Promise<T>,
  rollback?: (deactivated: ProviderProfile | null) => Promise<void>,
): Promise<T> {
  await ensureProviderProfilesFile()
  const release = await lockfile.lock(providerProfilesPath(), {
    realpath: false,
    retries: { retries: 20, minTimeout: 5, maxTimeout: 50 },
  })
  try {
    const profiles = await loadProviderProfiles()
    const active = getActiveProviderProfile(profiles)
    try {
      if (active) {
        await writeProviderProfilesUnlocked(
          profiles.map(profile => ({ ...profile, active: false })),
        )
      }
      return await operation(active)
    } catch (error) {
      try {
        if (active) await writeProviderProfilesUnlocked(profiles)
        await rollback?.(active)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'OAuth provider transition and rollback both failed',
        )
      }
      throw error
    }
  } finally {
    await release()
  }
}

export async function addProviderProfile(
  profile: Omit<ProviderProfile, 'id'>,
): Promise<ProviderProfile> {
  const newProfile: ProviderProfile = {
    ...normalizeProviderProfileCredential(profile),
    id: randomUUID(),
  }
  return mutateProviderProfiles(profiles => ({
    next: [...profiles, newProfile],
    result: newProfile,
  }))
}

const ENDPOINT_SCOPED_KEYS = [
  'apiKey',
  'models',
  'effortLevels',
  'contextWindows',
  'maxOutputTokens',
] as const satisfies readonly (keyof ProviderProfile)[]

export async function updateProviderProfile(
  id: string,
  updates: Partial<Omit<ProviderProfile, 'id'>>,
): Promise<ProviderProfile | null> {
  return mutateProviderProfiles(profiles => {
    const index = profiles.findIndex(p => p.id === id)
    const existing = profiles[index]
    if (index === -1 || !existing) return { result: null }
    // A key absent from `updates` and a key explicitly set to undefined must
    // both mean "leave it alone"; spreading undefined erased stored apiKeys.
    const provided = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    )
    const endpointChanged =
      (updates.type !== undefined && updates.type !== existing.type) ||
      (updates.baseUrl !== undefined &&
        getNormalizedBaseUrl({ ...existing, baseUrl: updates.baseUrl }) !==
          getNormalizedBaseUrl(existing))
    const merged = { ...existing, ...provided }
    if (endpointChanged) {
      // These all describe the endpoint that supplied them — its credential,
      // the models it served and what it accepts for them. Pointing the profile
      // elsewhere invalidates every one, so drop any the caller didn't respecify
      // rather than let them describe an endpoint they were never read from.
      for (const key of ENDPOINT_SCOPED_KEYS) {
        if (updates[key] === undefined) delete merged[key]
      }
    }
    const updated = normalizeProviderProfileCredential(merged)
    const next = [...profiles]
    next[index] = updated
    return { next, result: updated }
  })
}

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  github: 'GitHub Models',
  mistral: 'Mistral',
  ollama: 'Ollama',
  codex: 'OpenAI Codex',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  moonshot: 'Moonshot',
  minimax: 'MiniMax',
  glm: 'Z.AI GLM',
  together: 'Together AI',
  groq: 'Groq',
  'azure-openai': 'Azure OpenAI',
  openrouter: 'OpenRouter',
  lmstudio: 'LM Studio',
  mimo: 'Xiaomi MiMo',
}

function setEnvKey(target: Record<string, string>, key: string, value?: string): void {
  if (!value) return
  target[key] = value
}

export function normalizeProviderProfileCredential<
  T extends Pick<ProviderProfile, 'name' | 'apiKey'>,
>(profile: T): T {
  const apiKey = profile.apiKey?.trim()
  if (!apiKey) {
    const { apiKey: _apiKey, ...rest } = profile
    return rest as T
  }

  if (INVALID_CREDENTIAL_CHARS.test(apiKey)) {
    throw new Error(
      `Provider profile "${profile.name}" has an invalid API key. Paste only the credential token, not notes or instructions.`,
    )
  }

  return { ...profile, apiKey }
}

export function getActiveProviderProfile(
  profiles: ProviderProfile[],
): ProviderProfile | null {
  return profiles.find(profile => profile.active) ?? null
}

export function buildProviderEnv(profile: ProviderProfile): Record<string, string> {
  const env: Record<string, string> = {}
  const normalizedProfile = normalizeProviderProfileCredential(profile)
  const normalizedBaseUrl = getNormalizedBaseUrl(profile)

  switch (normalizedProfile.type) {
    case 'anthropic':
      setEnvKey(env, 'ANTHROPIC_BASE_URL', normalizedBaseUrl)
      setEnvKey(env, 'ANTHROPIC_API_KEY', normalizedProfile.apiKey)
      setEnvKey(env, 'ANTHROPIC_MODEL', normalizedProfile.model)
      break
    case 'minimax':
    case 'kimi':
      // These providers use Bearer auth (Authorization header), not x-api-key.
      // Only set ANTHROPIC_AUTH_TOKEN to avoid the "both token and API key set"
      // conflict warning from the SDK.
      setEnvKey(env, 'ANTHROPIC_BASE_URL', normalizedBaseUrl)
      setEnvKey(env, 'ANTHROPIC_AUTH_TOKEN', normalizedProfile.apiKey)
      setEnvKey(env, 'ANTHROPIC_MODEL', normalizedProfile.model)
      // Both serve a single model, so the Claude tier aliases and the subagent
      // model have to be pinned to it or those lookups fall back to a
      // claude-* id the endpoint does not serve.
      setEnvKey(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL', normalizedProfile.model)
      setEnvKey(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL', normalizedProfile.model)
      setEnvKey(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL', normalizedProfile.model)
      setEnvKey(env, 'CLAUDE_CODE_SUBAGENT_MODEL', normalizedProfile.model)
      break
    case 'openai':
    case 'gemini':
    case 'github':
    case 'mistral':
    case 'ollama':
    case 'codex':
    case 'deepseek':
    case 'moonshot':
    case 'glm':
    case 'together':
    case 'groq':
    case 'azure-openai':
    case 'openrouter':
    case 'lmstudio':
    case 'mimo':
      env.CLAUDE_CODE_USE_OPENAI = '1'
      setEnvKey(env, 'OPENAI_BASE_URL', normalizedBaseUrl)
      setEnvKey(env, 'OPENAI_API_KEY', normalizedProfile.apiKey)
      // Keep the runtime model in sync with the selected provider too.
      setEnvKey(env, 'ANTHROPIC_MODEL', normalizedProfile.model)
      setEnvKey(env, 'OPENAI_MODEL', normalizedProfile.model)
      // Same reason as the kimi/minimax pins above: without these, tier-alias
      // and subagent lookups fall back to claude-* ids the endpoint does not
      // serve, and every small-model call (permission precheck, titles,
      // summaries) fails closed.
      setEnvKey(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL', normalizedProfile.model)
      setEnvKey(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL', normalizedProfile.model)
      setEnvKey(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL', normalizedProfile.model)
      setEnvKey(env, 'CLAUDE_CODE_SUBAGENT_MODEL', normalizedProfile.model)
      break
  }

  // Independent of protocol: every profile type declares what its endpoint
  // serves the same way. The three records merge type defaults with the
  // profile's own entries — keyed by model, so overriding one entry doesn't
  // drop the others.
  setEnvKey(
    env,
    PROVIDER_MODELS_ENV_KEY,
    serializeProviderList(normalizedProfile.models),
  )
  setEnvKey(
    env,
    PROVIDER_EFFORT_LEVELS_ENV_KEY,
    serializeProviderEffortLevels({
      ...PROVIDER_TYPE_EFFORT_LEVELS[normalizedProfile.type],
      ...normalizedProfile.effortLevels,
    }),
  )
  setEnvKey(
    env,
    PROVIDER_CONTEXT_WINDOWS_ENV_KEY,
    serializeProviderContextWindows({
      ...PROVIDER_TYPE_CONTEXT_WINDOWS[normalizedProfile.type],
      ...normalizedProfile.contextWindows,
    }),
  )
  setEnvKey(
    env,
    PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY,
    serializeProviderMaxOutputTokens({
      ...PROVIDER_TYPE_MAX_OUTPUT_TOKENS[normalizedProfile.type],
      ...normalizedProfile.maxOutputTokens,
    }),
  )

  return env
}

function getNormalizedBaseUrl(profile: ProviderProfile): string | undefined {
  const baseUrl = profile.baseUrl?.trim()
  if (!baseUrl) {
    return undefined
  }

  return baseUrl.replace(/\/+$/, '')
}

export async function setActiveProviderProfile(
  id: string,
): Promise<ProviderProfile | null> {
  return mutateProviderProfiles(profiles => {
    const selected = profiles.find(profile => profile.id === id)
    if (!selected) return { result: null }

    const activeProfile = normalizeProviderProfileCredential({
      ...selected,
      active: true,
    })
    return {
      next: profiles.map(profile =>
        profile.id === id ? activeProfile : { ...profile, active: false },
      ),
      result: activeProfile,
    }
  })
}

/**
 * Stop loading the active profile on the next launch without tearing the
 * current process out from under an in-flight request. The launcher baseline
 * was overwritten when the profile was applied, so it cannot be reconstructed
 * reliably in-process; keep this session stable and clear only persisted state.
 */
export async function deactivateProviderProfilesForNextLaunch(): Promise<boolean> {
  let changed = false
  await withDeactivatedProviderProfiles(async active => {
    if (!active) return
    changed = true
    const persistenceError = persistProviderEnvToUserSettings(
      {},
      undefined,
      PROVIDER_ENV_KEYS,
    )
    if (persistenceError) throw persistenceError
  })
  return changed
}

// Env keys a provider profile application may own. Used for process-env
// cleanup and as the legacy fallback list when no ownership marker exists.
const PROVIDER_ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  ...PROVIDER_CATALOGUE_ENV_KEYS,
] as const

export async function applyActiveProviderProfileEnv(
  options: {
    clearProviderStateWhenInactive?: boolean
    modelToClearWhenInactive?: string
  } = {},
): Promise<ProviderProfile | null> {
  // --bare is intentionally hermetic: normal application leaves caller env and
  // saved profiles untouched. Explicit OAuth cleanup is the exception: it
  // clears stale disk routing while preserving the current process environment.
  const bare = isBareMode()
  if (bare && !options.clearProviderStateWhenInactive) return null

  const profiles = await loadProviderProfiles()
  const active = getActiveProviderProfile(profiles)
  if (active && options.clearProviderStateWhenInactive) {
    throw new Error(
      `Provider profile "${active.name}" became active during OAuth cleanup`,
    )
  }
  const providerEnvKeys = PROVIDER_ENV_KEYS

  if (!active) {
    if (options.clearProviderStateWhenInactive) {
      // Successful Anthropic credential installation replaces a selected
      // third-party provider. Its inherited routing/model values must not keep
      // winning after the profile has been deactivated. This remains opt-in so a
      // clean CI invocation can retain caller-owned credentials.
      if (!bare) {
        for (const key of providerEnvKeys) {
          delete process.env[key]
        }
      }
      const persistenceError = persistProviderEnvToUserSettings(
        {},
        options.modelToClearWhenInactive,
        providerEnvKeys,
      )
      if (persistenceError) throw persistenceError
      return null
    }

    // Strip only vars a previous profile application persisted into user
    // settings (matched by value). Caller-supplied env — e.g. CI's
    // ANTHROPIC_API_KEY — must survive: deleting it unconditionally made
    // `--print` fail under CI=true on machines with no profiles configured.
    const persistedEnv = getSettingsForSource('userSettings')?.env ?? {}
    for (const key of providerEnvKeys) {
      if (
        persistedEnv[key] !== undefined &&
        process.env[key] === persistedEnv[key]
      ) {
        delete process.env[key]
      }
    }
    logProviderSettingsPersistenceFailure(persistProviderEnvToUserSettings({}))
    return null
  }

  for (const key of providerEnvKeys) {
    delete process.env[key]
  }

  const env = buildProviderEnv(active)
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }
  logProviderSettingsPersistenceFailure(persistProviderEnvToUserSettings(env))
  persistProviderApiKeyApprovalToGlobalConfig(env)
  return active
}

/**
 * Re-read the active profile's model catalogue from its endpoint and persist
 * it, so /model offers the whole list instead of the one id chosen at setup.
 *
 * Call this only from user-initiated activation. It is a network round trip:
 * startup paths — `--print` above all, which must not be held open by an
 * in-flight request — apply whatever the profile already stored.
 */
export async function refreshActiveProviderModels(): Promise<void> {
  const active = getActiveProviderProfile(await loadProviderProfiles())
  if (!active?.baseUrl) return

  // Imported lazily: the fast-path entrypoints reach this module for routing
  // and shouldn't pull the discovery client (and axios) into their startup.
  const { discoverProviderModelNames } = await import(
    './model/openaiModelDiscovery.js'
  )
  const models = await discoverProviderModelNames({
    type: active.type,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
  })
  // An endpoint that answers with nothing tells us nothing — keep the list we
  // already had rather than erasing it.
  if (models.length === 0) return

  // Nothing new: skip the profile write and the settings rewrite below.
  const stored = active.models ?? []
  if (
    models.length === stored.length &&
    models.every(model => stored.includes(model))
  ) {
    return
  }

  // Writing by id is safe whoever is active now: it updates this profile's own
  // record.
  await updateProviderProfile(active.id, { models })

  // Re-reading rather than applying `active` closes the window opened by the
  // request above: the user may have switched profiles while it was in flight,
  // and this profile's base URL, credentials and model would otherwise be
  // written over the one now routing the session.
  await applyActiveProviderProfileEnv()
}

// The OAuth transition paths throw on a failed write because they need the
// switch to be all-or-nothing. Routine application must not take the CLI down
// over a malformed settings.json, but a silent drop here means the profile
// quietly stops surviving managed-env refreshes — log instead of swallowing.
function logProviderSettingsPersistenceFailure(error: Error | null): void {
  if (error) {
    logForDebugging(
      `Failed to persist provider env to user settings: ${error.message}`,
      { level: 'error' },
    )
  }
}

export async function restoreActiveProviderProfileAfterFailedTransition(): Promise<void> {
  const active = getActiveProviderProfile(await loadProviderProfiles())
  if (!active) return
  if (!isBareMode()) {
    await applyActiveProviderProfileEnv()
    return
  }
  const persistenceError = persistProviderEnvToUserSettings(
    buildProviderEnv(active),
  )
  if (persistenceError) throw persistenceError
}

// Ownership marker for env keys a profile application wrote into user
// settings. For each key it records the value settings.json held BEFORE the
// profile first overwrote it (null = the key didn't exist). Clearing restores
// that value instead of deleting, so handwritten env.* entries (e.g. a
// corporate proxy's ANTHROPIC_BASE_URL) survive an activate → deactivate
// cycle. Tradeoff: edits made to a profile-owned key while the profile is
// active are replaced by the pre-activation value on deactivate.
type ProviderEnvOwnership = Record<string, string | null>

function providerEnvOwnershipPath(): string {
  return join(getClaudeConfigHomeDir(), 'provider-env-ownership.json')
}

function readProviderEnvOwnership(): ProviderEnvOwnership {
  try {
    const parsed = JSON.parse(readFileSync(providerEnvOwnershipPath(), 'utf8'))
    if (Array.isArray(parsed)) {
      // Legacy marker (key names only) — previous values unrecoverable.
      return Object.fromEntries(
        parsed
          .filter((k): k is string => typeof k === 'string')
          .map(k => [k, null]),
      )
    }
    if (parsed && typeof parsed === 'object') return parsed
    return {}
  } catch {
    return {}
  }
}

function writeProviderEnvOwnership(marker: ProviderEnvOwnership): void {
  try {
    if (Object.keys(marker).length === 0) {
      rmSync(providerEnvOwnershipPath(), { force: true })
    } else {
      writeFileSync(providerEnvOwnershipPath(), JSON.stringify(marker), {
        mode: 0o600,
      })
    }
  } catch (error) {
    logForDebugging(`Failed to persist provider env ownership: ${error}`, {
      level: 'warn',
    })
  }
}

function persistProviderEnvToUserSettings(
  env: Record<string, string>,
  modelToClear?: string,
  // Explicit cleanups (OAuth replacement, profile deactivation) pass the full
  // known provider-key list as a legacy fallback: installs from before the
  // ownership marker existed have no marker, and their stale routing must
  // still be cleared. The silent startup path omits it, so handwritten env.*
  // entries are never touched there.
  legacyClearKeys?: readonly string[],
): Error | null {
  const marker = readProviderEnvOwnership()
  const restored: Record<string, string | undefined> =
    legacyClearKeys && !existsSync(providerEnvOwnershipPath())
      ? Object.fromEntries(legacyClearKeys.map(key => [key, undefined]))
      : Object.fromEntries(
          Object.entries(marker).map(([key, prev]) => [key, prev ?? undefined]),
        )
  const nextEnv: Record<string, string | undefined> = { ...restored, ...env }

  // Capture pre-overwrite values for newly owned keys BEFORE the settings
  // write; keys already in the marker keep their original previous value
  // (a second profile's value must not become the "handwritten" one).
  const priorEnv = getSettingsForSource('userSettings')?.env ?? {}
  const nextMarker: ProviderEnvOwnership = {}
  for (const key of Object.keys(env)) {
    nextMarker[key] =
      key in marker ? marker[key]! : ((priorEnv as Record<string, string>)[key] ?? null)
  }

  // Keep provider activation stable across managed env refreshes by writing
  // the active provider env into user settings.
  const error = updateSettingsForSource('userSettings', current => ({
    env: nextEnv as any,
    ...(modelToClear !== undefined && current.model === modelToClear
      ? { model: undefined }
      : {}),
  })).error
  if (!error) writeProviderEnvOwnership(nextMarker)
  return error
}

function persistProviderApiKeyApprovalToGlobalConfig(env: Record<string, string>): void {
  const apiKey = env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN
  if (!apiKey) return

  const normalizedApiKey = normalizeApiKeyForConfig(apiKey)
  try {
    saveGlobalConfig(current => {
      const approved = current.customApiKeyResponses?.approved ?? []
      const rejected = current.customApiKeyResponses?.rejected ?? []
      if (approved.includes(normalizedApiKey) && !rejected.includes(normalizedApiKey)) {
        return current
      }

      return {
        ...current,
        customApiKeyResponses: {
          ...current.customApiKeyResponses,
          approved: [
            ...approved.filter(key => key !== normalizedApiKey),
            normalizedApiKey,
          ],
          rejected: rejected.filter(key => key !== normalizedApiKey),
        },
      }
    })
  } catch {
    // If global config is not writable yet, keep the active provider env
    // in process.env and let the next config refresh persist approval.
  }
}
