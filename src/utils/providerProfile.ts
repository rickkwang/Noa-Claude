import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { saveGlobalConfig } from './config.js'
import { normalizeApiKeyForConfig } from './authPortable.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isBareMode } from './envUtils.js'
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
}

const PROVIDER_PROFILES_PATH = join(getClaudeConfigHomeDir(), 'provider-profiles.json')
const INVALID_CREDENTIAL_CHARS = /[\s\u0000-\u001f\u007f\u4e00-\u9fff]/

export async function loadProviderProfiles(): Promise<ProviderProfile[]> {
  try {
    const content = await readFile(PROVIDER_PROFILES_PATH, 'utf-8')
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
    await writeFile(PROVIDER_PROFILES_PATH, '[]', {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error
  }
}

async function mutateProviderProfiles<T>(
  mutate: (
    profiles: ProviderProfile[],
  ) => { next?: ProviderProfile[]; result: T },
): Promise<T> {
  await ensureProviderProfilesFile()
  const release = await lockfile.lock(PROVIDER_PROFILES_PATH, {
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
    PROVIDER_PROFILES_PATH,
    JSON.stringify(profiles, null, 2),
    'utf8',
  )
}

export async function withDeactivatedProviderProfiles<T>(
  operation: (deactivated: ProviderProfile | null) => Promise<T>,
  rollback?: (deactivated: ProviderProfile | null) => Promise<void>,
): Promise<T> {
  await ensureProviderProfilesFile()
  const release = await lockfile.lock(PROVIDER_PROFILES_PATH, {
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

export async function updateProviderProfile(
  id: string,
  updates: Partial<Omit<ProviderProfile, 'id'>>,
): Promise<ProviderProfile | null> {
  return mutateProviderProfiles(profiles => {
    const index = profiles.findIndex(p => p.id === id)
    const existing = profiles[index]
    if (index === -1 || !existing) return { result: null }
    const updated = normalizeProviderProfileCredential({ ...existing, ...updates })
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
      if (normalizedProfile.type === 'kimi') {
        setEnvKey(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL', normalizedProfile.model)
        setEnvKey(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL', normalizedProfile.model)
        setEnvKey(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL', normalizedProfile.model)
        setEnvKey(env, 'CLAUDE_CODE_SUBAGENT_MODEL', normalizedProfile.model)
      }
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
      break
  }

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
  const providerEnvKeys = [
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
  ] as const

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

function persistProviderEnvToUserSettings(
  env: Record<string, string>,
  modelToClear?: string,
): Error | null {
  const nextEnv: Record<string, string | undefined> = {
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_VERTEX: undefined,
    CLAUDE_CODE_USE_FOUNDRY: undefined,
    CLAUDE_CODE_USE_OPENAI: undefined,
    ANTHROPIC_BEDROCK_BASE_URL: undefined,
    ANTHROPIC_VERTEX_BASE_URL: undefined,
    ANTHROPIC_FOUNDRY_BASE_URL: undefined,
    ANTHROPIC_FOUNDRY_RESOURCE: undefined,
    ANTHROPIC_VERTEX_PROJECT_ID: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
    AWS_BEARER_TOKEN_BEDROCK: undefined,
    ANTHROPIC_FOUNDRY_API_KEY: undefined,
    CLAUDE_CODE_SKIP_BEDROCK_AUTH: undefined,
    CLAUDE_CODE_SKIP_VERTEX_AUTH: undefined,
    CLAUDE_CODE_SKIP_FOUNDRY_AUTH: undefined,
    ANTHROPIC_BASE_URL: undefined,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    ANTHROPIC_MODEL: undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined,
    CLAUDE_CODE_SUBAGENT_MODEL: undefined,
    ...env,
  }

  // Keep provider activation stable across managed env refreshes by writing
  // the active provider env into user settings.
  return updateSettingsForSource('userSettings', current => ({
    env: nextEnv as any,
    ...(modelToClear !== undefined && current.model === modelToClear
      ? { model: undefined }
      : {}),
  })).error
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
