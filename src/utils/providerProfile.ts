// @ts-nocheck
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getClaudeConfigHomeDir } from './envUtils.js'

export type ProviderType =
  | 'openai'
  | 'gemini'
  | 'github'
  | 'mistral'
  | 'ollama'
  | 'codex'
  | 'deepseek'

export interface ProviderProfile {
  id: string
  name: string
  type: ProviderType
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
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  github: 'GitHub Models',
  mistral: 'Mistral',
  ollama: 'Ollama',
  codex: 'OpenAI Codex',
  deepseek: 'DeepSeek',
}

export const PROVIDER_TYPE_DEFAULTS: Record<ProviderType, { baseUrl?: string; model?: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash',
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
    baseUrl: 'http://localhost:11434',
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
}
