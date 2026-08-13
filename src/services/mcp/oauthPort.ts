// @ts-nocheck
/**
 * OAuth redirect port helpers — extracted from auth.ts to break the
 * auth.ts ↔ xaaIdpLogin.ts circular dependency.
 */
import { createServer } from 'http'
import { logMCPDebug } from '../../utils/log.js'
import { getPlatform } from '../../utils/platform.js'

// Windows dynamic port range 49152-65535 is reserved
const REDIRECT_PORT_RANGE =
  getPlatform() === 'windows'
    ? { min: 39152, max: 49151 }
    : { min: 49152, max: 65535 }
const REDIRECT_PORT_FALLBACK = 3118

/**
 * Loopback host used to build OAuth redirect URIs. Matches upstream.
 *
 * There is a real argument for the IP literal: RFC 8252 §8.3 says "the use of
 * localhost is NOT RECOMMENDED", and §7.3 obliges an authorization server to
 * allow any port only "for loopback IP redirect URIs" — a registration of
 * `http://localhost/callback` carries no such obligation, so a strict server is
 * within spec to reject the ephemeral port we actually listen on.
 *
 * Upstream ran that experiment and reverted it. 2.1.229 shipped
 * `http://127.0.0.1:${port}/callback` ("Fixed MCP OAuth with strict
 * authorization servers"); 2.1.231 put it back to `localhost` ("Fixed MCP OAuth
 * sign-in failing with a redirect URI mismatch for servers that use a
 * pre-registered OAuth client, such as Slack"). Pre-registered clients are
 * exact-match and cannot re-register the way a DCR client can, so for them a
 * host swap is unrecoverable — and that cohort turned out to be the larger one.
 *
 * So: keep `localhost` as the default, and let the strict-AS cohort opt in via
 * MCP_OAUTH_REDIRECT_HOST instead of trading one breakage for the other. Do not
 * "fix" this to 127.0.0.1 without new evidence — that is the reverted change.
 *
 * Note the callback server binds `127.0.0.1` either way (auth.ts,
 * xaaIdpLogin.ts); only the advertised host is in question here.
 */
const REDIRECT_HOST = 'localhost'

/**
 * Hosts accepted for MCP_OAUTH_REDIRECT_HOST. Deliberately a closed set, for
 * two independent reasons:
 *
 * - The redirect URI is where the authorization server sends the auth code, so
 *   an arbitrary host here would be a code-exfiltration vector.
 * - We may only advertise a host the callback server actually answers on, and
 *   it binds the IPv4 loopback (`server.listen(port, '127.0.0.1')` in auth.ts
 *   and xaaIdpLogin.ts). `[::1]` is therefore *not* offered: nothing listens
 *   there, so it would be a guaranteed connection refused. Adding it would
 *   need the listener to bind both families first — which RFC 8252 §7.3 does
 *   recommend, but that is a separate change.
 */
const ALLOWED_REDIRECT_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * Opt-in override, for authorization servers that reject `http://localhost:`
 * redirect URIs or apply the §7.3 any-port rule only to loopback IP literals.
 * Deviates from upstream, which has no escape hatch for that cohort — it
 * covers them without reintroducing the 2.1.229 default-behaviour regression.
 *
 * Set to `127.0.0.1` for such a server. A DCR client registered under the old
 * host must re-register: clear it with `/mcp` re-auth.
 */
function getRedirectHost(): string {
  const override = process.env.MCP_OAUTH_REDIRECT_HOST
  if (!override) return REDIRECT_HOST
  if (ALLOWED_REDIRECT_HOSTS.has(override)) return override
  logMCPDebug(
    'oauth',
    `Ignoring MCP_OAUTH_REDIRECT_HOST=${override}: the callback server only answers on ${[...ALLOWED_REDIRECT_HOSTS].join(' / ')}`,
  )
  return REDIRECT_HOST
}

/**
 * Builds a loopback redirect URI with the given port and a fixed `/callback`
 * path.
 *
 * RFC 8252 §7.3 (OAuth for Native Apps): loopback redirect URIs match any port
 * as long as the path matches. See REDIRECT_HOST for the host choice.
 */
export function buildRedirectUri(
  port: number = REDIRECT_PORT_FALLBACK,
): string {
  return `http://${getRedirectHost()}:${port}/callback`
}

function getMcpOAuthCallbackPort(): number | undefined {
  const port = parseInt(process.env.MCP_OAUTH_CALLBACK_PORT || '', 10)
  return port > 0 ? port : undefined
}

/**
 * Finds an available port in the specified range for OAuth redirect
 * Uses random selection for better security
 */
export async function findAvailablePort(): Promise<number> {
  // First, try the configured port if specified
  const configuredPort = getMcpOAuthCallbackPort()
  if (configuredPort) {
    return configuredPort
  }

  const { min, max } = REDIRECT_PORT_RANGE
  const range = max - min + 1
  const maxAttempts = Math.min(range, 100) // Don't try forever

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = min + Math.floor(Math.random() * range)

    try {
      await new Promise<void>((resolve, reject) => {
        const testServer = createServer()
        testServer.once('error', reject)
        testServer.listen(port, () => {
          testServer.close(() => resolve())
        })
      })
      return port
    } catch {
      // Port in use, try another random port
      continue
    }
  }

  // If random selection failed, try the fallback port
  try {
    await new Promise<void>((resolve, reject) => {
      const testServer = createServer()
      testServer.once('error', reject)
      testServer.listen(REDIRECT_PORT_FALLBACK, () => {
        testServer.close(() => resolve())
      })
    })
    return REDIRECT_PORT_FALLBACK
  } catch {
    throw new Error(`No available ports for OAuth redirect`)
  }
}
