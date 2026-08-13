/**
 * CLAUDE_CODE_OAUTH_TOKEN override messaging for /login.
 *
 * Kept out of login.tsx so it can be tested without pulling in ink, the OAuth
 * flow component and the bridge module. No @ts-nocheck: this module is small
 * and pure, so it can carry its weight under tsc.
 */
import { isBareMode } from '../../utils/envUtils.js'
import { getAPIProvider } from '../../utils/model/providers.js'

/**
 * Whether a CLAUDE_CODE_OAUTH_TOKEN in the environment actually outranks the
 * credentials /login is about to store.
 *
 * getClaudeAIOAuthTokens() consults the env var before any stored credential
 * (utils/auth.ts), and services/api/client.ts reads its accessToken for the
 * Authorization header, so while it is set the env token is what goes on the
 * wire. The two exclusions are the cases where that isn't true and the warning
 * would be noise: bare mode short-circuits that lookup to null, and a
 * non-firstParty provider (Bedrock/Vertex/Foundry/OpenAI-compatible)
 * authenticates by its own mechanism entirely.
 */
function envOAuthTokenOverridesLogin(): boolean {
  return (
    isEnvOAuthTokenSet() && !isBareMode() && getAPIProvider() === 'firstParty'
  )
}

/**
 * Bare presence of the override, with none of the relevance conditions.
 *
 * /login snapshots this before opening the flow. It has to be separate from
 * envOAuthTokenOverridesLogin() because the two are true at different moments:
 * a standard OAuth login runs applyActiveProviderProfileEnv(), which deletes
 * CLAUDE_CODE_USE_BEDROCK/_VERTEX/_FOUNDRY/_OPENAI outright, so a session that
 * started on a third-party provider ends up on firstParty — and only then does
 * the env token start deciding the Authorization header. Evaluating the full
 * predicate up front would go quiet for exactly that session and report a bare
 * "Login successful" while the env token silently took over.
 */
export function isEnvOAuthTokenSet(): boolean {
  return !!process.env.CLAUDE_CODE_OAUTH_TOKEN
}

/**
 * Warning shown as the /login flow opens, or undefined when the environment
 * has no bearing on the login.
 *
 * Kept to roughly the length of the text it displaces: ConsoleOAuthFlow renders
 * `startingMessage` *instead of* the default "subscription or API billing"
 * orientation line, in bold, as the heading above the login-method picker. The
 * full remediation detail goes in the post-login note instead, which lands in
 * the transcript as an ordinary message.
 *
 * Deliberate wording deviation from upstream: 2.1.229 says "This session will
 * switch to your new credentials after logging in", which it can say because it
 * clears the env token during login. This fork does not clear it, so the env
 * token keeps winning and upstream's sentence would be false here.
 */
export function getLoginStartingMessage(): string | undefined {
  if (!envOAuthTokenOverridesLogin()) {
    return undefined
  }
  return 'Warning: CLAUDE_CODE_OAUTH_TOKEN is set in your environment and will keep overriding whatever you log in with here — unset it for a new login to take effect.'
}

/**
 * The message /login reports on success.
 *
 * Ports upstream 2.1.229's repeat of the override warning: by the time login
 * completes, the entry warning has scrolled away behind the browser
 * round-trip, and a bare "Login successful" reads as "you are now on the new
 * account" when in this fork you are not.
 *
 * Two-phase on purpose, because the note makes two claims and they are true at
 * different moments. "was set in your environment when /login started" is the
 * caller's `envTokenWasSet` snapshot of isEnvOAuthTokenSet(), taken before the
 * flow ran. "this session will keep using it" is re-checked here, after the
 * flow — the login itself can flip that half (see isEnvOAuthTokenSet). Both
 * must hold, or the note would assert something false.
 *
 * Two spaces before the note, as upstream.
 */
export function getLoginSuccessMessage(envTokenWasSet: boolean): string {
  if (!envTokenWasSet || !envOAuthTokenOverridesLogin()) {
    return 'Login successful'
  }
  return (
    'Login successful  Note: CLAUDE_CODE_OAUTH_TOKEN was set in your environment when /login started, ' +
    'and this session will keep using it rather than the credentials you just stored. Unset it for your ' +
    'new credentials to take effect, and if it is set in your shell profile or a settings file, remove it ' +
    'there too or new `noa` sessions will keep using the old token.'
  )
}
