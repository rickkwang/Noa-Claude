// @ts-nocheck
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
  | 'minimax'
  | 'glm'
  | 'together'
  | 'groq'
  | 'azure-openai'
  | 'openrouter'
  | 'lmstudio'

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
    ...profile,
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
  profiles[index] = { ...profiles[index], ...updates }
  await saveProviderProfiles(profiles)
  return profiles[index]
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
  minimax: 'MiniMax',
  glm: 'Z.AI GLM',
  together: 'Together AI',
  groq: 'Groq',
  'azure-openai': 'Azure OpenAI',
  openrouter: 'OpenRouter',
  lmstudio: 'LM Studio',
}

export const PROVIDER_TYPE_DEFAULTS: Record<ProviderType, { baseUrl?: string; model?: string }> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro',
  },
  github: {
    baseUrl: 'https://models.inference.ai.dev/api',
    model: 'gpt-4o',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
  },
  codex: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  kimi: {
    baseUrl: 'https://api.kimi.com/coding',
    model: 'kimi-for-coding',
  },
  minimax: {
    baseUrl: 'https://api.minimaxi.com/anthropic',
    model: 'MiniMax-M2.5',
  },
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.1',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  'azure-openai': {
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    model: 'YOUR-DEPLOYMENT',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
  },
}

function setEnvKey(target: Record<string, string>, key: string, value?: string): void {
  if (!value) return
  target[key] = value
}

export function getActiveProviderProfile(
  profiles: ProviderProfile[],
): ProviderProfile | null {
  return profiles.find(profile => profile.active) ?? null
}

export function buildProviderEnv(profile: ProviderProfile): Record<string, string> {
  const env: Record<string, string> = {}
  const normalizedBaseUrl = getNormalizedBaseUrl(profile)

  switch (profile.type) {
    case 'anthropic':
      setEnvKey(env, 'ANTHROPIC_BASE_URL', normalizedBaseUrl)
      setEnvKey(env, 'ANTHROPIC_API_KEY', profile.apiKey)
      setEnvKey(env, 'ANTHROPIC_MODEL', profile.model)
      break
    case 'minimax':
    case 'kimi':
      // Third-party Anthropic-compatible providers typically expect Bearer
      // authentication (Authorization header) rather than x-api-key.
      setEnvKey(env, 'ANTHROPIC_BASE_URL', normalizedBaseUrl)
      setEnvKey(env, 'ANTHROPIC_AUTH_TOKEN', profile.apiKey)
      setEnvKey(env, 'ANTHROPIC_API_KEY', profile.apiKey)
      setEnvKey(env, 'ANTHROPIC_MODEL', profile.model)
      if (profile.type === 'kimi') {
        setEnvKey(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL', profile.model)
        setEnvKey(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL', profile.model)
        setEnvKey(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL', profile.model)
        setEnvKey(env, 'CLAUDE_CODE_SUBAGENT_MODEL', profile.model)
      }
      break
    case 'openai':
    case 'gemini':
    case 'github':
    case 'mistral':
    case 'ollama':
    case 'codex':
    case 'deepseek':
    case 'glm':
    case 'together':
    case 'groq':
    case 'azure-openai':
    case 'openrouter':
    case 'lmstudio':
      env.CLAUDE_CODE_USE_OPENAI = '1'
      setEnvKey(env, 'OPENAI_BASE_URL', normalizedBaseUrl)
      setEnvKey(env, 'OPENAI_API_KEY', profile.apiKey)
      // Keep the runtime model in sync with the selected provider too.
      setEnvKey(env, 'ANTHROPIC_MODEL', profile.model)
      setEnvKey(env, 'OPENAI_MODEL', profile.model)
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
  const profiles = await loadProviderProfiles()
  let activeProfile: ProviderProfile | null = null
  const nextProfiles = profiles.map(profile => {
    const isActive = profile.id === id
    if (isActive) activeProfile = { ...profile, active: true }
    return { ...profile, active: isActive }
  })
  if (!activeProfile) return null
  await saveProviderProfiles(nextProfiles)
  return activeProfile
}

export async function applyActiveProviderProfileEnv(): Promise<ProviderProfile | null> {
  const profiles = await loadProviderProfiles()
  const active = getActiveProviderProfile(profiles)
  const providerEnvKeys = [
    'CLAUDE_CODE_USE_OPENAI',
    'OPENAI_BASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'ENABLE_TOOL_SEARCH',
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
    CLAUDE_CODE_USE_OPENAI: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
    ANTHROPIC_BASE_URL: undefined,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    ANTHROPIC_MODEL: undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined,
    CLAUDE_CODE_SUBAGENT_MODEL: undefined,
    ENABLE_TOOL_SEARCH: undefined,
    ...env,
  }

  // Keep provider activation stable across managed env refreshes by writing
  // the active provider env into user settings.
  updateSettingsForSource('userSettings', {
    env: nextEnv as any,
  })
}

function persistProviderApiKeyApprovalToGlobalConfig(env: Record<string, string>): void {
  const apiKey = env.ANTHROPIC_API_KEY
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
