// @ts-nocheck
import { isEnvTruthy } from './envUtils.js'

/**
 * Env vars to strip from subprocess environments when running inside GitHub
 * Actions. This prevents prompt-injection attacks from exfiltrating secrets
 * via shell expansion (e.g., ${ANTHROPIC_API_KEY}) in Bash tool commands.
 *
 * The parent claude process keeps these vars (needed for API calls, lazy
 * credential reads). Only child processes (bash, shell snapshot, MCP stdio, LSP, hooks) are scrubbed.
 *
 * GITHUB_TOKEN / GH_TOKEN are intentionally NOT scrubbed — wrapper scripts
 * (gh.sh) need them to call the GitHub API. That token is job-scoped and
 * expires when the workflow ends.
 */
const GHA_SUBPROCESS_SCRUB = [
  // Anthropic auth — claude re-reads these per-request, subprocesses don't need them
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  // OpenAI-compatible provider key, read per request like the Anthropic ones
  'OPENAI_API_KEY',

  // OTLP exporter headers — documented to carry Authorization=Bearer tokens
  // for monitoring backends; read in-process by OTEL SDK, subprocesses never need them
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',

  // Cloud provider creds — same pattern (lazy SDK reads)
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',

  // GitHub Actions OIDC — consumed by the action's JS before claude spawns;
  // leaking these allows minting an App installation token → repo takeover
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',

  // GitHub Actions artifact/cache API — cache poisoning → supply-chain pivot
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',

  // claude-code-action-specific duplicates — action JS consumes these during
  // prepare, before spawning claude. ALL_INPUTS contains anthropic_api_key as JSON.
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * Returns a copy of process.env with sensitive secrets stripped, for use when
 * spawning subprocesses (Bash tool, shell snapshot, MCP stdio servers, LSP
 * servers, shell hooks).
 *
 * Gated on CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. claude-code-action sets this
 * automatically when `allowed_non_write_users` is configured — the flag that
 * exposes a workflow to untrusted content (prompt injection surface).
 */
// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions. Stays undefined in non-CCR startups so we never pull in the
// upstreamproxy module graph (upstreamproxy.ts + relay.ts) via a static import.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

/**
 * Called from init.ts to wire up the proxy env function after the upstreamproxy
 * module has been lazily loaded. Must be called before any subprocess is spawned.
 */
export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

export function subprocessEnv(): NodeJS.ProcessEnv {
  // CCR upstreamproxy: inject HTTPS_PROXY + CA bundle vars so curl/gh/python
  // in agent subprocesses route through the local relay. Returns {} when the
  // proxy is disabled or not registered (non-CCR), so this is a no-op outside
  // CCR containers.
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}
  const env = { ...process.env, ...proxyEnv }

  // Strip OTEL_* unconditionally so OTEL-instrumented apps run via Bash/MCP/LSP/hooks
  // don't pick up the CLI's own OTLP endpoint, service name, or resource attributes.
  for (const k of Object.keys(env)) {
    if (k.startsWith('OTEL_')) delete env[k]
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB)) {
    for (const k of GHA_SUBPROCESS_SCRUB) {
      delete env[k]
      // GitHub Actions auto-creates INPUT_<NAME> for `with:` inputs, duplicating
      // secrets like INPUT_ANTHROPIC_API_KEY. No-op for vars that aren't action inputs.
      delete env[`INPUT_${k}`]
    }
  }
  return env
}

