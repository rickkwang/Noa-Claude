// @ts-nocheck
import { logEvent } from 'src/services/analytics/index.js'
import { openBrowser } from '../../utils/browser.js'
import { AuthCodeListener } from './auth-code-listener.js'
import * as client from './client.js'
import * as crypto from './crypto.js'
import type {
  OAuthProfileResponse,
  OAuthTokenExchangeResponse,
  OAuthTokens,
  RateLimitTier,
  SubscriptionType,
} from './types.js'

const OAUTH_AUTHORIZATION_TIMEOUT_MS = 15 * 60 * 1000

/**
 * OAuth service that handles the OAuth 2.0 authorization code flow with PKCE.
 *
 * Supports two ways to get authorization codes:
 * 1. Automatic: Opens browser, redirects to localhost where we capture the code
 * 2. Manual: User manually copies and pastes the code (used in non-browser environments)
 */
export class OAuthService {
  private codeVerifier: string
  private authCodeListener: AuthCodeListener | null = null
  private port: number | null = null
  private manualAuthCodeResolver: ((authorizationCode: string) => void) | null =
    null
  private manualAuthCodeRejecter: ((error: Error) => void) | null = null
  private expectedState: string | null = null

  constructor() {
    this.codeVerifier = crypto.generateCodeVerifier()
  }

  async startOAuthFlow(
    authURLHandler: (url: string, automaticUrl?: string) => Promise<void>,
    options?: {
      loginWithClaudeAi?: boolean
      inferenceOnly?: boolean
      expiresIn?: number
      orgUUID?: string
      loginHint?: string
      loginMethod?: string
      /**
       * Don't call openBrowser(). Caller takes both URLs via authURLHandler
       * and decides how/where to open them. Used by the SDK control protocol
       * (claude_authenticate) where the SDK client owns the user's display,
       * not this process.
       */
      skipBrowserOpen?: boolean
    },
  ): Promise<OAuthTokens> {
    // Create OAuth callback listener and start it. If localhost callbacks are
    // unavailable (devcontainers, IPv6-only setups, locked-down hosts), keep
    // the manual copy/paste flow working instead of failing before showing it.
    try {
      this.authCodeListener = new AuthCodeListener()
      this.port = await this.authCodeListener.start()
    } catch (error) {
      logEvent('tengu_oauth_callback_listener_unavailable', {
        error: error instanceof Error ? error.message : String(error),
      })
      this.authCodeListener = null
      this.port = null
    }

    // Generate PKCE values and state
    const codeChallenge = crypto.generateCodeChallenge(this.codeVerifier)
    const state = crypto.generateState()

    // Build auth URLs for both automatic and manual flows
    const opts = {
      codeChallenge,
      state,
      port: this.port ?? 0,
      loginWithClaudeAi: options?.loginWithClaudeAi,
      inferenceOnly: options?.inferenceOnly,
      orgUUID: options?.orgUUID,
      loginHint: options?.loginHint,
      loginMethod: options?.loginMethod,
    }
    const manualFlowUrl = client.buildAuthUrl({ ...opts, isManual: true })
    const automaticFlowUrl =
      this.authCodeListener && this.port !== null
        ? client.buildAuthUrl({ ...opts, isManual: false })
        : undefined

    // Wait for either automatic or manual auth code
    const authorizationCode = await this.waitForAuthorizationCode(
      state,
      async () => {
        if (options?.skipBrowserOpen) {
          // Hand both URLs to the caller. The automatic one still works
          // if the caller opens it on the same host (localhost listener
          // is running); the manual one works from anywhere. Some SDK callers
          // require an automaticUrl field, so fall back to the manual URL when
          // localhost callbacks are unavailable.
          await authURLHandler(manualFlowUrl, automaticFlowUrl ?? manualFlowUrl)
        } else {
          // Hand over both so a non-TUI caller can print the localhost URL for
          // a same-host browser and still offer the paste-back URL.
          await authURLHandler(manualFlowUrl, automaticFlowUrl)
          // Prefer automatic localhost callback when available; otherwise open
          // the manual URL so remote/container users can still copy the code.
          await openBrowser(automaticFlowUrl ?? manualFlowUrl)
        }
      },
    )

    // Check if the automatic flow is still active (has a pending response)
    const isAutomaticFlow = this.authCodeListener?.hasPendingResponse() ?? false
    logEvent('tengu_oauth_auth_code_received', { automatic: isAutomaticFlow })

    try {
      // Exchange authorization code for tokens
      const tokenResponse = await client.exchangeCodeForTokens(
        authorizationCode,
        state,
        this.codeVerifier,
        this.port ?? 0,
        !isAutomaticFlow, // Pass isManual=true if it's NOT automatic flow
        options?.expiresIn,
      )

      // Fetch profile info (subscription type and rate limit tier) for the
      // returned OAuthTokens. Logout and account storage are handled by the
      // caller (installOAuthTokens in auth.ts).
      const profileInfo = await client.fetchProfileInfo(
        tokenResponse.access_token,
      )

      // Handle success redirect for automatic flow
      if (isAutomaticFlow) {
        const scopes = client.parseScopes(tokenResponse.scope)
        this.authCodeListener?.handleSuccessRedirect(scopes)
      }

      return this.formatTokens(
        tokenResponse,
        profileInfo.subscriptionType,
        profileInfo.rateLimitTier,
        profileInfo.rawProfile,
      )
    } catch (error) {
      // If we have a pending response, send an error redirect before closing
      if (isAutomaticFlow) {
        this.authCodeListener?.handleErrorRedirect()
      }
      throw error
    } finally {
      // Always cleanup
      this.authCodeListener?.close()
    }
  }

