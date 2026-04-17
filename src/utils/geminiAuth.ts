// @ts-nocheck
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { memoizeWithTTLAsync } from './memoize.js'

const GEMINI_ADC_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const GEMINI_ADC_CACHE_TTL_MS = 5 * 60 * 1000

export type GeminiAuthMode = 'api-key' | 'access-token' | 'adc'

type GoogleAccessTokenResult =
  | string
  | null
  | undefined
  | {
      token?: string | null
    }

type GoogleAuthClientLike = {
  getAccessToken(): Promise<GoogleAccessTokenResult> | GoogleAccessTokenResult
}

type GoogleAuthLike = {
  getClient(): Promise<GoogleAuthClientLike>
}

export type GeminiResolvedCredential =
  | { kind: 'api-key'; credential: string }
  | { kind: 'access-token' | 'adc'; credential: string }
  | { kind: 'none' }

function sanitize(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isMode(
  mode: GeminiAuthMode | undefined,
  expected: GeminiAuthMode,
): boolean {
  return mode === expected
}

export function getGeminiAuthMode(
  env: NodeJS.ProcessEnv = process.env,
): GeminiAuthMode | undefined {
  const normalized = sanitize(env.GEMINI_AUTH_MODE)?.toLowerCase()
  if (
    normalized === 'api-key' ||
    normalized === 'access-token' ||
    normalized === 'adc'
  ) {
    return normalized
  }
  return undefined
}

function getGeminiAdcCredentialPaths(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const explicit = sanitize(env.GOOGLE_APPLICATION_CREDENTIALS)
  const paths = new Set<string>()
  if (explicit) paths.add(explicit)
  paths.add(join(homedir(), '.config', 'gcloud', 'application_default_credentials.json'))
  const appData = sanitize(env.APPDATA)
  if (appData) {
    paths.add(join(appData, 'gcloud', 'application_default_credentials.json'))
  }
  return [...paths]
}

export function mayHaveGeminiAdcCredentials(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getGeminiAdcCredentialPaths(env).some(path => existsSync(path))
}

function normalizeAccessToken(value: GoogleAccessTokenResult): string | undefined {
  if (typeof value === 'string') return sanitize(value)
  return sanitize(value?.token)
}

async function createDefaultGoogleAuth(): Promise<GoogleAuthLike> {
  const { GoogleAuth } = await import('google-auth-library')
  return new GoogleAuth({
    scopes: [GEMINI_ADC_SCOPE],
  }) as GoogleAuthLike
}

async function resolveGeminiAdcCredentialUncached(
  env: NodeJS.ProcessEnv,
): Promise<GeminiResolvedCredential> {
  if (!mayHaveGeminiAdcCredentials(env)) {
    return { kind: 'none' }
  }
  try {
    const auth = await createDefaultGoogleAuth()
    const client = await auth.getClient()
    const accessToken = normalizeAccessToken(await client.getAccessToken())
    if (!accessToken) return { kind: 'none' }
    return { kind: 'adc', credential: accessToken }
  } catch {
    return { kind: 'none' }
  }
}

const resolveDefaultGeminiAdcCredential = memoizeWithTTLAsync(
  async (
    googleApplicationCredentials: string | undefined,
    appData: string | undefined,
    home: string,
  ) =>
    resolveGeminiAdcCredentialUncached({
      GOOGLE_APPLICATION_CREDENTIALS: googleApplicationCredentials,
      APPDATA: appData,
      HOME: home,
    } as NodeJS.ProcessEnv),
  GEMINI_ADC_CACHE_TTL_MS,
)

export async function resolveGeminiCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GeminiResolvedCredential> {
  const authMode = getGeminiAuthMode(env)
  const apiKey =
    isMode(authMode, 'access-token') || isMode(authMode, 'adc')
      ? undefined
      : sanitize(env.GEMINI_API_KEY) ?? sanitize(env.GOOGLE_API_KEY)
  if (apiKey && (authMode === undefined || isMode(authMode, 'api-key'))) {
    return { kind: 'api-key', credential: apiKey }
  }

  const accessToken =
    isMode(authMode, 'api-key') || isMode(authMode, 'adc')
      ? undefined
      : sanitize(env.GEMINI_ACCESS_TOKEN)
  if (
    accessToken &&
    (authMode === undefined || isMode(authMode, 'access-token'))
  ) {
    return { kind: 'access-token', credential: accessToken }
  }

  if (isMode(authMode, 'api-key') || isMode(authMode, 'access-token')) {
    return { kind: 'none' }
  }

  return resolveDefaultGeminiAdcCredential(
    sanitize(env.GOOGLE_APPLICATION_CREDENTIALS),
    sanitize(env.APPDATA),
    homedir(),
  )
}

export function getGeminiAuthMissingCredentialHint(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const mode = getGeminiAuthMode(env)
  if (mode === 'access-token') {
    return 'Gemini auth mode is access-token, but GEMINI_ACCESS_TOKEN is missing.'
  }
  if (mode === 'adc') {
    return 'Gemini auth mode is adc, but no ADC credentials were found. Run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS.'
  }
  return 'Gemini credentials are missing. Set GEMINI_API_KEY/GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or configure ADC.'
}
