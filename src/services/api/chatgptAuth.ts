import { createHash, randomBytes, randomUUID } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { createServer } from 'http'
import { dirname, join } from 'path'
import { openBrowser } from '../../utils/browser.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import * as lockfile from '../../utils/lockfile.js'

// "Sign in with ChatGPT" for open-source / locally hosted apps: a ChatGPT plan
// pays for Responses API calls on api.openai.com.
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in
const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
const RESOURCE = 'https://api.openai.com/v1'
const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'
// Must be 127.0.0.1, not localhost, and identical in authorize and exchange.
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`
const REFRESH_MARGIN_MS = 3 * 60 * 1000
const SIGN_IN_HINT = 'Run /login and choose ChatGPT to sign in again.'

type ChatGPTAuth = {
  // Stable per installation; OpenAI binds usage settings to it.
  hostId: string
  clientId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

function authPath(): string {
  return join(getClaudeConfigHomeDir(), 'chatgpt-auth.json')
}

async function readAuth(): Promise<ChatGPTAuth | null> {
  try {
    return JSON.parse(await readFile(authPath(), 'utf8')) as ChatGPTAuth
  } catch {
    return null
  }
}

async function writeAuth(auth: ChatGPTAuth): Promise<void> {
  const path = authPath()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(auth, null, 2), { mode: 0o600 })
  await rename(tmp, path)
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

async function requestToken(
  params: Record<string, string>,
): Promise<{ tokens: Pick<ChatGPTAuth, 'accessToken' | 'refreshToken' | 'expiresAt'>; idToken?: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const code = typeof data.error === 'string' ? `: ${data.error}` : ''
    throw new Error(`ChatGPT token request failed (${response.status})${code}`)
  }
  if (
    typeof data.access_token !== 'string' ||
    typeof data.refresh_token !== 'string' ||
    typeof data.expires_in !== 'number'
  ) {
    throw new Error('ChatGPT token response is missing tokens')
  }
  // A valid sign-in without this scope grants identity only, not plan usage.
  if (!String(data.scope ?? '').split(/\s+/).includes(DIRECT_SCOPE)) {
    throw new Error(`ChatGPT did not grant ${DIRECT_SCOPE}; plan usage is unavailable for this account`)
  }
  return {
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    },
    idToken: typeof data.id_token === 'string' ? data.id_token : undefined,
  }
}

function idTokenNonce(idToken: string | undefined): unknown {
  try {
    const payload = idToken?.split('.')[1]
    return payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).nonce : undefined
  } catch {
    return undefined
  }
}

function waitForCallback(
  state: string,
  authorizeUrl: string,
  signal: AbortSignal | undefined,
): Promise<{ code: string; clientId: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '', REDIRECT_URI)
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end('OAuth state mismatch')
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const clientId = url.searchParams.get('client_id')
      const ok = !error && code && clientId
      res
        .writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(ok ? 'ChatGPT connected. You can close this window.' : 'ChatGPT was not connected.')
      finish()
      if (ok) resolve({ code, clientId })
      else reject(new Error(error ? `ChatGPT sign-in failed: ${error}` : 'ChatGPT sign-in returned no client ID'))
    })
    const onAbort = () => {
      finish()
      reject(new Error('ChatGPT sign-in cancelled'))
    }
    function finish() {
      signal?.removeEventListener('abort', onAbort)
      server.close()
      // Browsers keep spare connections open; a later sign-in could receive
      // its callback on one of them and fail the state check.
      server.closeAllConnections()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${CALLBACK_PORT} is in use (another sign-in or the Codex CLI). Close it and try again.`)
          : err,
      )
    })
    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      void openBrowser(authorizeUrl)
    })
  })
}

/** Runs the browser sign-in and stores the resulting tokens. */
export async function loginWithChatGPT(options: {
  onAuthUrl: (url: string) => void
  signal?: AbortSignal
}): Promise<void> {
  const existing = await readAuth()
  const hostId = existing?.hostId ?? `urn:uuid:${randomUUID()}`
  const verifier = randomToken()
  const state = randomToken()
  const nonce = randomToken()
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    // Placeholder that registers a client; the issued id comes back in the callback.
    client_id: 'dynamic_agent_client',
    agent_name_hint: 'Noa',
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString()
  options.onAuthUrl(url.toString())

  const { code, clientId } = await waitForCallback(state, url.toString(), options.signal)
  const { tokens, idToken } = await requestToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
  })
  if (idTokenNonce(idToken) !== nonce) {
    throw new Error('ChatGPT sign-in returned an ID token for a different request')
  }
  await writeAuth({ hostId, clientId, ...tokens })
}

let inFlightRefresh: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  // Refresh tokens rotate, so concurrent Noa processes must not both spend the
  // same one: serialize on the file and re-check after taking the lock.
  const release = await lockfile.lock(authPath(), {
    realpath: false,
    retries: { retries: 30, minTimeout: 50, maxTimeout: 500 },
  })
  try {
    const auth = await readAuth()
    if (!auth?.clientId || !auth.refreshToken) {
      throw new Error(`Not signed in to ChatGPT. ${SIGN_IN_HINT}`)
    }
    if (auth.accessToken && (auth.expiresAt ?? 0) - REFRESH_MARGIN_MS > Date.now()) {
      return auth.accessToken
    }
    const { tokens } = await requestToken({
      grant_type: 'refresh_token',
      client_id: auth.clientId,
      refresh_token: auth.refreshToken,
      resource: RESOURCE,
    }).catch(err => {
      throw new Error(`${err instanceof Error ? err.message : String(err)}. ${SIGN_IN_HINT}`)
    })
    await writeAuth({ ...auth, ...tokens })
    return tokens.accessToken!
  } finally {
    await release()
  }
}

/** A valid access token for api.openai.com, refreshed when close to expiry. */
export async function getChatGPTAccessToken(): Promise<string> {
  const auth = await readAuth()
  if (!auth?.accessToken) {
    throw new Error(`Not signed in to ChatGPT. ${SIGN_IN_HINT}`)
  }
  if ((auth.expiresAt ?? 0) - REFRESH_MARGIN_MS > Date.now()) {
    return auth.accessToken
  }
  inFlightRefresh ??= refreshAccessToken().finally(() => {
    inFlightRefresh = null
  })
  return inFlightRefresh
}

/** Forces the next getChatGPTAccessToken() to refresh after the API rejected `token`. */
export async function expireChatGPTAccessToken(token: string): Promise<void> {
  const auth = await readAuth()
  // Skip if another request already replaced the rejected token.
  if (auth?.accessToken === token) await writeAuth({ ...auth, expiresAt: 0 })
}