  private async waitForAuthorizationCode(
    state: string,
    onReady: () => Promise<void>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        fn()
      }
      const timeout = setTimeout(() => {
        this.manualAuthCodeResolver = null
        this.manualAuthCodeRejecter = null
        this.authCodeListener?.close()
        settle(() =>
          reject(
            new Error(
              'OAuth login timed out. If your browser cannot reach localhost, retry and use the manual code paste option.',
            ),
          ),
        )
      }, OAUTH_AUTHORIZATION_TIMEOUT_MS)

      // Set up manual auth code resolver
      this.expectedState = state
      this.manualAuthCodeResolver = authorizationCode =>
        settle(() => resolve(authorizationCode))
      this.manualAuthCodeRejecter = error => settle(() => reject(error))

      // Start automatic flow
      if (!this.authCodeListener) {
        void onReady().catch(error => {
          this.manualAuthCodeResolver = null
          this.manualAuthCodeRejecter = null
          settle(() => reject(error))
        })
        return
      }

      this.authCodeListener
        .waitForAuthorization(state, onReady)
        .then(authorizationCode => {
          this.manualAuthCodeResolver = null
          this.manualAuthCodeRejecter = null
          settle(() => resolve(authorizationCode))
        })
        .catch(error => {
          this.manualAuthCodeResolver = null
          this.manualAuthCodeRejecter = null
          settle(() => reject(error))
        })
    })
  }

  // Handle manual flow callback when user pastes the auth code
  handleManualAuthCodeInput(params: {
    authorizationCode: string
    state: string
  }): void {
    if (!this.manualAuthCodeResolver) return
    // The automatic flow checks this in AuthCodeListener; the manual flow used
    // to accept the pasted state and discard it, so a mismatch surfaced as an
    // opaque token-exchange failure instead of naming the cause. Compared
    // unconditionally so a paste arriving outside a flow cannot pass either.
    if (params.state !== this.expectedState) {
      this.manualAuthCodeRejecter?.(new Error('Invalid state parameter'))
      this.manualAuthCodeResolver = null
      this.manualAuthCodeRejecter = null
      this.authCodeListener?.close()
      return
    }
    this.manualAuthCodeResolver(params.authorizationCode)
    this.manualAuthCodeResolver = null
    this.manualAuthCodeRejecter = null
    // Close the auth code listener since manual input was used
    this.authCodeListener?.close()
  }

  private formatTokens(
    response: OAuthTokenExchangeResponse,
    subscriptionType: SubscriptionType | null,
    rateLimitTier: RateLimitTier | null,
    profile?: OAuthProfileResponse,
  ): OAuthTokens {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes: client.parseScopes(response.scope),
      subscriptionType,
      rateLimitTier,
      profile,
      tokenAccount: response.account
        ? {
            uuid: response.account.uuid,
            emailAddress: response.account.email_address,
            organizationUuid: response.organization?.uuid,
          }
        : undefined,
    }
  }

  // Clean up any resources (like the local server)
  cleanup(): void {
    this.authCodeListener?.close()
    this.manualAuthCodeResolver = null
    this.manualAuthCodeRejecter = null
  }
}