// Credentials a repository-declared helper must not inherit. The list, name
// patterns and value shapes follow upstream's helper scrub; upstream's
// per-tool rewriting (index URLs, GOFLAGS, Maven -D) is replaced here by
// dropping the whole variable, which is stricter.
const KNOWN_CREDENTIAL_ENV = new Set([
  ...GHA_SUBPROCESS_SCRUB,
  'GITHUB_TOKEN', 'GH_TOKEN',
  'CLAUDE_CODE_ARTIFACTS_API_TOKEN', 'CLAUDE_CODE_MEMORY_API_TOKEN', 'CLAUDE_CODE_SLACK_TAG_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'ANTHROPIC_FOUNDRY_AUTH_TOKEN', 'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_IDENTITY_TOKEN', 'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'GOOGLE_GHA_CREDS_PATH', 'IDENTITY_HEADER', 'MSI_SECRET', 'AZURE_CLIENT_CERTIFICATE_PASSWORD',
  'AZURE_PASSWORD', 'AZURE_FEDERATED_TOKEN_FILE', 'AZURE_AUTH_LOCATION', 'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN', 'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'CLOUDSDK_AUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE', 'CLOUDSDK_AUTH_AUTHORIZATION_TOKEN_FILE',
  'GOOGLE_OAUTH_ACCESS_TOKEN', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACEHUB_API_TOKEN',
  'NODE_AUTH_TOKEN', 'NUGET_AUTH_TOKEN', 'CARGO_REGISTRY_TOKEN', 'TWINE_PASSWORD', 'TWINE_USERNAME',
  'PYPI_TOKEN', 'PYPI_API_TOKEN', 'UV_PUBLISH_TOKEN', 'UV_PUBLISH_PASSWORD', 'UV_PUBLISH_USERNAME',
  'FLIT_PASSWORD', 'FLIT_USERNAME', 'HATCH_INDEX_AUTH', 'HATCH_INDEX_USER', 'GEM_HOST_API_KEY',
  'MATURIN_PYPI_TOKEN', 'MATURIN_PASSWORD', 'MATURIN_USERNAME', 'CONAN_LOGIN_USERNAME', 'CONAN_PASSWORD',
  'ANACONDA_API_TOKEN', 'BINSTAR_API_TOKEN', 'VAULT_TOKEN', 'VAULT_AUTH_TOKEN', 'VAULT_ROLE_ID',
  'VAULT_SECRET_ID', 'CONSUL_HTTP_TOKEN', 'CONSUL_HTTP_AUTH', 'NOMAD_TOKEN', 'NOMAD_HTTP_AUTH',
  'CI_REGISTRY_USER', 'CI_DEPLOY_USER', 'JF_USER', 'FASTLANE_SESSION', 'MATCH_GIT_BASIC_AUTHORIZATION',
  'SONAR_TOKEN', 'SONARQUBE_SCANNER_PARAMS', 'SONAR_SCANNER_JSON_PARAMS', 'SLACK_WEBHOOK_URL',
  'SLACK_WEBHOOK', 'DISCORD_WEBHOOK', 'DISCORD_WEBHOOK_URL', 'TEAMS_WEBHOOK_URL', 'MS_TEAMS_WEBHOOK_URI',
  'VSS_NUGET_EXTERNAL_FEED_ENDPOINTS', 'ARTIFACTS_CREDENTIALPROVIDER_EXTERNAL_FEED_ENDPOINTS',
  'VSS_NUGET_ACCESSTOKEN', 'ARTIFACTS_CREDENTIALPROVIDER_ACCESSTOKEN', 'COMPOSER_AUTH',
])
const NAME_WORDS = ['TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'PASSPHRASE', 'KEY', 'AUTH', 'COOKIE', 'PAT', 'DSN', 'WEBHOOK', 'CREDENTIAL', 'CREDENTIALS', 'CREDS', 'APIKEY', 'ACCESSKEY', 'SECRETKEY', 'ACCOUNTKEY', 'PRIVATEKEY', 'AUTHKEY', 'SSHKEY', 'SIGNINGKEY', 'MASTERKEY', 'DEPLOYKEY', 'ENCRYPTIONKEY', 'PGPASSWORD', 'SSHPASS']
const CREDENTIAL_NAME = new RegExp(`((^|_)(${NAME_WORDS.join('|')}|(KEY|SECRET|PASSWORD|CREDENTIAL)S)|_(PWD|PASS|JWT)|(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE))(?=$|[_0-9])`, 'i')
const CONNECTION_STRING_NAME = /CONN(ECT(ION)?)?_?STR(ING)?S?(?=$|[_0-9])/i
const BUNDLER_CREDENTIAL_NAME = /^(?:INPUT_)?BUNDLE_(?!(?:BUILD|LOCAL|MIRROR|PATH|WITH|WITHOUT|CACHE|DISABLE|IGNORE|ONLY)__(?!(?:[A-Za-z0-9]+(?:___[A-Za-z0-9]+)*__)+[A-Za-z]{2,}$))\w*__/i
const REGISTRY_PREFIX = /^(?:INPUT_|ORG_GRADLE_PROJECT_|POETRY_PYPI_TOKEN_|POETRY_HTTP_BASIC_|CARGO_REGISTRIES_|CONAN_LOGIN_USERNAME_|CONAN_PASSWORD_)/i
const REGISTRY_ALWAYS = /^(?:INPUT_)?(?:POETRY_HTTP_BASIC_|CONAN_LOGIN_USERNAME_)/i
const GIT_CONFIG_ENV = /^GIT_CONFIG_(?:COUNT|PARAMETERS|(?:KEY|VALUE)_[0-9]+)$/
const PROXY_ENV = /^(?:(?:https?|ftp|all|no)_proxy|npm_config_(?:https?_)?proxy|npm_config_noproxy|yarn_proxy|(?:yarn|global_agent|docker|claude_code)_(?:https?|no)_proxy|cloudsdk_proxy_[a-z]+|electron_get_use_proxy)$/i

function snakeCase(name: string): string {
  return ['OAuth', 'NextAuth']
    .reduce((n, word) => n.replaceAll(word, word[0] + word.slice(1).toLowerCase()), name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
}

function isCredentialName(name: string): boolean {
  const n = name.replace(/^AUTH0_/i, '').replace(/-/g, '_')
  if (/^GIT_CONFIG_KEY_[0-9]/.test(name)) return false
  return CREDENTIAL_NAME.test(n) || CREDENTIAL_NAME.test(snakeCase(n)) ||
    CONNECTION_STRING_NAME.test(n) || CONNECTION_STRING_NAME.test(snakeCase(n)) ||
    BUNDLER_CREDENTIAL_NAME.test(n)
}

function isRegistryCredentialName(name: string): boolean {
  const n = name.replace(/-/g, '_')
  return REGISTRY_PREFIX.test(n) && (REGISTRY_ALWAYS.test(n) || /USER(?:_?NAME)?_?[0-9]*$/i.test(n) || isCredentialName(n))
}

function looksLikeToken(value: string): boolean {
  return /^(?:gh[opusr]_|github_pat_|glpat-|xox[abpr]-|sk-|pk-|AKIA|eyJ|ya29\.|npm_)/.test(value) ||
    (value.length >= 20 && /[0-9]/.test(value) && /[a-z]/i.test(value))
}

const PASSWORD_ASSIGNMENT = /(?:(?:^|[;&?#,{]|\/:)\s*|\s)["']?(?!-*jobserver-auth\s*[=:])(?:[a-z0-9_.-]{0,64}(?:password|passwd|pwd|secret|token|(?:account|access|api|private|subscription)[-_]?key|signature|sig|credential)|[a-z0-9_.-]{0,63}[_.-]auth)["']?\s*[=:]\s*["']?(?!(?:true|false|none|null|yes|no|on|off|enabled|disabled|required|optional)(?:$|[;&,\s"']))[^;&,\s"']+/i
const WEBHOOK_URL = /https:\/\/(?:hooks\.slack\.com\/(?:services|workflows|triggers)\/|(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/|[\w.-]+\.webhook\.office\.com\/webhookb2\/)[\w\/@.~-]{16,}/i

/** Value shapes upstream treats as secrets: URL userinfo, auth headers, key/password pairs, webhooks, private keys. */
function hasCredentialValue(value: string): boolean {
  const v = value.slice(0, 8192)
  for (const match of v.matchAll(/[a-z0-9+.-]:\/\/([^\s/?#@]*)@/gi)) {
    const userinfo = match[1]!
    if (userinfo.includes(':') || looksLikeToken(userinfo)) return true
  }
  return PASSWORD_ASSIGNMENT.test(v) || WEBHOOK_URL.test(v) ||
    /["']?sonar\.login["']?\s*[:=]\s*["']?[^\s"',}]{8,}/.test(v) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/.test(v) ||
    /\bauthorization\s*[:=]\s*["']?[a-z][a-z0-9_-]*\s+[A-Za-z0-9._~+/=-]{8,}/i.test(v) ||
    /\b(?:[Tt]oken|TOKEN)\s+(?=[A-Za-z0-9_~+=-]*[0-9])(?=[A-Za-z0-9_~+=-]*[A-Z])(?=([A-Za-z0-9_~+=-]{20,}))\1(?![/.])/.test(v) ||
    /\b(?:Bearer|Basic)\s+(?=[A-Za-z._~+/=-]*[0-9]|(?:[A-Za-z0-9._~+/=-]*?[a-z][A-Z](?![a-z])){2}|[A-Za-z0-9.-]*[_~+/=])[A-Za-z0-9._~+/=-]{8,}/.test(v)
}

/**
 * subprocessEnv() without credentials, regardless of
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, plus `injected` with any removed secret
 * value replaced by REDACTED. For repository-declared helpers, whose output
 * goes to a repository-chosen endpoint. Proxy settings are kept so the
 * helper can still reach the network.
 */
export function credentialFreeSubprocessEnv(
  injected: Record<string, string>,
): NodeJS.ProcessEnv {
  const env = subprocessEnv()
  const removed: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    const upper = name.toUpperCase()
    const credential =
      KNOWN_CREDENTIAL_ENV.has(upper) || KNOWN_CREDENTIAL_ENV.has(upper.replace(/^INPUT_/, '')) ||
      isCredentialName(name) || isRegistryCredentialName(name) ||
      (!PROXY_ENV.test(name) && !GIT_CONFIG_ENV.test(name) && hasCredentialValue(value))
    if (!credential) continue
    // Flag-like values ('1', 'true') would mangle unrelated text if redacted.
    if (value.length >= 6) removed.push(value)
    delete env[name]
  }
  removed.sort((a, b) => b.length - a.length)
  for (const [name, value] of Object.entries(injected)) {
    env[name] = removed.reduce((text, secret) => text.split(secret).join('REDACTED'), value)
  }
  return env
}
