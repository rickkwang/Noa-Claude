import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { jsonStringify } from '../utils/slowOperations.js'

const DEBUG_MSG_LIMIT = 2000

const SECRET_FIELD_NAMES = [
  'session_ingress_token',
  'environment_secret',
  'access_token',
  'secret',
  'token',
  'authorization',
]

const REDACT_MIN_LENGTH = 16

function redactValue(value: string): string {
  if (value.length < REDACT_MIN_LENGTH) {
    return '[REDACTED]'
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

/** Quoted pairs: `"token": "value"`. */
const SECRET_PATTERN = new RegExp(
  `"(${SECRET_FIELD_NAMES.join('|')})"\\s*:\\s*"([^"]*)"`,
  'g',
)

/** Unquoted key/value forms: `token=…`, `AWS_SECRET_ACCESS_KEY=…`. */
const SECRET_KEY_VALUE_PATTERN =
  /([A-Za-z0-9_-]*(?:secret|token|password|authorization|api[_-]?key)[A-Za-z0-9_-]*["']?\s*[:=]\s*)(["']?)([^\s"',;}]{16,})\2/gi

/** Scheme-prefixed credentials: `Bearer eyJ…`, `Basic dXNl…`. */
const SECRET_SCHEME_PATTERN =
  /\b(Bearer|Basic|Digest|token)\s+([A-Za-z0-9._~+/=-]{8,})/gi

/**
 * Well-known credential families, mirroring the upstream redaction set:
 * Anthropic, OpenAI, GitHub, GitLab, Slack, AWS and JWT.
 */
const SECRET_TOKEN_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{10,}/g,
  /gh[oprsu]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{10,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
]

export function redactSecrets(s: string): string {
  let result = s.replace(
    SECRET_PATTERN,
    (_match, field: string, value: string) =>
      `"${field}":"${redactValue(value)}"`,
  )
  result = result.replace(
    SECRET_KEY_VALUE_PATTERN,
    (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${redactValue(value)}${quote}`,
  )
  result = result.replace(
    SECRET_SCHEME_PATTERN,
    (_match, scheme: string, value: string) =>
      `${scheme} ${redactValue(value)}`,
  )
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    result = result.replace(pattern, match => redactValue(match))
  }
  return result
}

/** Truncate a string for debug logging, collapsing newlines. */
export function debugTruncate(s: string): string {
  const flat = s.replace(/\n/g, '\\n')
  if (flat.length <= DEBUG_MSG_LIMIT) {
    return flat
  }
  return flat.slice(0, DEBUG_MSG_LIMIT) + `... (${flat.length} chars)`
}

/** Truncate a JSON-serializable value for debug logging. */
export function debugBody(data: unknown): string {
  const raw = typeof data === 'string' ? data : jsonStringify(data)
  const s = redactSecrets(raw)
  if (s.length <= DEBUG_MSG_LIMIT) {
    return s
  }
  return s.slice(0, DEBUG_MSG_LIMIT) + `... (${s.length} chars)`
}

/**
 * Extract a descriptive error message from an axios error (or any error).
 * For HTTP errors, appends the server's response body message if available,
 * since axios's default message only includes the status code.
 */
export function describeAxiosError(err: unknown): string {
  const msg = errorMessage(err)
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: unknown } }).response
    if (response?.data && typeof response.data === 'object') {
      const data = response.data as Record<string, unknown>
      const detail =
        typeof data.message === 'string'
          ? data.message
          : typeof data.error === 'object' &&
              data.error &&
              'message' in data.error &&
              typeof (data.error as Record<string, unknown>).message ===
                'string'
            ? (data.error as Record<string, unknown>).message
            : undefined
      if (detail) {
        return `${msg}: ${detail}`
      }
    }
  }
  return msg
}

/**
 * Extract the HTTP status code from an axios error, if present.
 * Returns undefined for non-HTTP errors (e.g. network failures).
 */
export function extractHttpStatus(err: unknown): number | undefined {
  if (
    err &&
    typeof err === 'object' &&
    'response' in err &&
    (err as { response?: { status?: unknown } }).response &&
    typeof (err as { response: { status?: unknown } }).response.status ===
      'number'
  ) {
    return (err as { response: { status: number } }).response.status
  }
  return undefined
}

/**
 * Pull a human-readable message out of an API error response body.
 * Checks `data.message` first, then `data.error.message`.
 */
export function extractErrorDetail(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  if ('message' in data && typeof data.message === 'string') {
    return data.message
  }
  if (
    'error' in data &&
    data.error !== null &&
    typeof data.error === 'object' &&
    'message' in data.error &&
    typeof data.error.message === 'string'
  ) {
    return data.error.message
  }
  return undefined
}

/**
 * Log a bridge init skip — debug message + `tengu_bridge_repl_skipped`
 * analytics event. Centralizes the event name and the AnalyticsMetadata
 * cast so call sites don't each repeat the 5-line boilerplate.
 */
export function logBridgeSkip(
  reason: string,
  debugMsg?: string,
  v2?: boolean,
): void {
  if (debugMsg) {
    logForDebugging(debugMsg)
  }
  logEvent('tengu_bridge_repl_skipped', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(v2 !== undefined && { v2 }),
  })
}
