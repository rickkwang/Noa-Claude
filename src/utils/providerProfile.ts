import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { saveGlobalConfig } from './config.js'
import { normalizeApiKeyForConfig } from './authPortable.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { updateSettingsForSource } from './settings/settings.js'

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

export function getProviderProfilesPath(): string {
  return PROVIDER_PROFILES_PATH
}

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
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(PROVIDER_PROFILES_PATH, JSON.stringify(profiles, null, 2), 'utf-8')
}

export async function addProviderProfile(
  profile: Omit<ProviderProfile, 'id'>,
): Promise<ProviderProfile> {
  const profiles = await loadProviderProfiles()
  const newProfile: ProviderProfile = {
    ...normalizeProviderProfileCredential(profile),
    id: randomUUID(),
  }
  profiles.push(newProfile)
  await saveProviderProfiles(profiles)
  return newProfile
}

export async function updateProviderProfile(
  id: string,
  updates: Partial<Omit<ProviderProfile, 'id'>>,
): Promise<ProviderProfile | null> {
  const profiles = await loadProviderProfiles()
  const index = profiles.findIndex(p => p.id === id)
  if (index === -1) {
    return null
  }
  const existing = profiles[index]
  if (!existing) {
    return null
  }
  const updated = normalizeProviderProfileCredential({ ...existing, ...updates })
  profiles[index] = updated
  await saveProviderProfiles(profiles)
  return updated
}

export async function deleteProviderProfile(
  id: string,
): Promise<boolean> {
  const profiles = await loadProviderProfiles()
  const index = profiles.findIndex(p => p.id === id)
  if (index === -1) {
    return false
  }
  profiles.splice(index, 1)
  await saveProviderProfiles(profiles)
  return true
}

export async function getProviderProfileById(
  id: string,
): Promise<ProviderProfile | null> {
  const profiles = await loadProviderProfiles()
  return profiles.find(p => p.id === id) || null
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

export async function deactivateAllProviderProfiles(): Promise<void> {
  const profiles = await loadProviderProfiles()
  if (profiles.some(p => p.active)) {
    await saveProviderProfiles(profiles.map(p => ({ ...p, active: false })))
  }
}

export async function setActiveProviderProfile(
  id: string,
): Promise<ProviderProfile | null> {
  const profiles = await loadProviderProfiles()
  const selected = profiles.find(profile => profile.id === id)
  if (!selected) return null

  const activeProfile = normalizeProviderProfileCredential({
    ...selected,
    active: true,
  })
  const nextProfiles = profiles.map(profile =>
    profile.id === id ? activeProfile : { ...profile, active: false },
  )
  await saveProviderProfiles(nextProfiles)
  return activeProfile
}

export async function applyActiveProviderProfileEnv(): Promise<ProviderProfile | null> {
  const profiles = await loadProviderProfiles()
  const active = getActiveProviderProfile(profiles)
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

  for (const key of providerEnvKeys) {
    delete process.env[key]
  }

  if (!active) {
    persistProviderEnvToUserSettings({})
    return null
  }

  const env = buildProviderEnv(active)
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }
  persistProviderEnvToUserSettings(env)
  persistProviderApiKeyApprovalToGlobalConfig(env)
  return active
}

function persistProviderEnvToUserSettings(env: Record<string, string>): void {
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
  updateSettingsForSource('userSettings', {
    env: nextEnv as any,
  })
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
