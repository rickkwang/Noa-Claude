// Web search paths that don't go through Anthropic's server-side web_search
// tool: a search API the user configured, and Gemini's native Google Search
// grounding (the OpenAI-compatible Gemini endpoint rejects that tool).

import {
  getGeminiAuthMissingCredentialHint,
  resolveGeminiCredential,
} from '../../utils/geminiAuth.js'

export type SearchHit = { title: string; url: string; snippet?: string }

export type SearchBackendConfig =
  | { backend: 'searxng'; url: string }
  | { backend: 'brave' | 'tavily'; apiKey: string }

const MAX_HITS = 10
const REQUEST_TIMEOUT_MS = 30_000

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'
const TAVILY_URL = 'https://api.tavily.com/search'

/**
 * The search API named by NOA_CLAUDE_WEB_SEARCH_BACKEND, or null when none is
 * configured or its required URL (SearXNG) or key (Brave, Tavily) is missing. Searches then go to that
 * service on every provider, so the user opts into sending queries there.
 */
export function getConfiguredSearchBackend(
  env: NodeJS.ProcessEnv = process.env,
): SearchBackendConfig | null {
  const backend = env.NOA_CLAUDE_WEB_SEARCH_BACKEND?.trim().toLowerCase()
  const url = env.NOA_CLAUDE_WEB_SEARCH_URL?.trim()
  const apiKey = env.NOA_CLAUDE_WEB_SEARCH_API_KEY?.trim()
  if (backend === 'searxng') {
    return url ? { backend, url } : null
  }
  if (backend === 'brave' || backend === 'tavily') {
    return apiKey ? { backend, apiKey } : null
  }
  return null
}

function hostMatches(url: string, domains: string[]): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return domains.some(domain => {
    const d = domain.trim().toLowerCase().replace(/^\*?\./, '')
    return host === d || host.endsWith('.' + d)
  })
}

/**
 * Applies allowed/blocked domain lists to hits. Backends without native
 * domain filtering only get these as query operators, which they may ignore.
 */
export function filterHitsByDomain(
  hits: SearchHit[],
  allowed?: string[],
  blocked?: string[],
): SearchHit[] {
  return hits.filter(
    hit =>
      (!allowed?.length || hostMatches(hit.url, allowed)) &&
      (!blocked?.length || !hostMatches(hit.url, blocked)),
  )
}

function withSiteOperators(
  query: string,
  allowed?: string[],
  blocked?: string[],
): string {
  const parts = [query]
  if (allowed?.length) {
    const sites = allowed.map(d => `site:${d}`)
    parts.push(sites.length === 1 ? sites[0]! : `(${sites.join(' OR ')})`)
  }
  for (const d of blocked ?? []) parts.push(`-site:${d}`)
  return parts.join(' ')
}

async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  label: string,
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  })
  if (!response.ok) {
    // The body may echo the key or account details; report the status only.
    throw new Error(`${label} search failed with HTTP ${response.status}`)
  }
  return response.json()
}

export async function searchWithBackend(
  config: SearchBackendConfig,
  input: { query: string; allowed_domains?: string[]; blocked_domains?: string[] },
  signal: AbortSignal,
): Promise<SearchHit[]> {
  const { query, allowed_domains: allowed, blocked_domains: blocked } = input
  let hits: SearchHit[]
  switch (config.backend) {
    case 'searxng': {
      // Accept the instance root or its /search endpoint.
      const root = config.url.replace(/\/+$/, '').replace(/\/search$/, '')
      const url = new URL(root + '/search')
      url.searchParams.set('q', withSiteOperators(query, allowed, blocked))
      url.searchParams.set('format', 'json')
      const data = await fetchJson(url.toString(), {}, signal, 'SearXNG')
      hits = (data?.results ?? []).map((r: any) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.content,
      }))
      break
    }
    case 'brave': {
      const url = new URL(BRAVE_URL)
      url.searchParams.set('q', withSiteOperators(query, allowed, blocked))
      url.searchParams.set('count', String(MAX_HITS))
      const data = await fetchJson(
        url.toString(),
        {
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': config.apiKey,
          },
        },
        signal,
        'Brave',
      )
      hits = (data?.web?.results ?? []).map((r: any) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.description,
      }))
      break
    }
    case 'tavily': {
      const data = await fetchJson(
        TAVILY_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            query,
            max_results: MAX_HITS,
            ...(allowed?.length && { include_domains: allowed }),
            ...(blocked?.length && { exclude_domains: blocked }),
          }),
        },
        signal,
        'Tavily',
      )
      hits = (data?.results ?? []).map((r: any) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.content,
      }))
      break
    }
  }
  return filterHitsByDomain(
    hits.filter(hit => typeof hit.url === 'string' && hit.url),
    allowed,
    blocked,
  ).slice(0, MAX_HITS)
}

function geminiNativeBaseUrl(openaiBaseUrl: string): string {
  // .../v1beta/openai → .../v1beta
  return openaiBaseUrl.replace(/\/+$/, '').replace(/\/openai$/, '')
}

/**
 * One generateContent call with the google_search tool. Returns the grounded
 * answer text and the web sources it cites.
 */
export async function searchWithGemini(
  input: { query: string; allowed_domains?: string[]; blocked_domains?: string[] },
  model: string,
  signal: AbortSignal,
): Promise<{ text: string; hits: SearchHit[] }> {
  let credential = await resolveGeminiCredential()
  if (credential.kind === 'none' && process.env.OPENAI_API_KEY) {
    credential = { kind: 'api-key', credential: process.env.OPENAI_API_KEY }
  }
  if (credential.kind === 'none') {
    throw new Error(getGeminiAuthMissingCredentialHint())
  }
  const { query, allowed_domains: allowed, blocked_domains: blocked } = input
  const base = geminiNativeBaseUrl(
    process.env.OPENAI_BASE_URL ||
      'https://generativelanguage.googleapis.com/v1beta/openai',
  )
  const modelPath = model.startsWith('models/') ? model : `models/${model}`
  const data = await fetchJson(
    `${base}/${modelPath}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(credential.kind === 'api-key'
          ? { 'x-goog-api-key': credential.credential }
          : { Authorization: `Bearer ${credential.credential}` }),
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Search the web for: ${withSiteOperators(query, allowed, blocked)}`,
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
      }),
    },
    signal,
    'Gemini',
  )
  const candidate = data?.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
  const hits: SearchHit[] = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .map((c: any) => c?.web)
    .filter((w: any) => w?.uri)
    .map((w: any) => ({ title: w.title ?? w.uri, url: w.uri }))
  // Grounding URIs are Google redirect links whose title is the source
  // domain, so the domain lists are matched against the title.
  const titleHas = (hit: SearchHit, domains: string[]) =>
    domains.some(d => hit.title.toLowerCase().includes(d.toLowerCase()))
  const visible = hits.filter(
    hit =>
      (!allowed?.length || titleHas(hit, allowed)) &&
      (!blocked?.length || !titleHas(hit, blocked)),
  )
  return { text, hits: visible }
}
