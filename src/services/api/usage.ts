// @ts-nocheck
import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { getAuthHeaders } from '../../utils/http.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { isOAuthTokenExpired } from '../oauth/client.js'

export type RateLimit = {
  utilization: number | null // a percentage from 0 to 100
  resets_at: string | null // ISO 8601 timestamp
}

export type ExtraUsage = {
  is_enabled: boolean
  monthly_limit: number | null
  used_credits: number | null
  utilization: number | null
}

export type Utilization = {
  five_hour?: RateLimit | null
  seven_day?: RateLimit | null
  seven_day_oauth_apps?: RateLimit | null
  seven_day_opus?: RateLimit | null
  seven_day_sonnet?: RateLimit | null
  extra_usage?: ExtraUsage | null
}

let cachedUsage: { value: Utilization | null; expiresAt: number; token: string } | undefined
let pendingUsage: { token: string; promise: Promise<Utilization | null> } | undefined

export async function fetchCachedUtilization(): Promise<Utilization | null> {
  const token = getClaudeAIOAuthTokens()?.accessToken
  if (!isClaudeAISubscriber()) return null
  if (!token || !hasProfileScope()) throw new Error('Plan usage requires account sign-in with profile access')
  if (isOAuthTokenExpired(getClaudeAIOAuthTokens()?.expiresAt)) throw new Error('Account sign-in has expired')
  if (cachedUsage?.token === token && cachedUsage.expiresAt > Date.now()) return cachedUsage.value
  if (pendingUsage?.token === token) return pendingUsage.promise
  const promise = fetchUtilization().then(value => {
    cachedUsage = { value, expiresAt: Date.now() + 60_000, token }
    return value
  }).finally(() => {
    if (pendingUsage?.promise === promise) pendingUsage = undefined
  })
  pendingUsage = { token, promise }
  return promise
}

export async function fetchUtilization(): Promise<Utilization | null> {
  if (!isClaudeAISubscriber() || !hasProfileScope()) {
    return {}
  }

  // Skip API call if OAuth token is expired to avoid 401 errors
  const tokens = getClaudeAIOAuthTokens()
  if (tokens && isOAuthTokenExpired(tokens.expiresAt)) {
    return null
  }

  const authResult = getAuthHeaders()
  if (authResult.error) {
    throw new Error(`Auth error: ${authResult.error}`)
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...authResult.headers,
  }

  const url = `${getOauthConfig().BASE_API_URL}/api/oauth/usage`

  const response = await axios.get<Utilization>(url, {
    headers,
    timeout: 5000, // 5 second timeout
  })

  return response.data
}
